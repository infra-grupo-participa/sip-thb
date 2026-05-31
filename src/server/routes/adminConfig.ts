// Admin — programa/métricas (porte de handlers/admin-config.ts + admin-traffic.ts
// + admin-misc.ts). Concentra:
//   - Stages/Tasks CRUD + reorder
//   - Superdebriefings
//   - Ciclos CRUD + activate/close + history
//   - Posts (cross-aluno), Tráfego (dashboard), Reports (chamados)
//   - ClickUp handoffs (listagem + retry single/bulk)
//
// GET/POST /admin/settings já vive em routes/admin.ts — NÃO duplicado aqui.
// adminGate é aplicado pelo integrador (app.use('/api/admin', adminGate)).
import { Router } from 'express';
import { sip } from '../db.js';
import { audit } from '../domain/audit.js';
import { isAurum, isSeminario } from '../domain/ciclo.js';
import { buildTasklineTotals, resolveTasklinesForStudents, tasklineTotalFor } from '../domain/adminAggregates.js';
import { parsePagination, applyCursor, buildPaginated } from '../domain/cursor.js';
import { sanitizePlatform, PLATFORM_LABELS, type TrafficPlatform } from '../domain/traffic.js';
import { dispatchClickUp, type ClickUpDispatchResult } from '../services/clickup.js';
import { env } from '../env.js';

export const adminConfigRouter = Router();

// ════════════════════════════════════════════════════════════════════════════
// STAGES
// ════════════════════════════════════════════════════════════════════════════

// ── GET /admin/stages ─────────────────────────────────────────────────────────
adminConfigRouter.get('/admin/stages', async (req, res, next) => {
  try {
    const cicloFilter = typeof req.query.ciclo_type === 'string' ? req.query.ciclo_type : null;
    let q = sip().from('stages').select('*').order('ciclo_type').order('stage_number');
    if (cicloFilter) q = q.eq('ciclo_type', cicloFilter);
    const { data: stages } = await q;
    if (!stages || stages.length === 0) return res.json([]);
    const stageIds = stages.map((s: { id: string }) => s.id);
    const { data: taskCounts } = await sip().from('tasks').select('stage_id').in('stage_id', stageIds).eq('active', true);
    const countMap: Record<string, number> = {};
    for (const t of taskCounts || []) countMap[t.stage_id] = (countMap[t.stage_id] || 0) + 1;
    return res.json(stages.map((s: { id: string }) => ({ ...s, task_count: countMap[s.id] ?? 0 })));
  } catch (err) {
    next(err);
  }
});

