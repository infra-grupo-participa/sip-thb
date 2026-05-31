// Admin — Cronograma/Templates (porte de handlers/admin-schedule.ts).
//
// Endpoints:
//   GET   /admin/ciclo-templates           → lista os 2 templates (Aurum + Seminário)
//   PUT   /admin/ciclo-templates/:cicloType → atualiza um template inteiro
//   POST  /admin/schedule-preview          → calcula cronograma sem persistir
//   GET   /admin/students/:id/schedule     → schedule materializado do aluno
//   PATCH /admin/students/:id/schedule     → muda anchor e/ou overrides
//
// Por que existe um router dedicado: o cronograma deixou de ser propriedade do
// "ciclo agregado" e passou a ser do aluno (sip.student_schedules — 1 row por
// aluno com anchor própria). Porta de entrada CRUD do novo modelo, separada de
// admin-students pra reduzir blast radius.
import { Router } from 'express';
import { sip } from '../db.js';
import { audit } from '../domain/audit.js';
import { isValidCicloType } from '../domain/ciclo.js';
import {
  buildMilestones,
  getCicloTemplate,
  loadCicloTemplates,
  _invalidateTemplateCache,
} from '../domain/progress.js';
import {
  validateAnchorAgainstTemplate,
  type ScheduleOverrides,
  type TemplateMilestone,
} from '../domain/schedule.js';

export const adminScheduleRouter = Router();

