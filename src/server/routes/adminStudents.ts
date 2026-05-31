// Admin — alunos avançado (ficha completa + edição + atribuição + cronograma +
// revisão de comprovantes + posts/tráfego por aluno).
//
// Porte FIEL dos handlers legados:
//   - handlers/admin-students.ts → GET /admin/students/:id/full,
//       PATCH /admin/students/:id, PATCH /admin/students/:id/assignment
//   - handlers/admin-schedule.ts → GET/PATCH /admin/students/:id/schedule
//   - handlers/admin-misc.ts     → PUT /admin/students/:id/proofs/:proofId
//                                   (+ GET /admin/students/:id/proofs)
//
// Observação sobre métodos: o legado usa PATCH para edição (:id) e atribuição
// (assignment) e PATCH para o schedule — mantidos 1:1 para paridade com o
// frontend que consome a API legada. GET /admin/students/:id/posts e
// /admin/students/:id/traffic não existem como endpoints dedicados no legado
// (os dados saem em /full); foram adicionados aqui como GETs de conveniência
// que devolvem exatamente os mesmos arrays (posts/traffic) já expostos no /full.
//
// Montagem: sob adminGate (/api/admin), ANTES do roster genérico de admin.ts —
// as rotas :id daqui são path patterns distintos do roster (/admin/students),
// então não há colisão; o roster (GET /admin/students) NÃO é duplicado aqui.

import { Router } from 'express';
import { sip } from '../db.js';
import { audit } from '../domain/audit.js';
import { adminRateLimit } from '../middleware/rateLimit.js';
import { isValidCicloType } from '../domain/ciclo.js';
import { resolveTaskline } from '../domain/taskline.js';
import { buildProgress, buildMilestones, getCicloTemplate } from '../domain/progress.js';
import {
  validateAnchorAgainstTemplate,
  type ScheduleOverrides,
} from '../domain/schedule.js';

export const adminStudentsRouter = Router();

// ── Projeção da ficha completa do aluno (copiada do legado _shared.ts) ─────────
// tudo exceto password_hash e auth_id.
const USER_FULL_COLS =
  'id, name, email, role, ciclo_type, current_ciclo_id, monitor_id, onboarding_done, phone, city, self_registered, profissao, tempo_carreira, lancamentos_anteriores, faturamento_atual, instagram_handle, fez_curso_thb_antes, is_socio, socio_of, created_at, raiox_answers, raiox_score, raiox_max_score, raiox_submitted_at, approval_status, approval_decided_at, approval_decided_by, approval_note, interesse_ciclo, turma_aurum, is_platina, turma_thb, onboarding_perfil, must_change_password, password_changed_at, nivel';