// ── PUT /admin/stages/:id ──────────────────────────────────────────────────────
adminConfigRouter.put('/admin/stages/:id', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const k of ['title', 'description']) if (k in body) updates[k] = body[k];
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    await sip().from('stages').update(updates).eq('id', req.params.id);
    const { data: updated } = await sip().from('stages').select('*').eq('id', req.params.id).maybeSingle();
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/stages/:id/reorder-tasks ────────────────────────────────────────
adminConfigRouter.post('/admin/stages/:id/reorder-tasks', async (req, res, next) => {
  try {
    const { task_ids } = (req.body ?? {}) as { task_ids?: string[] };
    if (!Array.isArray(task_ids)) return res.status(400).json({ error: 'task_ids precisa ser array' });
    const stageId = req.params.id;
    await Promise.all(
      task_ids.map((id: string, i: number) => sip().from('tasks').update({ order_index: i }).eq('id', id).eq('stage_id', stageId)),
    );
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TASKS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /admin/tasks ────────────────────────────────────────────────────────────
adminConfigRouter.get('/admin/tasks', async (req, res, next) => {
  try {
    const cicloFilter = typeof req.query.ciclo_type === 'string' ? req.query.ciclo_type : null;
    const stageFilter = typeof req.query.stage_id === 'string' ? req.query.stage_id : null;
    let q = sip().from('tasks').select('*').order('ciclo_type').order('stage_number').order('order_index');
    if (cicloFilter) q = q.eq('ciclo_type', cicloFilter);
    if (stageFilter) q = q.eq('stage_id', stageFilter);
    const { data } = await q;
    return res.json(data || []);
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/tasks ─────────────────────────────────────────────────────────
adminConfigRouter.post('/admin/tasks', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (!b.stage_id || !b.title || !b.category) return res.status(400).json({ error: 'stage_id, title e category são obrigatórios' });
    const { data: stage } = await sip().from('stages').select('*').eq('id', b.stage_id as string).maybeSingle();
    if (!stage) return res.status(404).json({ error: 'Etapa não encontrada' });
    const { data: existing } = await sip()
      .from('tasks')
      .select('order_index')
      .eq('stage_id', b.stage_id as string)
      .order('order_index', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: inserted } = await sip()
      .from('tasks')
      .insert({
        stage_id: b.stage_id,
        ciclo_type: stage.ciclo_type,
        stage_number: stage.stage_number,
        category: b.category,
        title: b.title,
        tutorial_url: b.tutorial_url || null,
        why_text: b.why_text || null,
        mission: b.mission || null,
        auto_trigger: b.auto_trigger || null,
        order_index: (existing?.order_index ?? -1) + 1,
      })
      .select()
      .single();
    if (inserted) await audit(userId, 'ACTION', 'tasks', inserted.id, { what: 'create_task', ciclo_type: stage.ciclo_type, stage_id: b.stage_id, title: b.title });
    return res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

// ── PUT /admin/tasks/:id ────────────────────────────────────────────────────────
adminConfigRouter.put('/admin/tasks/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const k of ['title', 'category', 'tutorial_url', 'why_text', 'mission', 'order_index']) if (k in body) updates[k] = body[k];
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    await sip().from('tasks').update(updates).eq('id', req.params.id);
    const { data: updated } = await sip().from('tasks').select('*').eq('id', req.params.id).maybeSingle();
    await audit(userId, 'ACTION', 'tasks', req.params.id, { what: 'update_task', keys: Object.keys(updates) });
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /admin/tasks/:id ───────────────────────────────────────────────────
adminConfigRouter.delete('/admin/tasks/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const taskId = req.params.id;
    // Auditoria 2026-05-19 (B17): registra delete antes de remover (afeta
    // progresso de TODOS os alunos do ciclo).
    const { data: pre } = await sip().from('tasks').select('title, ciclo_type, stage_id').eq('id', taskId).maybeSingle();
    await sip().from('progress').delete().eq('task_id', taskId);
    await sip().from('tasks').delete().eq('id', taskId);
    await audit(userId, 'ACTION', 'tasks', taskId, { what: 'delete_task', pre: pre ?? null });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// SUPERDEBRIEFINGS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /admin/superdebriefings ─────────────────────────────────────────────────
adminConfigRouter.get('/admin/superdebriefings', async (_req, res, next) => {
  try {
    const { data: docs } = await sip().from('debriefings').select('*, users!inner(name, email)').order('created_at', { ascending: false });
    return res.json(
      (docs || []).map((d: Record<string, { name?: string; email?: string }>) => ({
        ...d,
        student_name: d.users?.name ?? '—',
        student_email: d.users?.email ?? '—',
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CICLOS
// ════════════════════════════════════════════════════════════════════════════

// ── GET /admin/ciclos — versão enriquecida (fase_atual, progresso_temporal) ──────
adminConfigRouter.get('/admin/ciclos', async (_req, res, next) => {
  try {
    const [{ data: ciclos }, { data: students }] = await Promise.all([
      sip().from('ciclos').select('*').order('ciclo_type').order('numero'),
      sip().from('users').select('id, current_ciclo_id').eq('role', 'student'),
    ]);

    const countByCiclo: Record<string, number> = {};
    for (const s of students || []) {
      if (s.current_ciclo_id) countByCiclo[s.current_ciclo_id] = (countByCiclo[s.current_ciclo_id] || 0) + 1;
    }

    const today = new Date();
    const enriched = (ciclos || []).map((c: Record<string, unknown>) => {
      const start = c.data_inicio ? new Date(c.data_inicio as string) : null;
      const end = c.data_fim ? new Date(c.data_fim as string) : null;
      let progresso_temporal = 0;
      let dias_restantes: number | null = null;
      if (start && end && c.status === 'active') {
        const total = end.getTime() - start.getTime();
        const elapsed = today.getTime() - start.getTime();
        progresso_temporal = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
        dias_restantes = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000));
      }

      let fase_atual = 'aguardando';
      if (c.status === 'active' && start) {
        const d = today;
        const after = (f: unknown) => f && d >= new Date(f as string);
        const before = (f: unknown) => f && d <= new Date(f as string);
        if (after(c.remarketing_inicio) && before(c.remarketing_fim)) fase_atual = 'remarketing';
        else if (after(c.fechamento_carrinho) && before(c.remarketing_inicio || c.data_fim)) fase_atual = 'carrinho';
        else if (after(c.evento_dia_1) && before(c.evento_dia_final)) fase_atual = 'evento';
        else if (after(c.lembrete_inicio) && before(c.lembrete_fim)) fase_atual = 'lembrete';
        else if (after(c.captacao_inicio) && before(c.captacao_fim)) fase_atual = 'captacao';
        else if (after(c.campanha_teste_inicio) && before(c.campanha_teste_fim)) fase_atual = 'teste';
        else if (after(start)) fase_atual = 'em_andamento';
      } else if (c.status === 'closed') {
        fase_atual = 'encerrado';
      } else if (c.status === 'pending') {
        fase_atual = 'aguardando';
      }

      return { ...c, student_count: countByCiclo[c.id as string] || 0, progresso_temporal, dias_restantes, fase_atual };
    });

    return res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/ciclos ──────────────────────────────────────────────────────────
adminConfigRouter.post('/admin/ciclos', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Ciclo (entidade) não tem Platina — só user tem. Aqui o label é só
    // Aurum/Diamante. Mantém fallback antigo (body sem ciclo_type → "Diamante").
    const labelCiclo = isAurum(body) ? 'Aurum' : 'Diamante';
    const nome = body.nome || `${labelCiclo} — ${body.numero}º Ciclo`;
    const { data: inserted } = await sip()
      .from('ciclos')
      .insert({ ...body, nome, status: body.status || 'pending' })
      .select()
      .single();
    return res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /admin/ciclos/:id ──────────────────────────────────────────────────────
adminConfigRouter.patch('/admin/ciclos/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    await sip().from('ciclos').update(body).eq('id', req.params.id);
    const { data: updated } = await sip().from('ciclos').select('*').eq('id', req.params.id).maybeSingle();
    await audit(userId, 'ACTION', 'ciclos', req.params.id, { what: 'edit_ciclo', fields: Object.keys(body || {}) });
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /admin/ciclos/:id ──────────────────────────────────────────────────────
adminConfigRouter.delete('/admin/ciclos/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const cicloId = req.params.id;
    const { data: linked } = await sip().from('users').select('id').eq('current_ciclo_id', cicloId).limit(1);
    if (linked && linked.length > 0) return res.status(400).json({ error: 'Ciclo possui alunos vinculados. Remova-os antes de excluir.' });
    await sip().from('ciclos').delete().eq('id', cicloId);
    await audit(userId, 'ACTION', 'ciclos', cicloId, { what: 'delete_ciclo' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/ciclos/:id/activate ────────────────────────────────────────────
adminConfigRouter.post('/admin/ciclos/:id/activate', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const cicloId = req.params.id;
    const { data: ciclo } = await sip().from('ciclos').select('*').eq('id', cicloId).maybeSingle();
    if (!ciclo) return res.status(404).json({ error: 'Ciclo não encontrado' });
    await sip().from('ciclos').update({ status: 'active' }).eq('id', cicloId);
    await audit(userId, 'ACTION', 'ciclos', cicloId, { what: 'activate_ciclo', ciclo_type: ciclo.ciclo_type, numero: ciclo.numero });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/ciclos/:id/close ────────────────────────────────────────────────
adminConfigRouter.post('/admin/ciclos/:id/close', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const cicloId = req.params.id;
    const { data: ciclo } = await sip().from('ciclos').select('*').eq('id', cicloId).maybeSingle();
    if (!ciclo) return res.status(404).json({ error: 'Ciclo não encontrado' });
    if (ciclo.status !== 'active') return res.status(400).json({ error: 'Apenas ciclos ativos podem ser encerrados' });

    const { data: cicloStudents } = await sip().from('users').select('id, ciclo_type').eq('current_ciclo_id', cicloId);
    const students = (cicloStudents || []) as Array<{ id: string; ciclo_type: string }>;
    const studentIds = students.map((s) => s.id);

    const closedAt = new Date().toISOString();

    type Row = Record<string, unknown>;
    const [{ data: allProgress }, { data: allPosts }, { data: allTraffic }, { data: allSdb }] =
      studentIds.length === 0
        ? [{ data: [] as Row[] }, { data: [] as Row[] }, { data: [] as Row[] }, { data: [] as Row[] }]
        : await Promise.all([
            sip().from('progress').select('user_id, task_id, completed').in('user_id', studentIds),
            sip().from('posts').select('user_id').in('user_id', studentIds),
            sip().from('traffic').select('user_id, spent, leads_meta, leads_builderall').in('user_id', studentIds),
            sip().from('debriefings').select('*').in('user_id', studentIds),
          ]);

    const tasklineTotals = await buildTasklineTotals();
    const tasklineByStudent = await resolveTasklinesForStudents(students as Array<{ id: string; ciclo_type?: string | null }>);

    const progressByUser: Record<string, Row[]> = {};
    for (const p of (allProgress || []) as Row[]) {
      const uid = p.user_id as string;
      if (!progressByUser[uid]) progressByUser[uid] = [];
      progressByUser[uid].push(p);
    }
    const postCountByUser: Record<string, number> = {};
    for (const p of (allPosts || []) as Row[]) postCountByUser[p.user_id as string] = (postCountByUser[p.user_id as string] || 0) + 1;
    const trafficByUser: Record<string, Row[]> = {};
    for (const t of (allTraffic || []) as Row[]) {
      const uid = t.user_id as string;
      if (!trafficByUser[uid]) trafficByUser[uid] = [];
      trafficByUser[uid].push(t);
    }
    // Snapshot do debriefing DESTE ciclo. Prefere a linha do ciclo sendo
    // encerrado; senão cai na linha source='ciclo'.
    const sdbByUser: Record<string, Row> = {};
    for (const s of (allSdb || []) as Row[]) {
      const uid = s.user_id as string;
      const isThisCiclo = s.ciclo_id === cicloId;
      const isCicloSource = s.source === 'ciclo';
      const cur = sdbByUser[uid];
      if (!cur) {
        sdbByUser[uid] = s;
        continue;
      }
      if (isThisCiclo) {
        sdbByUser[uid] = s;
        continue;
      }
      if (cur.ciclo_id === cicloId) continue;
      if (isCicloSource && cur.source !== 'ciclo') sdbByUser[uid] = s;
    }

    const historyRows = students.map((student) => {
      const totalTasks = tasklineTotalFor(tasklineTotals, student.ciclo_type, tasklineByStudent.get(student.id));
      const prog = progressByUser[student.id] || [];
      const completedTasks = prog.filter((p: Row) => p.completed).length;
      const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
      const totalPosts = postCountByUser[student.id] || 0;
      const traffic = trafficByUser[student.id] || [];
      const totalSpent = traffic.reduce((s: number, r: Row) => s + (Number(r.spent) || 0), 0);
      const totalLeads = traffic.reduce((s: number, r: Row) => s + (Number(r.leads_meta) || 0) + (Number(r.leads_builderall) || 0), 0);
      const sdb = sdbByUser[student.id] ?? null;
      return {
        user_id: student.id,
        ciclo_id: cicloId,
        ciclo_type: ciclo.ciclo_type,
        ciclo_numero: ciclo.numero,
        ciclo_nome: ciclo.nome,
        data_inicio: ciclo.data_inicio,
        data_fim: ciclo.data_fim,
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        progress_percent: progressPercent,
        total_posts: totalPosts,
        total_spent: totalSpent,
        total_leads: totalLeads,
        sdb_submitted: !!sdb?.submitted_at,
        sdb_vendas: sdb?.qtd_vendas ?? null,
        sdb_faturamento: sdb?.faturamento_total ?? null,
        sdb_roi: sdb?.roi ?? null,
        sdb_nota: sdb?.nota ?? null,
        debriefing_snapshot: sdb ?? null,
        closed_at: closedAt,
      };
    });

    if (historyRows.length > 0) {
      await sip().from('ciclo_history').insert(historyRows);
    }
    const studentsArchived = historyRows.length;

    await sip().from('ciclos').update({ status: 'closed', closed_at: closedAt }).eq('id', cicloId);
    await audit(userId, 'ACTION', 'ciclos', cicloId, {
      what: 'close_ciclo',
      ciclo_type: ciclo.ciclo_type,
      numero: ciclo.numero,
      students_archived: studentsArchived,
    });
    return res.json({ success: true, students_archived: studentsArchived });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/ciclos/:id/history ──────────────────────────────────────────────
adminConfigRouter.get('/admin/ciclos/:id/history', async (req, res, next) => {
  try {
    const cicloId = req.params.id;
    const { data: rows } = await sip()
      .from('ciclo_history')
      .select('*, sip_users:user_id(name, email)')
      .eq('ciclo_id', cicloId)
      .order('progress_percent', { ascending: false });
    return res.json(
      (rows || []).map((h: Record<string, unknown> & { sip_users?: { name?: string; email?: string } | null }) => ({
        id: h.id,
        user_id: h.user_id,
        student_name: h.sip_users?.name ?? '—',
        student_email: h.sip_users?.email ?? '—',
        total_tasks: h.total_tasks,
        completed_tasks: h.completed_tasks,
        progress_percent: h.progress_percent,
        total_posts: h.total_posts,
        total_spent: h.total_spent,
        total_leads: h.total_leads,
        sdb_submitted: h.sdb_submitted,
        sdb_vendas: h.sdb_vendas,
        sdb_faturamento: h.sdb_faturamento,
        sdb_roi: h.sdb_roi,
        sdb_nota: h.sdb_nota,
        closed_at: h.closed_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POSTS (consulta cross-aluno)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /admin/posts ────────────────────────────────────────────────────────────
adminConfigRouter.get('/admin/posts', async (req, res, next) => {
  try {
    const studentId = typeof req.query.student_id === 'string' ? req.query.student_id : null;
    const platform = typeof req.query.platform === 'string' ? req.query.platform : null;
    const fromDate = typeof req.query.from === 'string' ? req.query.from : null; // YYYY-MM-DD inclusive
    const toDate = typeof req.query.to === 'string' ? req.query.to : null; // YYYY-MM-DD inclusive
    let q = sip().from('posts').select('*, sip_users:user_id(name, email)').order('date', { ascending: false });
    if (studentId) q = q.eq('user_id', studentId);
    if (platform) q = q.eq('platform', platform);
    if (fromDate) q = q.gte('date', fromDate);
    if (toDate) q = q.lte('date', toDate);
    const { data: rows } = await q;
    return res.json(
      (rows || []).map((p: Record<string, unknown>) => ({
        id: p.id,
        user_id: p.user_id,
        date: p.date,
        platform: p.platform,
        format: p.format,
        link: p.link,
        created_at: p.created_at,
        student_name: (p.sip_users as { name?: string } | null)?.name ?? '—',
        student_email: (p.sip_users as { email?: string } | null)?.email ?? '—',
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TRÁFEGO PAGO (dashboard agregado)
// ════════════════════════════════════════════════════════════════════════════

type TrafficRow = {
  id: string;
  user_id: string;
  ciclo_type: string;
  date: string;
  platform: string | null;
  spent: number | null;
  impressions: number | null;
  clicks: number | null;
  page_views: number | null;
  leads_meta: number | null;
  leads_builderall: number | null;
  leads_whatsapp: number | null;
  vendas_dia: number | null;
  faturamento_dia: number | null;
};

type Totals = {
  spent: number;
  impressions: number;
  clicks: number;
  page_views: number;
  leads_builderall: number;
  vendas: number;
  faturamento: number;
};

const zeroTotals = (): Totals => ({
  spent: 0,
  impressions: 0,
  clicks: 0,
  page_views: 0,
  leads_builderall: 0,
  vendas: 0,
  faturamento: 0,
});

const addRow = (acc: Totals, r: TrafficRow): Totals => ({
  spent: acc.spent + (r.spent || 0),
  impressions: acc.impressions + (r.impressions || 0),
  clicks: acc.clicks + (r.clicks || 0),
  page_views: acc.page_views + (r.page_views || 0),
  leads_builderall: acc.leads_builderall + (r.leads_builderall || 0),
  vendas: acc.vendas + (r.vendas_dia || 0),
  faturamento: acc.faturamento + (r.faturamento_dia || 0),
});

const kpisOf = (t: Totals) => ({
  ...t,
  cpl: t.leads_builderall > 0 ? t.spent / t.leads_builderall : null,
  ctr: t.impressions > 0 ? (t.clicks / t.impressions) * 100 : null,
  cpm: t.impressions > 0 ? (t.spent / t.impressions) * 1000 : null,
  ticket_medio: t.vendas > 0 ? t.faturamento / t.vendas : null,
  cac: t.vendas > 0 ? t.spent / t.vendas : null,
  roi: t.spent > 0 ? ((t.faturamento - t.spent) / t.spent) * 100 : null,
  conv_leads: t.leads_builderall > 0 ? (t.vendas / t.leads_builderall) * 100 : null,
});

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(today) };
}

function prevRange(from: string, to: string): { from: string; to: string } {
  const fromDate = new Date(from + 'T12:00:00');
  const toDate = new Date(to + 'T12:00:00');
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  const prevTo = new Date(fromDate);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

function daysList(from: string, to: string): string[] {
  const out: string[] = [];
  const fromDate = new Date(from + 'T12:00:00');
  const toDate = new Date(to + 'T12:00:00');
  const totalDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(fromDate);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ── GET /admin/traffic ──────────────────────────────────────────────────────────
adminConfigRouter.get('/admin/traffic', async (req, res, next) => {
  try {
    const fromParam = typeof req.query.from === 'string' ? req.query.from : null;
    const toParam = typeof req.query.to === 'string' ? req.query.to : null;
    const platformParam = typeof req.query.platform === 'string' ? req.query.platform : null;
    const range = fromParam && toParam ? { from: fromParam, to: toParam } : defaultRange();

    const prev = fromParam && toParam ? prevRange(range.from, range.to) : null;

    const baseQ = (fromIso: string | null, toIso: string | null) => {
      let q = sip().from('traffic').select('*').order('date');
      if (fromIso) q = q.gte('date', fromIso);
      if (toIso) q = q.lte('date', toIso);
      if (platformParam) {
        const p = sanitizePlatform(platformParam);
        q = p === 'outros' ? q.or('platform.is.null,platform.eq.outros') : q.eq('platform', p);
      }
      return q;
    };

    const [{ data: allTrafficRows }, { data: allStudents }, { data: allNavigators }, { data: prevTrafficRows }] = await Promise.all([
      baseQ(range.from, range.to),
      sip().from('users').select('id, name, email, ciclo_type, monitor_id').eq('role', 'student'),
      sip().from('users').select('id, name').eq('role', 'monitor'),
      prev ? baseQ(prev.from, prev.to) : Promise.resolve({ data: [] as TrafficRow[] }),
    ]);

    const navMap: Record<string, string> = {};
    for (const n of allNavigators || []) navMap[n.id] = n.name;

    const rows = (allTrafficRows || []) as TrafficRow[];
    const prevRows = (prevTrafficRows || []) as TrafficRow[];

    // ── Per-student totals ──────────────────────────────────────────────────
    const byStudent: Record<string, Totals & { user_id: string }> = {};
    for (const r of rows) {
      if (!byStudent[r.user_id]) byStudent[r.user_id] = { ...zeroTotals(), user_id: r.user_id };
      Object.assign(byStudent[r.user_id]!, addRow(byStudent[r.user_id]!, r));
    }
    const studentsWithTraffic = (allStudents || [])
      .map((s: Record<string, unknown>) => {
        const t = byStudent[s.id as string] || zeroTotals();
        return {
          id: s.id,
          name: s.name,
          email: s.email,
          ciclo_type: s.ciclo_type,
          monitor_name: navMap[s.monitor_id as string] ?? null,
          ...kpisOf(t),
        };
      })
      .filter((s) => s.spent > 0 || s.leads_builderall > 0);

    // ── Totals + by_ciclo (compat) ──────────────────────────────────────────
    const totalsRaw = rows.reduce((acc, r) => addRow(acc, r), zeroTotals());
    const aurumRaw = rows.filter((r) => isAurum(r)).reduce((acc, r) => addRow(acc, r), zeroTotals());
    const semRaw = rows.filter((r) => isSeminario(r)).reduce((acc, r) => addRow(acc, r), zeroTotals());

    const avg = (raw: Totals, count: number) => {
      const base = kpisOf(raw);
      return {
        ...base,
        avg_spent: count > 0 ? raw.spent / count : null,
        avg_leads: count > 0 ? raw.leads_builderall / count : null,
        count,
      };
    };

    const allActive = studentsWithTraffic.length;
    const aurumActive = studentsWithTraffic.filter((s) => isAurum({ ciclo_type: s.ciclo_type as string | null | undefined })).length;
    const semActive = studentsWithTraffic.filter((s) => isSeminario({ ciclo_type: s.ciclo_type as string | null | undefined })).length;

    // ── Série diária ────────────────────────────────────────────────────────
    const days = daysList(range.from, range.to);
    const byDay: Record<string, Totals> = {};
    for (const d of days) byDay[d] = zeroTotals();
    for (const r of rows) {
      const d = (r.date || '').slice(0, 10);
      if (byDay[d]) byDay[d] = addRow(byDay[d]!, r);
    }
    const serie_diaria = {
      days,
      spent: days.map((d) => Math.round((byDay[d]!.spent || 0) * 100) / 100),
      leads: days.map((d) => byDay[d]!.leads_builderall || 0),
      cpl: days.map((d) => (byDay[d]!.leads_builderall > 0 ? Math.round((byDay[d]!.spent / byDay[d]!.leads_builderall) * 100) / 100 : 0)),
      impressions: days.map((d) => byDay[d]!.impressions || 0),
      clicks: days.map((d) => byDay[d]!.clicks || 0),
      vendas: days.map((d) => byDay[d]!.vendas || 0),
      faturamento: days.map((d) => Math.round((byDay[d]!.faturamento || 0) * 100) / 100),
    };

    // ── Por plataforma (donut + delta vs prev) ──────────────────────────────
    const byPlatform: Record<TrafficPlatform, Totals> = {
      meta_instagram: zeroTotals(),
      meta_facebook: zeroTotals(),
      tiktok: zeroTotals(),
      youtube: zeroTotals(),
      google: zeroTotals(),
      outros: zeroTotals(),
    };
    const byPlatformPrev: Record<TrafficPlatform, Totals> = {
      meta_instagram: zeroTotals(),
      meta_facebook: zeroTotals(),
      tiktok: zeroTotals(),
      youtube: zeroTotals(),
      google: zeroTotals(),
      outros: zeroTotals(),
    };
    for (const r of rows) byPlatform[sanitizePlatform(r.platform)] = addRow(byPlatform[sanitizePlatform(r.platform)], r);
    for (const r of prevRows) byPlatformPrev[sanitizePlatform(r.platform)] = addRow(byPlatformPrev[sanitizePlatform(r.platform)], r);

    const por_plataforma = (Object.keys(byPlatform) as TrafficPlatform[])
      .map((p) => {
        const t = byPlatform[p];
        const pPrev = byPlatformPrev[p];
        const leads = t.leads_builderall;
        const leadsPrev = pPrev.leads_builderall;
        const delta_leads_pct = prev && leadsPrev > 0 ? Math.round(((leads - leadsPrev) / leadsPrev) * 100) : null;
        return {
          platform: p,
          label: PLATFORM_LABELS[p],
          spent: t.spent,
          leads,
          vendas: t.vendas,
          faturamento: t.faturamento,
          cpl: leads > 0 ? Math.round((t.spent / leads) * 100) / 100 : null,
          ctr: t.impressions > 0 ? Math.round((t.clicks / t.impressions) * 10000) / 100 : null,
          cpm: t.impressions > 0 ? Math.round((t.spent / t.impressions) * 100000) / 100 : null,
          roi: t.spent > 0 ? Math.round(((t.faturamento - t.spent) / t.spent) * 10000) / 100 : null,
          ticket_medio: t.vendas > 0 ? Math.round((t.faturamento / t.vendas) * 100) / 100 : null,
          delta_leads_pct,
        };
      })
      .filter((p) => p.spent > 0 || p.leads > 0);

    // ── Destaques: best/worst ROI por plataforma ────────────────────────────
    const ranked = [...por_plataforma].filter((p) => p.roi != null).sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity));
    let destaque_best: (typeof ranked)[number] | null = null;
    let destaque_worst: (typeof ranked)[number] | null = null;
    if (ranked.length > 0) {
      destaque_best = ranked[0]!;
      destaque_worst = ranked.length > 1 ? ranked[ranked.length - 1]! : null;
    } else {
      const byCpl = [...por_plataforma].filter((p) => p.cpl != null && p.leads > 0).sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
      destaque_best = byCpl[0] ?? null;
      destaque_worst = byCpl.length > 1 ? byCpl[byCpl.length - 1]! : null;
    }

    // ── Funil: Alcance → Cliques → Leads → Vendas ───────────────────────────
    const funil = {
      alcance: totalsRaw.impressions,
      cliques: totalsRaw.clicks,
      leads: totalsRaw.leads_builderall,
      vendas: totalsRaw.vendas,
      faturamento: totalsRaw.faturamento,
      ctr: totalsRaw.impressions > 0 ? Math.round((totalsRaw.clicks / totalsRaw.impressions) * 10000) / 100 : 0,
      cliques_to_leads: totalsRaw.clicks > 0 ? Math.round((totalsRaw.leads_builderall / totalsRaw.clicks) * 10000) / 100 : 0,
      leads_to_vendas: totalsRaw.leads_builderall > 0 ? Math.round((totalsRaw.vendas / totalsRaw.leads_builderall) * 10000) / 100 : 0,
      ticket_medio: totalsRaw.vendas > 0 ? Math.round((totalsRaw.faturamento / totalsRaw.vendas) * 100) / 100 : null,
      roi: totalsRaw.spent > 0 ? Math.round(((totalsRaw.faturamento - totalsRaw.spent) / totalsRaw.spent) * 10000) / 100 : null,
      cac: totalsRaw.vendas > 0 ? Math.round((totalsRaw.spent / totalsRaw.vendas) * 100) / 100 : null,
    };

    const prevTotals = prev ? kpisOf(prevRows.reduce((acc, r) => addRow(acc, r), zeroTotals())) : null;

    return res.json({
      range,
      totals: avg(totalsRaw, allActive),
      by_ciclo: { aurum: avg(aurumRaw, aurumActive), seminario: avg(semRaw, semActive) },
      students: studentsWithTraffic.map((s) => {
        const t = byStudent[s.id as string];
        return {
          ...s,
          vendas: t?.vendas ?? 0,
          faturamento: t?.faturamento ?? 0,
        };
      }),
      serie_diaria,
      por_plataforma,
      destaques_plataforma: { best: destaque_best, worst: destaque_worst },
      funil,
      prev: prevTotals,
    });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// REPORTS (chamados)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /admin/reports/count — badge no menu ────────────────────────────────────
adminConfigRouter.get('/admin/reports/count', async (_req, res, next) => {
  try {
    const { count } = await sip().from('reports').select('id', { count: 'exact', head: true }).eq('status', 'aberto');
    return res.json({ open: count ?? 0 });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/reports ──────────────────────────────────────────────────────────
adminConfigRouter.get('/admin/reports', async (req, res, next) => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
    const { limit, cursor, hasLimitParam } = parsePagination(req.query);

    let total: number | undefined;
    if (hasLimitParam && !cursor) {
      let cq = sip().from('reports').select('id', { count: 'exact', head: true });
      if (statusFilter) cq = cq.eq('status', statusFilter);
      const { count } = await cq;
      total = count ?? 0;
    }

    let q = sip().from('reports').select('*');
    if (statusFilter) q = q.eq('status', statusFilter);
    q = applyCursor(q, cursor, 'created_at').order('created_at', { ascending: false }).order('id', { ascending: false });
    if (hasLimitParam) q = q.limit(limit + 1);
    const { data } = await q;
    const items = (data || []) as Array<Record<string, unknown> & { id: string; created_at: string }>;
    return res.json(buildPaginated(items, limit, hasLimitParam, 'created_at', total));
  } catch (err) {
    next(err);
  }
});

// ── PUT /admin/reports/:id ──────────────────────────────────────────────────────
adminConfigRouter.put('/admin/reports/:id', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const body = (req.body ?? {}) as { status?: string; admin_response?: string; admin_note?: string };
    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.admin_response !== undefined) updates.admin_response = body.admin_response;
    if (body.admin_note !== undefined) updates.admin_note = body.admin_note;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    updates.updated_at = new Date().toISOString();
    await sip().from('reports').update(updates).eq('id', req.params.id);
    const { data: updated } = await sip().from('reports').select('*').eq('id', req.params.id).maybeSingle();
    await audit(userId, 'ACTION', 'reports', req.params.id, { what: 'update_report', keys: Object.keys(updates) });
    return res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CLICKUP HANDOFFS
// ════════════════════════════════════════════════════════════════════════════

// Retry de um handoff (proof) ao ClickUp — porte de retryHandoffById de
// handlers/_shared.ts. Na stack nova, dispatchClickUp lê env.CLICKUP_TOKEN
// diretamente (sem supabaseUrl/serviceKey).
async function retryHandoffById(proofId: string): Promise<ClickUpDispatchResult & { skipped?: boolean }> {
  // Optimistic claim: marca como "tentado agora". Idempotência garante que
  // mesmo com dois workers, dispatchClickUp não duplica items.
  const claimAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await sip()
    .from('task_proofs')
    .update({ clickup_dispatched_at: claimAt })
    .eq('id', proofId)
    .eq('sent_to_clickup', false)
    .select('id, user_id, task_id, task_title, ciclo_type, link, submitted_at, clickup_target_key, aluno_nome, aluno_email, tasks:task_id(taskline)')
    .maybeSingle();
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed) return { ok: true, skipped: true };
  const p = claimed as Record<string, unknown>;

  const targetKey = p.clickup_target_key as string | null;
  if (!targetKey) {
    await sip().from('task_proofs').update({ clickup_error: 'no_clickup_target_key' }).eq('id', proofId);
    return { ok: false, error: 'no_clickup_target_key' };
  }

  const taskRec = p.tasks as { taskline?: string } | null;
  const taskline = taskRec?.taskline ?? (p.ciclo_type as string);

  const { data: target } = await sip().from('clickup_targets').select('clickup_task_id, operator_steps').eq('key', targetKey).eq('taskline', taskline).maybeSingle();
  const parentId = (target?.clickup_task_id as string) ?? null;
  if (!parentId) {
    const errMsg = `no_parent_id (key=${targetKey}, taskline=${taskline})`;
    await sip().from('task_proofs').update({ clickup_error: errMsg }).eq('id', proofId);
    return { ok: false, error: errMsg };
  }

  // Prefer snapshots; fallback ao JOIN só se snapshots estão null (proofs antigos).
  let alunoNome = p.aluno_nome as string | null;
  let alunoEmail = p.aluno_email as string | null;
  let monitorNome: string | null = null;
  if (!alunoNome || !alunoEmail) {
    const { data: u } = await sip().from('users').select('name, email, monitor_id').eq('id', p.user_id as string).maybeSingle();
    alunoNome = alunoNome ?? (u?.name as string) ?? null;
    alunoEmail = alunoEmail ?? (u?.email as string) ?? null;
    if (u?.monitor_id) {
      const { data: m } = await sip().from('users').select('name').eq('id', u.monitor_id).maybeSingle();
      monitorNome = (m?.name as string) ?? null;
    }
  }

  const result = await dispatchClickUp({
    aluno_nome: (alunoNome ?? (p.user_id as string)).slice(0, 100),
    aluno_email: alunoEmail ?? '',
    ciclo_type: p.ciclo_type as string,
    taskline,
    monitor_nome: monitorNome,
    task_titulo: p.task_title as string,
    passo: p.task_title as string,
    link: (p.link as string | null) ?? null,
    parent_task_id: parentId,
    operator_steps: (target?.operator_steps as string[] | null) ?? [],
    submitted_at: p.submitted_at as string,
  });

  await sip()
    .from('task_proofs')
    .update({
      sent_to_clickup: result.ok,
      clickup_dispatched_at: new Date().toISOString(),
      clickup_error: result.ok ? null : (result.error ?? 'retry_failed'),
    })
    .eq('id', proofId);

  return result;
}

// ── GET /admin/clickup/handoffs ──────────────────────────────────────────────────
adminConfigRouter.get('/admin/clickup/handoffs', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const taskline = typeof req.query.taskline === 'string' ? req.query.taskline : null;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

    let q = sip()
      .from('task_proofs')
      .select(
        'id, user_id, task_id, task_title, ciclo_type, link, status, submitted_at, sent_to_clickup, clickup_dispatched_at, clickup_error, clickup_target_key, users:user_id(name, email)',
      )
      .order('submitted_at', { ascending: false })
      .limit(limit);

    if (status === 'failed') {
      q = q.eq('sent_to_clickup', false).not('clickup_target_key', 'is', null);
    } else if (status === 'sent') {
      q = q.eq('sent_to_clickup', true);
    } else if (status === 'skipped') {
      q = q.is('clickup_target_key', null);
    }

    const { data: rows, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const [{ count: total }, { count: sent }, { count: failed }] = await Promise.all([
      sip().from('task_proofs').select('id', { count: 'exact', head: true }),
      sip().from('task_proofs').select('id', { count: 'exact', head: true }).eq('sent_to_clickup', true),
      sip().from('task_proofs').select('id', { count: 'exact', head: true }).eq('sent_to_clickup', false).not('clickup_target_key', 'is', null),
    ]);

    return res.json({
      summary: {
        total: total ?? 0,
        sent: sent ?? 0,
        failed: failed ?? 0,
        success_rate: total ? Math.round(((sent ?? 0) / total) * 1000) / 10 : 0,
      },
      items: (rows || []).filter((r) => !taskline || (r as Record<string, unknown>).ciclo_type === taskline),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/clickup/handoffs/retry-failed — bulk retry ──────────────────────
adminConfigRouter.post('/admin/clickup/handoffs/retry-failed', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    if (!env.CLICKUP_TOKEN) return res.status(500).json({ error: 'dispatcher_not_configured' });
    const body = (req.body ?? {}) as { limit?: number; older_than_minutes?: number };
    const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));
    const olderThanMin = Math.max(0, Number(body.older_than_minutes) || 0);

    let q = sip()
      .from('task_proofs')
      .select('id')
      .eq('sent_to_clickup', false)
      .not('clickup_target_key', 'is', null)
      .order('submitted_at', { ascending: true }) // mais antigo primeiro
      .limit(limit);
    if (olderThanMin > 0) {
      const cutoff = new Date(Date.now() - olderThanMin * 60_000).toISOString();
      q = q.lt('submitted_at', cutoff);
    }
    const { data: pending, error: listErr } = await q;
    if (listErr) return res.status(500).json({ error: listErr.message });

    const proofIds = (pending || []).map((p) => (p as Record<string, unknown>).id as string);
    if (!proofIds.length) {
      return res.json({ attempted: 0, succeeded: 0, failed: 0, results: [] });
    }

    // Retry sequencial pra não martelar a API do ClickUp + respeitar rate limits.
    let succeeded = 0;
    let failed = 0;
    const results: Array<{ proof_id: string; ok: boolean; error: string | null }> = [];
    for (const pid of proofIds) {
      const r = await retryHandoffById(pid);
      if (r.ok) succeeded++;
      else failed++;
      results.push({ proof_id: pid, ok: r.ok, error: r.error ?? null });
    }

    await audit(userId, 'clickup_handoff_bulk_retry', 'task_proofs', null, { attempted: proofIds.length, succeeded, failed });
    return res.json({ attempted: proofIds.length, succeeded, failed, results });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/clickup/handoffs/:id/retry — single retry ───────────────────────
adminConfigRouter.post('/admin/clickup/handoffs/:id/retry', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    if (!env.CLICKUP_TOKEN) return res.status(500).json({ error: 'dispatcher_not_configured' });
    const proofId = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(proofId)) return res.status(404).json({ error: 'Rota não encontrada' });

    const result = await retryHandoffById(proofId);
    await audit(userId, 'clickup_handoff_retry', 'task_proofs', proofId, { proof_id: proofId, ok: result.ok, error: result.error ?? null });
    return res.json({ ok: result.ok, error: result.error ?? null, skipped: result.skipped ?? false });
  } catch (err) {
    next(err);
  }
});
