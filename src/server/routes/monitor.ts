// Monitor — portal do monitor (porte de handlers/monitor.ts + GET /monitor/reports
// de handlers/chamados.ts). Visão do papel "monitor" sobre os alunos sob sua
// responsabilidade, sempre filtrando por `monitor_id = userId` para isolar dados
// entre monitores. O gate de montagem (monitorGate) garante role monitor|admin.
//
// Endpoints:
//   GET /monitor/students          → listagem com progresso + date_change_requested
//   GET /monitor/students/:id/full → ficha completa de um aluno do próprio monitor
//       (shape do front: { student, checklist:{stages}, posts, traffic:{rows,totals}, debriefing, meta })
//   GET /monitor/reports           → chamados do monitor (filtro opcional por status)
import { Router } from 'express';
import { sip } from '../db.js';
import { resolveTaskline } from '../domain/taskline.js';
import { buildProgress } from '../domain/progress.js';

export const monitorRouter = Router();

// USER_FULL_COLS: admin/monitor visualiza ficha do aluno; tudo exceto hash e auth_id.
// (cópia do legado handlers/_shared.ts)
const USER_FULL_COLS =
  'id, name, email, role, ciclo_type, current_ciclo_id, monitor_id, onboarding_done, phone, city, self_registered, profissao, tempo_carreira, lancamentos_anteriores, faturamento_atual, instagram_handle, fez_curso_thb_antes, is_socio, socio_of, created_at, raiox_answers, raiox_score, raiox_max_score, raiox_submitted_at, approval_status, approval_decided_at, approval_decided_by, approval_note, interesse_ciclo, turma_aurum, is_platina, turma_thb, onboarding_perfil, must_change_password, password_changed_at, nivel';

