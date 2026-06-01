// Admin — núcleo funcional (Fase 4): visão geral (KPIs), aprovações, monitores,
// configurações, ciclos e roster de alunos. Porte de handlers/admin-*.ts.
// Abas avançadas (CRUD taskline, tráfego, cronograma, raiox detalhado, misc)
// virão nas próximas iterações.
import { Router } from 'express';
import { sip } from '../db.js';
import { audit } from '../domain/audit.js';
import { adminRateLimit } from '../middleware/rateLimit.js';
import { bcryptHash } from '../auth/bcrypt.js';
import { EMAIL_RE, passwordStrengthError } from '../auth/password.js';
import { isAurum, isSeminario, isValidCicloType } from '../domain/ciclo.js';
import { buildMilestones } from '../domain/progress.js';
import { SETTINGS_CATALOG } from '../domain/settings.js';
import { buildTasklineTotals, resolveTasklinesForStudents, tasklineTotalFor } from '../domain/adminAggregates.js';
import { dispatchEmail } from '../services/email.js';

export const adminRouter = Router();

const ROSTER_COLS =
  'id, name, email, phone, city, ciclo_type, is_platina, monitor_id, approval_status, raiox_score, raiox_max_score, raiox_submitted_at, created_at, interesse_ciclo';

// ── GET /admin/dashboard — KPIs (porte de admin-dashboard.ts) ──────────────────
adminRouter.get('/admin/dashboard', async (_req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [{ data: allStudents }, { data: allProgress }, { data: recentProgress }, { data: monitors }, { data: ciclosRows }, { data: recentPosts }] =
      await Promise.all([
        sip().from('users').select('id, name, ciclo_type, monitor_id, is_socio').eq('role', 'student'),
        sip().from('progress').select('user_id, completed, completed_at').eq('completed', true),
        sip().from('progress').select('user_id').eq('completed', true).gte('completed_at', sevenDaysAgo),
        sip().from('users').select('id, name').eq('role', 'monitor'),
        sip().from('ciclos').select('id, status'),
        sip().from('posts').select('id, date, platform, format, link, created_at, sip_users:user_id(name)').order('date', { ascending: false }).limit(5),
      ]);
    const students = (allStudents || []).filter((s: Record<string, unknown>) => !s.is_socio);
    const aurum = students.filter((s: Record<string, unknown>) => isAurum(s));
    const diamante = students.filter((s: Record<string, unknown>) => isSeminario(s));

    const progressByUser: Record<string, number> = {};
    for (const p of allProgress || []) progressByUser[p.user_id] = (progressByUser[p.user_id] || 0) + 1;
    const recentUserIds = new Set((recentProgress || []).map((p: Record<string, unknown>) => p.user_id));

    const engajados = students.filter((s: Record<string, unknown>) => s.monitor_id && recentUserIds.has(s.id as string));
    const semMonitor = students.filter((s: Record<string, unknown>) => !s.monitor_id);
    const nunca_iniciou = students.filter((s: Record<string, unknown>) => !progressByUser[s.id as string]);

    const tasklineTotals = await buildTasklineTotals();
    const tasklineByStudent = await resolveTasklinesForStudents(students as Array<{ id: string; ciclo_type?: string | null }>);
    const avgPercentFor = (group: Array<Record<string, unknown>>) => {
      if (group.length === 0) return 0;
      const sum = group.reduce((acc: number, s: Record<string, unknown>) => {
        const total = tasklineTotalFor(tasklineTotals, s.ciclo_type as string, tasklineByStudent.get(s.id as string));
        return acc + (total > 0 ? (progressByUser[s.id as string] || 0) / total : 0);
      }, 0);
      return Math.round((sum / group.length) * 100);
    };

    const studentsWithActivity = students.map((s: Record<string, unknown>) => ({
      id: s.id,
      name: s.name,
      ciclo_type: s.ciclo_type,
      monitor_id: (s.monitor_id as string) ?? null,
      monitor_name: monitors ? ((monitors.find((n: Record<string, unknown>) => n.id === s.monitor_id) as Record<string, unknown> | undefined)?.name ?? null) : null,
      completed_tasks: progressByUser[s.id as string] || 0,
    }));
    const topEngajados = [...studentsWithActivity].filter((s) => s.completed_tasks > 0).sort((a, b) => b.completed_tasks - a.completed_tasks).slice(0, 5);
    // "Parados": com monitor atribuído, ordenados pela menor atividade (legado).
    const topParados = [...studentsWithActivity].filter((s) => s.monitor_id).sort((a, b) => a.completed_tasks - b.completed_tasks).slice(0, 5);
    const PLAT_LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube' };
    const postsRecentes = (recentPosts || []).slice(0, 5).map((p: Record<string, unknown>) => ({
      id: p.id,
      date: p.date,
      created_at: p.created_at,
      platform: p.platform,
      platform_label: PLAT_LABEL[p.platform as string] || (p.platform as string),
      format: p.format,
      link: p.link,
      author_name: (p.sip_users as { name?: string } | null)?.name ?? '—',
    }));

    const ciclos = ciclosRows || [];
    return res.json({
      totais: { total: students.length, aurum: aurum.length, diamante: diamante.length },
      engajamento: { engajados: engajados.length, sem_monitor: semMonitor.length, nunca_iniciou: nunca_iniciou.length },
      progresso_medio: { aurum: avgPercentFor(aurum), diamante: avgPercentFor(diamante) },
      top_engajados: topEngajados,
      top_parados: topParados,
      posts_recentes: postsRecentes,
      concluidos_7d: (recentProgress || []).length,
      ciclos: {
        ativos: ciclos.filter((c: Record<string, unknown>) => c.status === 'active').length,
        encerrados: ciclos.filter((c: Record<string, unknown>) => c.status === 'closed').length,
        aguardando: ciclos.filter((c: Record<string, unknown>) => c.status === 'pending').length,
        total: ciclos.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/pending-students (+ count) ──────────────────────────────────────
adminRouter.get('/admin/pending-students', async (_req, res, next) => {
  try {
    const { data: pending } = await sip()
      .from('users')
      .select('id, name, email, phone, city, ciclo_type, interesse_ciclo, raiox_score, raiox_max_score, raiox_submitted_at, created_at')
      .eq('role', 'student')
      .eq('approval_status', 'pending')
      .order('created_at', { ascending: true });
    return res.json({ items: pending || [], total: (pending || []).length });
  } catch (err) {
    next(err);
  }
});
adminRouter.get('/admin/pending-students/count', async (_req, res, next) => {
  try {
    const { count } = await sip().from('users').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('approval_status', 'pending');
    return res.json({ count: count ?? 0 });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/students/:id/approve ───────────────────────────────────────────
adminRouter.post('/admin/students/:id/approve', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    if (!adminRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const studentId = req.params.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { ciclo_type, is_platina, monitor_id, note, padrinho, padrinho_contato, data_palestra, meta_vendas_pessoal, investimento_previsto, meta_captacao_leads, obs_planejamento, pasta_acesso } = body;

    if (!isValidCicloType(ciclo_type)) return res.status(400).json({ error: 'Selecione o ciclo do aluno (Aurum, Diamante ou Platina).' });
    if (!monitor_id || typeof monitor_id !== 'string') return res.status(400).json({ error: 'Selecione o monitor do aluno.' });
    if (!data_palestra || typeof data_palestra !== 'string') {
      const labelEvt = ciclo_type === 'aurum' ? 'data da palestra' : 'data do Dia 01 do seminário';
      return res.status(400).json({ error: `Informe a ${labelEvt}.` });
    }
    const d = new Date(data_palestra + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Data do evento inválida.' });
    if (ciclo_type === 'seminario' && d.getDay() !== 2) {
      const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
      return res.status(400).json({ error: `O Seminário deve começar numa terça-feira. Você escolheu ${dias[d.getDay()]}.` });
    }

    const { data: actor } = await sip().from('users').select('id, role').eq('id', userId).maybeSingle();
    if (!actor || actor.role !== 'admin') return res.status(401).json({ error: 'Sessão de admin inválida — faça login novamente.' });
    const { data: monitorUser } = await sip().from('users').select('id, role').eq('id', monitor_id).maybeSingle();
    if (!monitorUser || !['monitor', 'admin'].includes(monitorUser.role)) return res.status(400).json({ error: 'Monitor inválido.' });

    const { data: student } = await sip()
      .from('users')
      .select('id, role, approval_status, interesse_ciclo, raiox_submitted_at')
      .eq('id', studentId)
      .maybeSingle();
    if (!student || student.role !== 'student') return res.status(404).json({ error: 'Aluno não encontrado' });
    if (student.approval_status !== 'pending') return res.status(409).json({ error: 'Aluno não está pendente. Use atribuição para ajustar.', approval_status: student.approval_status });
    if (!student.raiox_submitted_at) return res.status(400).json({ error: 'Este aluno ainda não preencheu o Raio-X. Ele precisa completá-lo antes da liberação.' });

    const updates: Record<string, unknown> = {
      approval_status: 'approved',
      approval_decided_at: new Date().toISOString(),
      approval_decided_by: userId,
      ciclo_type,
      monitor_id,
      is_platina: is_platina === true || is_platina === 'true',
    };
    if (typeof note === 'string' && note.trim()) updates.approval_note = note.trim().slice(0, 500);
    const { data: cicloAtivo } = await sip().from('ciclos').select('id').eq('ciclo_type', ciclo_type).eq('status', 'active').maybeSingle();
    updates.current_ciclo_id = cicloAtivo?.id ?? null;

    const { error } = await sip().from('users').update(updates).eq('id', studentId);
    if (error) return res.status(500).json({ error: 'Erro ao aprovar.', detail: error.message });

    const nowIso = new Date().toISOString();
    const metaUpserts: Array<{ user_id: string; key: string; value: unknown; updated_at: string }> = [];
    const pushMeta = (key: string, value: unknown) => metaUpserts.push({ user_id: studentId, key, value, updated_at: nowIso });
    if (typeof padrinho === 'string' && padrinho.trim()) pushMeta('padrinho', padrinho.trim().slice(0, 120));
    if (typeof padrinho_contato === 'string' && padrinho_contato.trim()) pushMeta('padrinho_contato', padrinho_contato.trim().slice(0, 120));
    pushMeta('data_palestra', data_palestra);
    pushMeta('calendar_anchor', data_palestra);
    if (meta_vendas_pessoal != null) pushMeta('meta_vendas_pessoal', meta_vendas_pessoal);
    if (investimento_previsto != null) pushMeta('investimento_previsto', investimento_previsto);
    if (meta_captacao_leads != null) pushMeta('meta_captacao_leads', meta_captacao_leads);
    if (typeof obs_planejamento === 'string' && obs_planejamento.trim()) pushMeta('obs_planejamento', obs_planejamento.trim().slice(0, 500));
    if (typeof pasta_acesso === 'string' && pasta_acesso.trim()) pushMeta('pasta_acesso', pasta_acesso.trim().slice(0, 500));
    if (metaUpserts.length > 0) await sip().from('meta').upsert(metaUpserts, { onConflict: 'user_id,key' });

    try {
      const milestones = await buildMilestones(data_palestra, ciclo_type);
      await sip().from('student_schedules').upsert(
        { user_id: studentId, ciclo_type, anchor_date: data_palestra, milestones, overrides: {}, version: 1, updated_at: nowIso },
        { onConflict: 'user_id' },
      );
    } catch (e) {
      console.error('[approve] schedule (não-fatal):', e);
    }

    await audit(userId, 'ACTION', 'users', studentId, { what: 'approve_student', ciclo_type_decided: ciclo_type, data_palestra });

    const { data: approvedUser } = await sip().from('users').select('name, email').eq('id', studentId).maybeSingle();
    if (approvedUser) void dispatchEmail('acesso_liberado', { to: approvedUser.email, nome: approvedUser.name });

    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/students/:id/reject ─────────────────────────────────────────────
adminRouter.post('/admin/students/:id/reject', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    if (!adminRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const studentId = req.params.id;
    const body = (req.body ?? {}) as { note?: string };
    const note = (typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '') || null;
    const { data: actor } = await sip().from('users').select('id, role').eq('id', userId).maybeSingle();
    if (!actor || actor.role !== 'admin') return res.status(401).json({ error: 'Sessão de admin inválida — faça login novamente.' });
    const { data: student } = await sip().from('users').select('id, role').eq('id', studentId).maybeSingle();
    if (!student || student.role !== 'student') return res.status(404).json({ error: 'Aluno não encontrado' });
    const { error } = await sip()
      .from('users')
      .update({ approval_status: 'rejected', approval_decided_at: new Date().toISOString(), approval_decided_by: userId, approval_note: note })
      .eq('id', studentId);
    if (error) return res.status(500).json({ error: 'Erro ao rejeitar.' });
    await audit(userId, 'ACTION', 'users', studentId, { what: 'reject_student', note });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET/POST /admin/monitors ────────────────────────────────────────────────────
adminRouter.get('/admin/monitors', async (_req, res, next) => {
  try {
    const { data: monitors } = await sip().from('users').select('id, name, email, role').in('role', ['monitor', 'admin']);
    const { data: allStudents } = await sip().from('users').select('id, name, ciclo_type, monitor_id').eq('role', 'student');
    const { data: allProgress } = await sip().from('progress').select('user_id, completed').eq('completed', true);
    const completedByUser: Record<string, number> = {};
    for (const p of allProgress || []) completedByUser[p.user_id] = (completedByUser[p.user_id] || 0) + 1;
    const tasklineTotals = await buildTasklineTotals();
    const tasklineByStudent = await resolveTasklinesForStudents((allStudents || []) as Array<{ id: string; ciclo_type?: string | null }>);
    const result = (monitors || []).map((nav: { id: string; name: string; email: string; role: string }) => {
      const students = (allStudents || []).filter((s: { monitor_id: string }) => s.monitor_id === nav.id);
      const details = students.map((s: { id: string; name: string; ciclo_type: string }) => {
        const completed = completedByUser[s.id] || 0;
        const total = tasklineTotalFor(tasklineTotals, s.ciclo_type, tasklineByStudent.get(s.id)) || 1;
        return { id: s.id, name: s.name, ciclo_type: s.ciclo_type, progress_percent: Math.round((completed / total) * 100) };
      });
      const avg = details.length > 0 ? Math.round(details.reduce((a: number, x: { progress_percent: number }) => a + x.progress_percent, 0) / details.length) : null;
      return {
        id: nav.id, name: nav.name, email: nav.email, is_admin: nav.role === 'admin',
        student_count: students.length, avg_progress: avg,
        aurum_count: details.filter((s: { ciclo_type: string }) => isAurum(s)).length,
        seminario_count: details.filter((s: { ciclo_type: string }) => isSeminario(s)).length,
        students: details,
      };
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/admin/monitors', async (req, res, next) => {
  try {
    const { name, email, password } = (req.body ?? {}) as { name?: string; email?: string; password?: string };
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email e password são obrigatórios' });
    const nameTrim = String(name).trim();
    const emailNorm = String(email).toLowerCase().trim();
    if (nameTrim.length < 2) return res.status(400).json({ error: 'Nome inválido.' });
    if (!EMAIL_RE.test(emailNorm)) return res.status(400).json({ error: 'Email inválido.' });
    const pwdErr = passwordStrengthError(String(password));
    if (pwdErr) return res.status(400).json({ error: pwdErr });
    const { data: existing } = await sip().from('users').select('id').eq('email', emailNorm).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Email já cadastrado' });
    const password_hash = await bcryptHash(password);
    const { data: nav } = await sip().from('users').insert({ name: nameTrim, email: emailNorm, password_hash, role: 'monitor', onboarding_done: true }).select().single();
    if (!nav) return res.status(500).json({ error: 'Falha ao criar monitor.' });
    await audit(req.user!.id, 'ACTION', 'users', nav.id, { what: 'create_monitor', email: emailNorm });
    return res.json({ success: true, monitor: { id: nav.id, name: nav.name, email: nav.email } });
  } catch (err) {
    next(err);
  }
});

// ── GET/POST /admin/settings ────────────────────────────────────────────────────
adminRouter.get('/admin/settings', async (_req, res, next) => {
  try {
    const { data: stored } = await sip().from('meta').select('key, value').eq('user_id', '__settings__');
    const valueMap: Record<string, unknown> = {};
    for (const s of stored || []) valueMap[s.key] = s.value;
    return res.json(
      SETTINGS_CATALOG.map((s) => ({ key: s.key, label: s.label, kind: s.kind, default: s.default, value: valueMap[s.key] != null ? valueMap[s.key] : s.default })),
    );
  } catch (err) {
    next(err);
  }
});
adminRouter.post('/admin/settings', async (req, res, next) => {
  try {
    const { settings } = (req.body ?? {}) as { settings?: unknown };
    if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'settings precisa ser objeto' });
    const allowedKeys = new Set<string>(SETTINGS_CATALOG.map((s) => s.key));
    const now = new Date().toISOString();
    const rows = Object.entries(settings)
      .filter(([key]) => allowedKeys.has(key))
      .map(([key, value]) => ({ user_id: '__settings__', key, value, updated_at: now }));
    if (rows.length > 0) await sip().from('meta').upsert(rows, { onConflict: 'user_id,key' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/ciclos ───────────────────────────────────────────────────────────
adminRouter.get('/admin/ciclos', async (_req, res, next) => {
  try {
    const [{ data: ciclos }, { data: students }] = await Promise.all([
      sip().from('ciclos').select('*').order('ciclo_type').order('numero'),
      sip().from('users').select('id, current_ciclo_id').eq('role', 'student'),
    ]);
    const countByCiclo: Record<string, number> = {};
    for (const s of students || []) if (s.current_ciclo_id) countByCiclo[s.current_ciclo_id] = (countByCiclo[s.current_ciclo_id] || 0) + 1;
    return res.json((ciclos || []).map((c: Record<string, unknown>) => ({ ...c, student_count: countByCiclo[c.id as string] || 0 })));
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/students — roster (versão pragmática, taskline-aware) ───────────────
adminRouter.get('/admin/students', async (req, res, next) => {
  try {
    const cicloFilter = typeof req.query.ciclo_type === 'string' ? req.query.ciclo_type : null;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;

    // ── status=socios: lista de sócios com info do titular (contrato legado) ───────
    if (statusFilter === 'socios') {
      const { data: socios } = await sip()
        .from('users')
        .select('id, name, email, is_socio, socio_of, created_at, ciclo_type, monitor_id')
        .eq('role', 'student')
        .eq('is_socio', true)
        .order('created_at', { ascending: false });
      const ownerIds = [...new Set(((socios || []) as Array<Record<string, unknown>>).map((s) => s.socio_of as string).filter(Boolean))];
      const { data: owners } = ownerIds.length > 0
        ? await sip().from('users').select('id, name, email, ciclo_type, is_platina').in('id', ownerIds)
        : { data: [] as Array<Record<string, unknown>> };
      const ownerMap: Record<string, Record<string, unknown>> = {};
      for (const o of (owners || []) as Array<Record<string, unknown>>) ownerMap[o.id as string] = o;
      const enriched = ((socios || []) as Array<Record<string, unknown>>).map((s) => {
        const owner = ownerMap[s.socio_of as string] || {};
        return {
          id: s.id, name: s.name, email: s.email,
          is_socio: true, socio_of: s.socio_of,
          owner_id: s.socio_of ?? null,
          owner_name: owner.name ?? null,
          owner_email: owner.email ?? null,
          ciclo_type: owner.ciclo_type ?? null,
          is_platina: owner.is_platina === true,
          monitor_id: null, monitor_name: null, created_at: s.created_at,
          progress_percent: 0, completed_tasks: 0, total_tasks: 0,
          current_stage: 0, total_stages: 0,
          has_socio: false, socio: null,
          approval_status: 'approved', pending: false,
          self_registered: false, data_palestra: null, padrinho: null,
        };
      });
      return res.json({ items: enriched, total: enriched.length, has_more: false });
    }

    let q = sip().from('users').select(ROSTER_COLS).eq('role', 'student').neq('is_socio', true);
    if (cicloFilter) q = q.eq('ciclo_type', cicloFilter);
    if (statusFilter === 'pending') q = q.is('monitor_id', null);
    if (statusFilter === 'active') q = q.not('monitor_id', 'is', null);
    q = q.order('created_at', { ascending: false });
    const { data: students } = await q;
    const list = (students || []) as Array<Record<string, unknown>>;

    const { data: allProgress } = await sip().from('progress').select('user_id, completed').eq('completed', true);
    const completedByUser: Record<string, number> = {};
    for (const p of allProgress || []) completedByUser[p.user_id] = (completedByUser[p.user_id] || 0) + 1;
    const tasklineTotals = await buildTasklineTotals();
    const tasklineByStudent = await resolveTasklinesForStudents(list as Array<{ id: string; ciclo_type?: string | null }>);

    const monitorIds = [...new Set(list.map((s) => s.monitor_id).filter(Boolean) as string[])];
    const { data: monitorRows } = monitorIds.length > 0 ? await sip().from('users').select('id, name').in('id', monitorIds) : { data: [] as Array<Record<string, unknown>> };
    const monitorName: Record<string, string> = {};
    for (const m of monitorRows || []) monitorName[m.id as string] = m.name as string;

    // has_socio: marca alunos titulares que têm um sócio vinculado (badge na lista).
    const pageIds = list.map((s) => s.id as string);
    const { data: socioRows } = pageIds.length > 0
      ? await sip().from('users').select('id, socio_of').eq('is_socio', true).in('socio_of', pageIds)
      : { data: [] as Array<Record<string, unknown>> };
    const hasSocioSet = new Set(((socioRows || []) as Array<Record<string, unknown>>).map((r) => r.socio_of as string));

    const items = list.map((s) => {
      const total = tasklineTotalFor(tasklineTotals, s.ciclo_type as string, tasklineByStudent.get(s.id as string));
      const completed = completedByUser[s.id as string] || 0;
      return {
        ...s,
        monitor_name: s.monitor_id ? (monitorName[s.monitor_id as string] ?? null) : null,
        completed_tasks: completed,
        total_tasks: total,
        progress_percent: total > 0 ? Math.round((completed / total) * 100) : 0,
        has_socio: hasSocioSet.has(s.id as string),
      };
    });
    return res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});