// ── Validators centralizados (copiados do legado _shared.ts) ──────────────────
const TURMA_AURUM_RE = /^A[1-9]$/;
const TURMA_THB_RE = /^T(?:[1-9]|[12][0-9]|3[0-8])$/;
const CITY_RE = /^[\p{L}][\p{L}\s\-'.,()]{1,80}\/\s?[A-Z]{2}$/u;
const PROFISSAO_RE = /^[\p{L}][\p{L}\s.'\-/()]{0,79}$/u;

// sanitizeText: remove control chars, normaliza espaços, trunca.
function sanitizeText(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  let out = s.split('').filter((ch) => { const c = ch.charCodeAt(0); if (c <= 0x1f || c === 0x7f) return false; if (c >= 0x200b && c <= 0x200d) return false; if (c === 0xfeff) return false; return true; }).join('').replace(/\s+/g, ' ').trim();
  if (out.length > max) out = out.slice(0, max);
  return out;
}

// ── Live links agendados pela equipe (paridade com legado admin-students) ──────
const LIVE_LINK_META_KEYS = ['live_link_aq1', 'live_link_aq2', 'live_link_aq3', 'live_link_pre', 'live_link_palestra'] as const;
type LiveLinkSlot = typeof LIVE_LINK_META_KEYS[number];

const LIVE_LINK_SLOT_MAP: Record<string, LiveLinkSlot> = {
  aq1: 'live_link_aq1', aq2: 'live_link_aq2', aq3: 'live_link_aq3',
  pre: 'live_link_pre', palestra: 'live_link_palestra',
};

// Converte payload do admin ({live_links: {aq1: '…', …}}) em meta upserts.
// String vazia limpa a key (gravada como null). Trunca em 500 chars.
function liveLinksToMetaUpserts(
  liveLinks: unknown,
  studentId: string,
  nowIso: string,
): Array<{ user_id: string; key: string; value: unknown; updated_at: string }> {
  if (!liveLinks || typeof liveLinks !== 'object' || Array.isArray(liveLinks)) return [];
  const obj = liveLinks as Record<string, unknown>;
  const upserts: Array<{ user_id: string; key: string; value: unknown; updated_at: string }> = [];
  for (const [shortKey, metaKey] of Object.entries(LIVE_LINK_SLOT_MAP)) {
    if (!(shortKey in obj)) continue;
    const raw = obj[shortKey];
    const val = typeof raw === 'string' ? raw.trim().slice(0, 500) : '';
    upserts.push({ user_id: studentId, key: metaKey, value: val || null, updated_at: nowIso });
  }
  return upserts;
}

// ── GET /admin/students/:id/full ───────────────────────────────────────────────
adminStudentsRouter.get('/admin/students/:id/full', async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const { data: student } = await sip().from('users').select(USER_FULL_COLS).eq('id', studentId).eq('role', 'student').maybeSingle();
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado' });

    const taskline = await resolveTaskline({ id: studentId, ciclo_type: student.ciclo_type as string, raiox_answers: student.raiox_answers as Record<string, unknown> | null });
    const prog = await buildProgress(studentId, student.ciclo_type as string);

    const [{ data: posts }, { data: trafficRows }, { data: debriefings }, { data: metaEntries }, { data: reports }, { data: proofs }] = await Promise.all([
      sip().from('posts').select('*').eq('user_id', studentId).order('date', { ascending: false }),
      sip().from('traffic').select('*').eq('user_id', studentId).order('date'),
      sip().from('debriefings').select('*').eq('user_id', studentId).order('seq').order('palestra_date', { nullsFirst: true }).order('created_at'),
      sip().from('meta').select('key, value').eq('user_id', studentId),
      sip().from('reports').select('*').eq('user_id', studentId).order('created_at', { ascending: false }),
      sip().from('task_proofs').select('*').eq('user_id', studentId).order('submitted_at', { ascending: false }),
    ]);
    const meta: Record<string, unknown> = {};
    for (const e of metaEntries || []) meta[e.key] = e.value;

    // Calendário do aluno — aplica os ajustes manuais de datas (overrides) que
    // o admin definiu na liberação, lendo de student_schedules (F6).
    const { data: schedRow } = await sip().from('student_schedules')
      .select('overrides').eq('user_id', studentId).maybeSingle();
    const calOverrides = (schedRow?.overrides && typeof schedRow.overrides === 'object' && !Array.isArray(schedRow.overrides))
      ? schedRow.overrides as Record<string, string> : {};
    const anchorDate = (meta.calendar_anchor as string | null) ?? (meta.data_palestra as string | null) ?? null;
    const calendarPayload = anchorDate && student.ciclo_type
      ? {
          anchor_date: anchorDate,
          milestones: await buildMilestones(anchorDate, student.ciclo_type as string, calOverrides),
        }
      : null;

    const debriefingRows = (debriefings ?? []) as Array<Record<string, unknown>>;
    const preferredDebriefing =
      debriefingRows.find((d) => d.source === 'ciclo' && d.ciclo_id === student.current_ciclo_id) ??
      debriefingRows.find((d) => d.source === 'historico') ??
      debriefingRows[0] ??
      null;

    return res.json({
      student: { id: student.id, name: student.name, email: student.email, ciclo_type: student.ciclo_type, taskline, phone: student.phone, city: student.city, onboarding_perfil: student.onboarding_perfil ?? null },
      stages: prog.stages, total: prog.total, completed: prog.completed,
      posts: posts ?? [], traffic: trafficRows ?? [], debriefing: preferredDebriefing, debriefings: debriefingRows,
      meta, reports: reports ?? [], proofs: proofs ?? [], calendar: calendarPayload,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/students/:id/posts ──────────────────────────────────────────────
// Conveniência: mesmo array `posts` exposto em /full.
adminStudentsRouter.get('/admin/students/:id/posts', async (req, res, next) => {
  try {
    const { data } = await sip().from('posts').select('*').eq('user_id', req.params.id).order('date', { ascending: false });
    return res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/students/:id/traffic ────────────────────────────────────────────
// Conveniência: mesmo array `traffic` exposto em /full.
adminStudentsRouter.get('/admin/students/:id/traffic', async (req, res, next) => {
  try {
    const { data } = await sip().from('traffic').select('*').eq('user_id', req.params.id).order('date');
    return res.json(data ?? []);
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/students/:id/proofs ─────────────────────────────────────────────
adminStudentsRouter.get('/admin/students/:id/proofs', async (req, res, next) => {
  try {
    const { data } = await sip().from('task_proofs').select('*').eq('user_id', req.params.id).order('submitted_at', { ascending: false });
    return res.json(data || []);
  } catch (err) {
    next(err);
  }
});

// ── PUT /admin/students/:id/proofs/:proofId ────────────────────────────────────
adminStudentsRouter.put('/admin/students/:id/proofs/:proofId', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const studentId = req.params.id;
    const proofId = req.params.proofId;
    const { status, admin_note } = (req.body ?? {}) as { status?: string; admin_note?: string };
    const updates: Record<string, unknown> = { reviewed_at: new Date().toISOString(), reviewed_by: userId };
    if (status) updates.status = status;
    if (admin_note !== undefined) updates.admin_note = admin_note;
    // Valida ownership ANTES do update (auditoria B11): mismatch entre :id e
    // :proofId resultava em 0 rows update + 200 silencioso.
    const { data: existing } = await sip().from('task_proofs')
      .select('id, user_id').eq('id', proofId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Comprovação não encontrada.' });
    if (existing.user_id !== studentId) {
      return res.status(400).json({ error: 'Comprovação não pertence a este aluno.' });
    }
    await sip().from('task_proofs').update(updates).eq('id', proofId).eq('user_id', studentId);
    const { data: updated } = await sip().from('task_proofs').select('*').eq('id', proofId).maybeSingle();
    await audit(userId, 'ACTION', 'task_proofs', proofId, {
      what: 'review_proof',
      student_id: studentId,
      status: status ?? null,
      admin_note_set: admin_note !== undefined,
    });
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/students/:id/schedule ───────────────────────────────────────────
// Devolve a row de sip.student_schedules + labels do template (aba Cronograma).
adminStudentsRouter.get('/admin/students/:id/schedule', async (req, res, next) => {
  try {
    const studentId = req.params.id;
    const { data: sched } = await sip().from('student_schedules').select('*').eq('user_id', studentId).maybeSingle();

    if (!sched) {
      const { data: u } = await sip().from('users').select('ciclo_type, approval_status').eq('id', studentId).maybeSingle();
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

// ── PATCH /admin/students/:id/schedule ─────────────────────────────────────────
// Aceita { anchor_date?, overrides? }. Reaplica buildMilestones e bumpa version.
adminStudentsRouter.patch('/admin/students/:id/schedule', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const studentId = req.params.id;
    const body = (req.body ?? {}) as { anchor_date?: string; overrides?: ScheduleOverrides };

    const { data: u } = await sip().from('users').select('ciclo_type, approval_status').eq('id', studentId).maybeSingle();
    if (!u) return res.status(404).json({ error: 'Aluno não encontrado' });
    if (!u.ciclo_type || (u.ciclo_type !== 'aurum' && u.ciclo_type !== 'seminario')) {
      return res.status(400).json({ error: 'Aluno sem ciclo_type definido.' });
    }

    const { data: existing } = await sip().from('student_schedules').select('*').eq('user_id', studentId).maybeSingle();

    const nextAnchor =
      typeof body.anchor_date === 'string' && body.anchor_date ? body.anchor_date : (existing?.anchor_date as string | undefined);
    if (!nextAnchor) {
      return res.status(400).json({ error: 'Sem anchor_date — informe a data do evento pra criar o cronograma.' });
    }

    const template = await getCicloTemplate(u.ciclo_type);
    const ruleErr = validateAnchorAgainstTemplate(nextAnchor, template, { allowPast: true });
    if (ruleErr) return res.status(400).json({ error: ruleErr });

    const nextOverrides: ScheduleOverrides =
      body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)
        ? body.overrides
        : ((existing?.overrides as ScheduleOverrides) ?? {});

    // Sanitiza overrides: descarta keys que não existem no template e valores
    // não-data. Evita admin (ou request malformado) escrever string qualquer.
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
    const nextVersion = ((existing?.version as number | undefined) ?? 0) + 1;

    const { error: upErr } = await sip().from('student_schedules').upsert({
      user_id: studentId,
      ciclo_type: u.ciclo_type,
      anchor_date: nextAnchor,
      milestones,
      overrides: safeOverrides,
      version: nextVersion,
      updated_at: nowIso,
    }, { onConflict: 'user_id' });
    if (upErr) {
      console.error('[PATCH schedule] erro:', upErr);
      return res.status(500).json({ error: 'Falha ao gravar cronograma.', detail: upErr.message });
    }

    // Mantém sip.meta.calendar_anchor em sincronia pra compat com /me/calendar.
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

// ── PATCH /admin/students/:id/assignment — atualiza ciclo e/ou monitor e meta ──
// Aceita { ciclo_type?, monitor_id?, padrinho?, data_palestra?, … }.
// Recusa aluno pending/rejected. (Registrada ANTES de PATCH /admin/students/:id.)
adminStudentsRouter.patch('/admin/students/:id/assignment', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    if (!adminRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const studentId = req.params.id;
    const body = (req.body ?? {}) as {
      ciclo_type?: string; is_platina?: boolean | string; monitor_id?: string; padrinho?: string; padrinho_contato?: string; data_palestra?: string;
      meta_vendas_pessoal?: number; investimento_previsto?: number; meta_captacao_leads?: number; obs_planejamento?: string;
      pasta_acesso?: string; live_links?: Record<string, string | null>;
    };
    const { ciclo_type, is_platina, monitor_id, padrinho, padrinho_contato, data_palestra,
      meta_vendas_pessoal, investimento_previsto, meta_captacao_leads, obs_planejamento,
      pasta_acesso, live_links } = body;

    const wantsCiclo = typeof ciclo_type === 'string';
    const wantsMonitor = typeof monitor_id === 'string';
    const wantsMeta = typeof padrinho === 'string' || typeof padrinho_contato === 'string' || typeof data_palestra === 'string'
      || meta_vendas_pessoal != null || investimento_previsto != null
      || meta_captacao_leads != null || typeof obs_planejamento === 'string'
      || typeof pasta_acesso === 'string'
      || (!!live_links && typeof live_links === 'object');
    const wantsPlatina = typeof is_platina === 'boolean' || typeof is_platina === 'string';
    if (!wantsCiclo && !wantsMonitor && !wantsMeta && !wantsPlatina) {
      return res.status(400).json({ error: 'Informe ciclo_type e/ou monitor_id.' });
    }
    if (wantsCiclo && !isValidCicloType(ciclo_type)) {
      return res.status(400).json({ error: 'ciclo_type inválido (use aurum ou seminario).' });
    }

    const { data: student, error: errStudent } = await sip().from('users')
      .select('id, role, approval_status, ciclo_type, monitor_id').eq('id', studentId).maybeSingle();
    if (errStudent) {
      console.error('[assignment] erro buscando aluno:', errStudent);
      return res.status(500).json({ error: 'Erro ao buscar aluno.', code: errStudent.code, detail: errStudent.message });
    }
    if (!student || student.role !== 'student') return res.status(404).json({ error: 'Aluno não encontrado.' });
    if (student.approval_status !== 'approved') {
      return res.status(409).json({
        error: 'Aluno não está aprovado. Use POST /approve para aprovar primeiro.',
        approval_status: student.approval_status,
      });
    }

    const updates: Record<string, unknown> = {};
    const oldCiclo = student.ciclo_type;
    const oldMonitor = student.monitor_id;

    if (wantsPlatina) {
      updates.is_platina = is_platina === true || is_platina === 'true';
    }

    if (wantsCiclo && ciclo_type !== oldCiclo) {
      const { data: cicloAtivo, error: errCiclo } = await sip().from('ciclos')
        .select('id').eq('ciclo_type', ciclo_type!).eq('status', 'active').maybeSingle();
      if (errCiclo) {
        console.error('[assignment] erro buscando ciclo ativo:', errCiclo);
        return res.status(500).json({ error: 'Erro ao buscar ciclo ativo.', code: errCiclo.code, detail: errCiclo.message });
      }
      updates.ciclo_type = ciclo_type;
      updates.current_ciclo_id = cicloAtivo?.id ?? null;
    }

    if (wantsMonitor && monitor_id !== oldMonitor) {
      if (!monitor_id) return res.status(400).json({ error: 'monitor_id não pode ser vazio (aluno aprovado precisa de monitor).' });
      const { data: monitor, error: errMonitor } = await sip().from('users')
        .select('id, role').eq('id', monitor_id).maybeSingle();
      if (errMonitor) {
        console.error('[assignment] erro buscando monitor:', errMonitor);
        return res.status(500).json({ error: 'Erro ao buscar monitor.', code: errMonitor.code, detail: errMonitor.message });
      }
      // Admin pode atuar como monitor — aceita ambos os papéis.
      if (!monitor || !['monitor', 'admin'].includes(monitor.role)) return res.status(400).json({ error: 'Monitor inválido.' });
      updates.monitor_id = monitor_id;
    }

    if (Object.keys(updates).length === 0 && !wantsMeta) {
      return res.json({ success: true, unchanged: true });
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await sip().from('users').update(updates).eq('id', studentId);
      if (error) {
        console.error('[assignment] erro atualizando user:', error, 'updates:', JSON.stringify(updates));
        return res.status(500).json({ error: 'Erro ao atualizar atribuição.', code: error.code, detail: error.message });
      }
    }

    // Salvar campos de planejamento como meta
    const nowIso = new Date().toISOString();
    const metaUpserts: { user_id: string; key: string; value: unknown; updated_at: string }[] = [];
    if (typeof padrinho === 'string' && padrinho.trim())
      metaUpserts.push({ user_id: studentId, key: 'padrinho', value: padrinho.trim().slice(0, 120), updated_at: nowIso });
    if (typeof padrinho_contato === 'string' && padrinho_contato.trim())
      metaUpserts.push({ user_id: studentId, key: 'padrinho_contato', value: padrinho_contato.trim().slice(0, 120), updated_at: nowIso });
    if (typeof data_palestra === 'string' && data_palestra) {
      metaUpserts.push({ user_id: studentId, key: 'data_palestra', value: data_palestra, updated_at: nowIso });
      metaUpserts.push({ user_id: studentId, key: 'calendar_anchor', value: data_palestra, updated_at: nowIso });
    }
    if (meta_vendas_pessoal != null)
      metaUpserts.push({ user_id: studentId, key: 'meta_vendas_pessoal', value: meta_vendas_pessoal, updated_at: nowIso });
    if (investimento_previsto != null)
      metaUpserts.push({ user_id: studentId, key: 'investimento_previsto', value: investimento_previsto, updated_at: nowIso });
    if (meta_captacao_leads != null)
      metaUpserts.push({ user_id: studentId, key: 'meta_captacao_leads', value: meta_captacao_leads, updated_at: nowIso });
    if (typeof obs_planejamento === 'string' && obs_planejamento.trim())
      metaUpserts.push({ user_id: studentId, key: 'obs_planejamento', value: obs_planejamento.trim().slice(0, 500), updated_at: nowIso });
    if (typeof pasta_acesso === 'string' && pasta_acesso.trim())
      metaUpserts.push({ user_id: studentId, key: 'pasta_acesso', value: pasta_acesso.trim().slice(0, 500), updated_at: nowIso });
    metaUpserts.push(...liveLinksToMetaUpserts(live_links, studentId, nowIso));
    if (metaUpserts.length > 0)
      await sip().from('meta').upsert(metaUpserts, { onConflict: 'user_id,key' });

    await audit(userId, 'ACTION', 'users', studentId, {
      what: 'update_assignment',
      old_ciclo: oldCiclo, new_ciclo: updates.ciclo_type ?? oldCiclo,
      old_monitor_id: oldMonitor, new_monitor_id: updates.monitor_id ?? oldMonitor,
      padrinho: padrinho ?? null, data_palestra: data_palestra ?? null,
    });
    return res.json({ success: true, updates });
  } catch (err) {
    next(err);
  }
});

// ── PUT /admin/students/:id/monitor — DEPRECATED ───────────────────────────────
// Substituído por PATCH /assignment (aprovado) ou POST /approve (pendente).
adminStudentsRouter.put('/admin/students/:id/monitor', (_req, res) => {
  return res.status(410).json({
    error: 'Endpoint descontinuado. Use POST /approve para aluno pendente ou PATCH /assignment para aprovado.',
    deprecated: true,
    new_endpoints: { approve: '/admin/students/:id/approve', assignment: '/admin/students/:id/assignment' },
  });
});

// ── PATCH /admin/students/:id — editar dados pessoais ──────────────────────────
adminStudentsRouter.patch('/admin/students/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const studentId = req.params.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { data: student } = await sip().from('users')
      .select('id, role').eq('id', studentId).maybeSingle();
    if (!student || student.role !== 'student') return res.status(404).json({ error: 'Aluno não encontrado.' });

    const updates: Record<string, unknown> = {};
    const sanit = sanitizeText;

    if ('name' in body) {
      const v = sanit(body.name, 100);
      if (!v || v.length < 3 || !v.includes(' ')) return res.status(400).json({ error: 'Nome inválido.' });
      if (!/^[\p{L}][\p{L}\s'.\-]{1,99}$/u.test(v)) return res.status(400).json({ error: 'Nome contém caracteres inválidos.' });
      updates.name = v;
    }
    if ('phone' in body) {
      const raw = sanit(body.phone, 24) ?? '';
      if (!raw) updates.phone = null;
      else {
        const digits = raw.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 11) return res.status(400).json({ error: 'Telefone deve ter 10 ou 11 dígitos.' });
        updates.phone = digits.length === 11
          ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
          : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
      }
    }
    if ('city' in body) {
      const v = sanit(body.city, 80);
      if (!v) updates.city = null;
      else {
        if (!CITY_RE.test(v)) return res.status(400).json({ error: 'Cidade no formato: Cidade / UF' });
        updates.city = v.replace(/\/\s*([a-zA-Z]{2})\s*$/, (_m, uf) => '/ ' + uf.toUpperCase());
      }
    }
    if ('profissao' in body) {
      const v = sanit(body.profissao, 80);
      if (!v) updates.profissao = null;
      else {
        if (!PROFISSAO_RE.test(v)) return res.status(400).json({ error: 'Profissão contém caracteres inválidos.' });
        updates.profissao = v;
      }
    }
    if ('turma_aurum' in body) {
      const v = (sanit(body.turma_aurum, 8) ?? '').toUpperCase();
      if (!v) updates.turma_aurum = null;
      else {
        if (!TURMA_AURUM_RE.test(v)) return res.status(400).json({ error: 'Turma Aurum inválida (A1 a A9).' });
        updates.turma_aurum = v;
      }
    }
    if ('is_platina' in body) {
      updates.is_platina = body.is_platina === true || body.is_platina === 'true';
    }
    if ('turma_thb' in body) {
      const v = (sanit(body.turma_thb, 8) ?? '').toUpperCase();
      if (!v) updates.turma_thb = null;
      else {
        if (!TURMA_THB_RE.test(v)) return res.status(400).json({ error: 'Turma THB inválida (T1 a T38).' });
        updates.turma_thb = v;
      }
    }
    if ('email' in body) {
      const v = (sanit(body.email, 120) ?? '').toLowerCase();
      if (!v || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(v)) return res.status(400).json({ error: 'E-mail inválido.' });
      const { data: dup } = await sip().from('users').select('id').eq('email', v).neq('id', studentId).maybeSingle();
      if (dup) return res.status(409).json({ error: 'Já existe outro aluno com esse e-mail.' });
      updates.email = v;
    }
    if ('interesse_ciclo' in body) {
      const v = body.interesse_ciclo;
      if (v === null || v === '') updates.interesse_ciclo = null;
      else if (typeof v === 'string' && ['palestra', 'seminario'].includes(v)) updates.interesse_ciclo = v;
      else return res.status(400).json({ error: 'interesse_ciclo inválido.' });
    }
    if ('nivel' in body) {
      const v = body.nivel;
      const VALID: Array<string | null> = [null, '', 'Ouro', 'Platina', 'Diamante', 'Diamante Vermelho'];
      if (!VALID.includes(v as string | null)) return res.status(400).json({ error: 'Nível inválido.' });
      updates.nivel = (v === '' || v === null) ? null : v;
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada para atualizar.' });

    const { error } = await sip().from('users').update(updates).eq('id', studentId);
    if (error) return res.status(500).json({ error: 'Erro ao salvar.' });
    await audit(userId, 'ACTION', 'users', studentId, { what: 'edit_student', fields: Object.keys(updates) });
    return res.json({ success: true, updated: updates });
  } catch (err) {
    next(err);
  }
});