// ── GET /monitor/students ──────────────────────────────────────────────────
monitorRouter.get('/monitor/students', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { data: students } = await sip()
      .from('users')
      .select('id, name, email, ciclo_type')
      .eq('role', 'student')
      .eq('monitor_id', userId);
    const result = await Promise.all(
      (students || []).map(async (student: Record<string, unknown>) => {
        // Taskline-aware: usa buildProgress (filtra ciclo_type + taskline e conta
        // só tarefas do aluno, owner != equipe) p/ o percentual bater com a visão
        // do próprio aluno.
        const taskline = await resolveTaskline({
          id: student.id as string,
          ciclo_type: student.ciclo_type as string,
        });
        const [prog, { data: metaEntries }] = await Promise.all([
          buildProgress(student.id as string, student.ciclo_type as string, taskline),
          sip().from('meta').select('key, value').eq('user_id', student.id as string),
        ]);
        const meta: Record<string, unknown> = {};
        for (const e of metaEntries || []) meta[e.key] = e.value;
        // current_stage: etapa atual = primeira não concluída (ou a última, se
        // tudo concluído). Alimenta a "Distribuição por etapa" do Resumo do front
        // — no legado este campo não vinha e o gráfico ficava todo no bucket "—".
        const stageList = prog.stages as Array<{ stage_number?: number; completed?: boolean }>;
        const firstIncomplete = stageList.find((st) => !st.completed);
        const lastStage = stageList[stageList.length - 1];
        const currentStage = firstIncomplete?.stage_number ?? lastStage?.stage_number ?? null;
        return {
          id: student.id,
          name: student.name,
          email: student.email,
          ciclo_type: student.ciclo_type,
          completed_tasks: prog.completed,
          total_tasks: prog.total,
          progress_percent: prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0,
          current_stage: currentStage,
          date_change_requested:
            meta.date_change_requested === true || meta.date_change_requested === 'true',
        };
      }),
    );
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /monitor/students/:id/full ─────────────────────────────────────────
monitorRouter.get('/monitor/students/:id/full', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { data: student } = await sip()
      .from('users')
      .select(USER_FULL_COLS)
      .eq('id', req.params.id)
      .eq('role', 'student')
      .eq('monitor_id', userId)
      .maybeSingle();
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado ou não associado a você' });
    const taskline = await resolveTaskline(student);
    const prog = await buildProgress(student.id, student.ciclo_type, taskline);
    const [{ data: posts }, { data: trafficRows }, { data: debriefings }, { data: metaEntries }] =
      await Promise.all([
        sip().from('posts').select('*').eq('user_id', student.id).order('date', { ascending: false }),
        sip().from('traffic').select('*').eq('user_id', student.id).order('date'),
        sip()
          .from('debriefings')
          .select('*')
          .eq('user_id', student.id)
          .order('seq')
          .order('palestra_date', { nullsFirst: true })
          .order('created_at'),
        sip().from('meta').select('key, value').eq('user_id', student.id),
      ]);
    const meta: Record<string, unknown> = {};
    for (const e of metaEntries || []) meta[e.key] = e.value;

    // Traffic: front (monitor.html → StudentModal) consome traffic.{rows,totals}.
    // O legado expõe rows brutas (cada uma já com cpl/ctr) + totais agregados.
    const trafRows = (trafficRows ?? []) as Array<Record<string, number | null>>;
    const tot = trafRows.reduce<{
      spent: number;
      impressions: number;
      clicks: number;
      leads_builderall: number;
    }>(
      (acc, r) => ({
        spent: acc.spent + (Number(r.spent) || 0),
        impressions: acc.impressions + (Number(r.impressions) || 0),
        clicks: acc.clicks + (Number(r.clicks) || 0),
        leads_builderall: acc.leads_builderall + (Number(r.leads_builderall) || 0),
      }),
      { spent: 0, impressions: 0, clicks: 0, leads_builderall: 0 },
    );
    const traffic = {
      rows: trafRows,
      totals: {
        spent: tot.spent || null,
        leads_builderall: tot.leads_builderall || null,
        cpl: tot.leads_builderall > 0 ? tot.spent / tot.leads_builderall : null,
        ctr: tot.impressions > 0 ? (tot.clicks / tot.impressions) * 100 : null,
      },
    };

    // Debriefing: front consome um único bloco (com fallback payload ?? sdb).
    // Prioriza o do ciclo atual; depois histórico; depois o primeiro disponível.
    const debriefingRows = (debriefings ?? []) as Array<Record<string, unknown>>;
    const debriefing =
      debriefingRows.find(
        (d) => d.source === 'ciclo' && d.ciclo_id === student.current_ciclo_id,
      ) ??
      debriefingRows.find((d) => d.source === 'historico') ??
      debriefingRows[0] ??
      null;

    return res.json({
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        ciclo_type: student.ciclo_type,
        completed_tasks: prog.completed,
        total_tasks: prog.total,
        onboarding_perfil: student.onboarding_perfil ?? null,
      },
      // Front lê full.checklist.stages; mantemos stages/total/completed top-level
      // por compat com o legado Edge handler.
      checklist: { stages: prog.stages },
      stages: prog.stages,
      total: prog.total,
      completed: prog.completed,
      posts: posts ?? [],
      traffic,
      debriefing,
      meta,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /monitor/reports ───────────────────────────────────────────────────
// Porte de handlers/chamados.ts: lista chamados do monitor, filtro opcional por
// status (?status=...). Ordena por last_message_at asc (nullsFirst).
monitorRouter.get('/monitor/reports', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;

    let q = sip()
      .from('reports')
      .select(
        'id, user_name, user_email, kind, status, created_at, last_message_at, last_message_by, monitor_id',
      )
      .eq('monitor_id', userId)
      .order('last_message_at', { ascending: true, nullsFirst: true });

    if (statusFilter) q = q.eq('status', statusFilter);

    const { data } = await q;
    return res.json({ items: data || [] });
  } catch (err) {
    next(err);
  }
});

// ── PUT /admin/students/:id/approve-date ───────────────────────────────────
// Contrato legado (public/monitor.html + modal-aluno-actions.js): o monitor/admin
// APROVA o pedido de mudança de data do aluno. Limpa a flag de meta
// `date_change_requested` e devolve { success, anchor_date } (o front esconde o
// banner e mostra "Mudança de data aprovada").
//
// Montado em monitorRouter (registrado ANTES do adminGate em index.ts), portanto
// acessível por role monitor|admin — embora o path seja /admin/* — sem ferir o
// adminGate. O monitor só pode agir sobre alunos do próprio monitor_id; admin
// pode agir sobre qualquer aluno.
monitorRouter.put('/admin/students/:id/approve-date', async (req, res, next) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.id;
    const studentId = req.params.id;

    let q = sip()
      .from('users')
      .select('id, monitor_id, role')
      .eq('id', studentId)
      .eq('role', 'student');
    if (role === 'monitor') q = q.eq('monitor_id', userId);
    const { data: student } = await q.maybeSingle();
    if (!student) {
      return res.status(404).json({ error: 'Aluno não encontrado ou não associado a você.' });
    }

    // Limpa o pedido de mudança de data (flag em meta).
    const { data: flagRow } = await sip()
      .from('meta')
      .select('id')
      .eq('user_id', studentId)
      .eq('key', 'date_change_requested')
      .maybeSingle();
    if (flagRow) {
      const { error: updErr } = await sip()
        .from('meta')
        .update({ value: false, updated_at: new Date().toISOString() })
        .eq('id', flagRow.id);
      if (updErr) {
        console.error('[approve-date] erro limpando flag:', updErr);
        return res.status(500).json({ error: 'Falha ao aprovar mudança de data.', detail: updErr.message });
      }
    }

    // anchor_date atual (calendar_anchor) — devolvido ao front para refletir na lista.
    const { data: anchorRow } = await sip()
      .from('meta')
      .select('value')
      .eq('user_id', studentId)
      .eq('key', 'calendar_anchor')
      .maybeSingle();
    const anchorDate = (anchorRow?.value as string | null) ?? null;

    return res.json({ success: true, anchor_date: anchorDate });
  } catch (err) {
    next(err);
  }
});