// ── GET /admin/ciclo-templates ──────────────────────────────────────────────
// Lista os 2 templates (Aurum + Seminário) para a aba "Templates" do admin.
adminScheduleRouter.get('/admin/ciclo-templates', async (_req, res, next) => {
  try {
    const templates = await loadCicloTemplates();
    return res.json({
      templates: Array.from(templates.entries()).map(([type, t]) => ({
        ciclo_type: type,
        duracao_dias: t.duracao_dias,
        milestones: t.milestones,
        rules: t.rules,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /admin/ciclo-templates/:cicloType ───────────────────────────────────
// Atualiza um template inteiro. Body: { duracao_dias?, milestones?, rules? }.
// Sanitização rigorosa do array de milestones: cada item tem que ter
// {key, offset, label, phase, phase_color, is_anchor}. Exatamente 1 marco
// pode ter is_anchor=true. Após salvar, invalida o cache pra refletir
// imediato em /me/calendar.
//
// Observação: mudar o template NÃO re-aplica em alunos já com schedule
// materializado — eles continuam com a versão antiga. Pra re-materializar,
// é necessário PATCH /admin/students/:id/schedule.
adminScheduleRouter.put('/admin/ciclo-templates/:cicloType', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const cicloType = req.params.cicloType;
    if (!isValidCicloType(cicloType)) {
      return res.status(400).json({ error: 'ciclo_type inválido (use aurum ou seminario).' });
    }
    const body = (req.body ?? {}) as {
      duracao_dias?: number;
      milestones?: TemplateMilestone[];
      rules?: Record<string, unknown>;
    };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.duracao_dias != null) {
      if (!Number.isInteger(body.duracao_dias) || body.duracao_dias <= 0) {
        return res.status(400).json({ error: 'duracao_dias deve ser inteiro positivo.' });
      }
      updates.duracao_dias = body.duracao_dias;
    }

    if (body.milestones !== undefined) {
      if (!Array.isArray(body.milestones) || body.milestones.length === 0) {
        return res.status(400).json({ error: 'milestones precisa ser array não-vazio.' });
      }
      const seenKeys = new Set<string>();
      let anchorCount = 0;
      const sanitized: TemplateMilestone[] = [];
      for (const m of body.milestones) {
        if (!m || typeof m !== 'object') return res.status(400).json({ error: 'milestone inválido (objeto esperado).' });
        if (typeof m.key !== 'string' || !/^[a-z][a-z0-9_]{0,40}$/.test(m.key)) {
          return res.status(400).json({ error: `milestone.key inválida: ${String(m.key)} (use snake_case).` });
        }
        if (seenKeys.has(m.key)) return res.status(400).json({ error: `milestone.key duplicada: ${m.key}.` });
        seenKeys.add(m.key);
        if (!Number.isInteger(m.offset)) return res.status(400).json({ error: `milestone.offset precisa ser inteiro (${m.key}).` });
        if (typeof m.label !== 'string' || !m.label.trim()) return res.status(400).json({ error: `milestone.label vazio (${m.key}).` });
        if (typeof m.phase !== 'string' || !m.phase.trim()) return res.status(400).json({ error: `milestone.phase vazio (${m.key}).` });
        if (typeof m.phase_color !== 'string') return res.status(400).json({ error: `milestone.phase_color inválido (${m.key}).` });
        const isAnchor = m.is_anchor === true;
        if (isAnchor) anchorCount++;
        sanitized.push({
          key: m.key,
          offset: m.offset,
          label: m.label.trim().slice(0, 80),
          phase: m.phase.trim().slice(0, 40),
          phase_color: m.phase_color.trim().slice(0, 20),
          is_anchor: isAnchor,
        });
      }
      if (anchorCount !== 1) {
        return res.status(400).json({ error: `Exatamente 1 marco deve ter is_anchor=true (atual: ${anchorCount}).` });
      }
      updates.milestones = sanitized;
    }

    if (body.rules !== undefined) {
      if (!body.rules || typeof body.rules !== 'object' || Array.isArray(body.rules)) {
        return res.status(400).json({ error: 'rules precisa ser objeto.' });
      }
      // Sanitização leve — campos conhecidos passam, outros são ignorados.
      const r: Record<string, unknown> = {};
      const src = body.rules as Record<string, unknown>;
      if (src.min_offset_today_days != null) {
        const v = Number(src.min_offset_today_days);
        if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: 'rules.min_offset_today_days inválido.' });
        r.min_offset_today_days = v;
      }
      if (src.max_offset_today_days != null) {
        const v = Number(src.max_offset_today_days);
        if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: 'rules.max_offset_today_days inválido.' });
        r.max_offset_today_days = v;
      }
      if (src.anchor_dow !== undefined) {
        const v = src.anchor_dow;
        if (v === null) r.anchor_dow = null;
        else {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0 || n > 6) return res.status(400).json({ error: 'rules.anchor_dow deve ser 0..6 ou null.' });
          r.anchor_dow = n;
        }
      }
      if (Array.isArray(src.recommend_dow)) {
        const arr = src.recommend_dow
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
        r.recommend_dow = arr;
      }
      updates.rules = r;
    }

    const { error: upErr, data: row } = await sip()
      .from('ciclo_templates')
      .update(updates)
      .eq('ciclo_type', cicloType)
      .select()
      .maybeSingle();
    if (upErr) {
      console.error('[PUT ciclo-templates] erro:', upErr);
      return res.status(500).json({ error: 'Falha ao gravar template.', detail: upErr.message });
    }

    _invalidateTemplateCache();

    await audit(userId, 'ACTION', 'ciclo_templates', cicloType, {
      what: 'update_template',
      fields: Object.keys(updates).filter((k) => k !== 'updated_at'),
    });

    return res.json({ success: true, template: row });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/schedule-preview ────────────────────────────────────────────
// Calcula um cronograma a partir de { ciclo_type, anchor_date } SEM persistir.
// Usado pelo modal de aprovação e potencialmente pelo modal do aluno antes de
// salvar mudanças.
//
// Devolve { milestones, rules, anchor_date, ciclo_type } ou { error } em 400
// se a validação inicial falhar.
adminScheduleRouter.post('/admin/schedule-preview', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { ciclo_type?: string; anchor_date?: string };
    const { ciclo_type, anchor_date } = body;

    if (!isValidCicloType(ciclo_type)) {
      return res.status(400).json({ error: 'Selecione o ciclo (Aurum ou Diamante).' });
    }
    if (!anchor_date || typeof anchor_date !== 'string') {
      return res.status(400).json({ error: 'Informe a data do evento.' });
    }

    const template = await getCicloTemplate(ciclo_type);
    // allowPast=true porque o preview é informativo — admin pode estar
    // simulando datas pra discussão com o aluno. A validação obrigatória
    // acontece de fato no POST /approve.
    const ruleErr = validateAnchorAgainstTemplate(anchor_date, template, { allowPast: true });
    if (ruleErr) {
      // Devolve milestones mesmo assim (UI mostra warning amigável) — o erro
      // só impede commit. Frontend decide se renderiza com aviso.
      const milestones = await buildMilestones(anchor_date, ciclo_type);
      return res.json({
        anchor_date,
        ciclo_type,
        milestones,
        rules: template.rules,
        duracao_dias: template.duracao_dias,
        warning: ruleErr,
      });
    }

    const milestones = await buildMilestones(anchor_date, ciclo_type);
    return res.json({
      anchor_date,
      ciclo_type,
      milestones,
      rules: template.rules,
      duracao_dias: template.duracao_dias,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/students/:id/schedule ────────────────────────────────────────
// Devolve a row de sip.student_schedules + algumas labels do template pra UI
// montar a aba Cronograma do modal.
adminScheduleRouter.get('/admin/students/:id/schedule', async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const { data: sched } = await sip()
      .from('student_schedules')
      .select('*')
      .eq('user_id', studentId)
      .maybeSingle();

    if (!sched) {
      // Aluno aprovado sem schedule: aconteceu se o backfill não pegou
      // (faltou anchor) ou se a aprovação falhou no upsert. UI mostra
      // "Defina a data do evento pra gerar o cronograma".
      const { data: u } = await sip()
        .from('users')
        .select('ciclo_type, approval_status')
        .eq('id', studentId)
        .maybeSingle();
      if (!u) return res.status(404).json({ error: 'Aluno não encontrado' });
      const template = u.ciclo_type ? await getCicloTemplate(u.ciclo_type).catch(() => null) : null;
      return res.json({
        schedule: null,
        ciclo_type: u.ciclo_type,
        approval_status: u.approval_status,
        rules: template?.rules ?? null,
        duracao_dias: template?.duracao_dias ?? null,
      });
    }

    const template = await getCicloTemplate(sched.ciclo_type).catch(() => null);
    return res.json({
      schedule: sched,
      ciclo_type: sched.ciclo_type,
      rules: template?.rules ?? null,
      duracao_dias: template?.duracao_dias ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /admin/students/:id/schedule ──────────────────────────────────────
// Aceita { anchor_date?, overrides? }. Reaplica buildSchedule e bumpa version.
// anchor_date vazio (null) NÃO é aceito — pra "limpar" a anchor o admin deve
// usar o reject ou o PATCH /assignment. overrides pode vir como objeto vazio
// pra "restaurar tudo".
adminScheduleRouter.patch('/admin/students/:id/schedule', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const studentId = req.params.id;
    const body = (req.body ?? {}) as {
      anchor_date?: string;
      overrides?: ScheduleOverrides;
    };

    const { data: u } = await sip()
      .from('users')
      .select('ciclo_type, approval_status')
      .eq('id', studentId)
      .maybeSingle();
    if (!u) return res.status(404).json({ error: 'Aluno não encontrado' });
    if (!u.ciclo_type || (u.ciclo_type !== 'aurum' && u.ciclo_type !== 'seminario')) {
      return res.status(400).json({ error: 'Aluno sem ciclo_type definido.' });
    }

    const { data: existing } = await sip()
      .from('student_schedules')
      .select('*')
      .eq('user_id', studentId)
      .maybeSingle();

    const nextAnchor =
      typeof body.anchor_date === 'string' && body.anchor_date
        ? body.anchor_date
        : existing?.anchor_date;
    if (!nextAnchor) {
      return res.status(400).json({
        error: 'Sem anchor_date — informe a data do evento pra criar o cronograma.',
      });
    }

    const template = await getCicloTemplate(u.ciclo_type);
    const ruleErr = validateAnchorAgainstTemplate(nextAnchor, template, { allowPast: true });
    if (ruleErr) return res.status(400).json({ error: ruleErr });

    const nextOverrides: ScheduleOverrides =
      body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)
        ? body.overrides
        : (existing?.overrides as ScheduleOverrides) ?? {};

    // Sanitiza overrides: descarta keys que não existem no template e valores
    // não-data. Evita admin (ou request malformado) escrever qualquer string
    // na coluna jsonb.
    const validKeys = new Set(template.milestones.map((m) => m.key));
    const safeOverrides: ScheduleOverrides = {};
    for (const [k, v] of Object.entries(nextOverrides)) {
      if (!validKeys.has(k)) continue;
      if (typeof v !== 'string') continue;
      const d = new Date(v + 'T12:00:00');
      if (Number.isNaN(d.getTime())) continue;
      safeOverrides[k] = v;
    }

    const milestones = await buildMilestones(nextAnchor, u.ciclo_type, safeOverrides);
    const nowIso = new Date().toISOString();
    const nextVersion = (existing?.version ?? 0) + 1;

    const { error: upErr } = await sip().from('student_schedules').upsert(
      {
        user_id: studentId,
        ciclo_type: u.ciclo_type,
        anchor_date: nextAnchor,
        milestones,
        overrides: safeOverrides,
        version: nextVersion,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    );
    if (upErr) {
      console.error('[PATCH schedule] erro:', upErr);
      return res.status(500).json({ error: 'Falha ao gravar cronograma.', detail: upErr.message });
    }

    // Mantém sip.meta.calendar_anchor em sincronia pra compat com /me/calendar
    // (que ainda lê meta enquanto Fase F não chega).
    await sip().from('meta').upsert(
      { user_id: studentId, key: 'calendar_anchor', value: nextAnchor, updated_at: nowIso },
      { onConflict: 'user_id,key' },
    );

    await audit(userId, 'ACTION', 'student_schedules', studentId, {
      what: 'patch_schedule',
      anchor_date: nextAnchor,
      anchor_changed: existing?.anchor_date !== nextAnchor,
      overrides_keys: Object.keys(safeOverrides),
      version: nextVersion,
    });

    return res.json({
      success: true,
      schedule: {
        user_id: studentId,
        ciclo_type: u.ciclo_type,
        anchor_date: nextAnchor,
        milestones,
        overrides: safeOverrides,
        version: nextVersion,
      },
    });
  } catch (err) {
    next(err);
  }
});
