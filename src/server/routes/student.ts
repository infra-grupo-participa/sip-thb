// Rotas de LEITURA do aluno (Fase 2) — porte dos GETs de handlers/student.ts.
// Escritas (completar tarefa, /me/meta POST, SDB) entram na Fase 3.
import { Router } from 'express';
import { sip } from '../db.js';
import { resolveEffectiveUser, effectiveId, isUserInWaitMode } from '../domain/student.js';
import { resolveTaskline } from '../domain/taskline.js';
import { buildProgress, buildMilestones } from '../domain/progress.js';
import { XP_LEVELS, ERR_ACCESS_DENIED } from '../domain/settings.js';

export const studentRouter = Router();

// ── GET /my-progress ─────────────────────────────────────────────────────────
studentRouter.get('/my-progress', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const userId = req.user!.id;
    const { data: u } = await sip()
      .from('users')
      .select('id, approval_status, is_socio, socio_of, monitor_id, ciclo_type')
      .eq('id', userId)
      .maybeSingle();
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (u.approval_status === 'rejected') return res.json({ rejected: true });
    if (u.approval_status === 'pending') return res.json({ pending_approval: true });
    if (u.is_socio && u.socio_of) {
      const { data: owner } = await sip().from('users').select('monitor_id').eq('id', u.socio_of).maybeSingle();
      if (!owner) return res.status(403).json({ error: 'Titular não encontrado' });
      if (!owner.monitor_id) return res.json({ waiting: true });
    }
    if (!u.monitor_id && !u.is_socio) return res.json({ waiting: true });
    const wait = await isUserInWaitMode(userId);
    if (wait.waiting) return res.json({ wait_mode: true, reason: wait.reason, data_inicio: wait.data_inicio });

    const effective = await resolveEffectiveUser(userId);
    if (!effective) return res.status(404).json({ error: 'Usuário não encontrado' });
    const taskline = await resolveTaskline(effective as { id: string; ciclo_type?: string | null });
    const prog = await buildProgress(effective.id as string, effective.ciclo_type as string, taskline);
    return res.json({ stages: prog.stages, total: prog.total, completed: prog.completed });
  } catch (err) {
    next(err);
  }
});

// ── GET /me/profile ────────────────────────────────────────────────────────────
studentRouter.get('/me/profile', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const { data: u } = await sip()
      .from('users')
      .select(
        'id, name, email, phone, city, profissao, turma_thb, turma_aurum, is_platina, ciclo_type, monitor_id, raiox_score, raiox_max_score, raiox_submitted_at, current_ciclo_id, created_at, instagram_handle, facebook_handle, youtube_handle, nivel',
      )
      .eq('id', req.user!.id)
      .maybeSingle();
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    let monitor_name = null;
    if (u.monitor_id) {
      const { data: m } = await sip().from('users').select('name').eq('id', u.monitor_id).maybeSingle();
      monitor_name = m?.name ?? null;
    }
    return res.json({ ...u, monitor_name });
  } catch (err) {
    next(err);
  }
});

// ── GET /me/meta ───────────────────────────────────────────────────────────────
studentRouter.get('/me/meta', async (req, res, next) => {
  try {
    const metaOwner = await effectiveId(req.user!.id);
    const { data: entries } = await sip().from('meta').select('key, value').eq('user_id', metaOwner);
    const result: Record<string, unknown> = {};
    for (const e of entries || []) result[e.key] = e.value;
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /me/ciclo ────────────────────────────────────────────────────────────────
studentRouter.get('/me/ciclo', async (req, res, next) => {
  try {
    const { data: u } = await sip().from('users').select('current_ciclo_id').eq('id', req.user!.id).maybeSingle();
    if (!u?.current_ciclo_id) return res.json({ ciclo: null });
    const { data: ciclo } = await sip().from('ciclos').select('*').eq('id', u.current_ciclo_id).maybeSingle();
    return res.json({ ciclo });
  } catch (err) {
    next(err);
  }
});

// ── GET /me/calendar ─────────────────────────────────────────────────────────────
studentRouter.get('/me/calendar', async (req, res, next) => {
  try {
    const ownerId = await effectiveId(req.user!.id);
    const { data: u } = await sip()
      .from('users')
      .select('current_ciclo_id, ciclo_type, monitor_id')
      .eq('id', ownerId)
      .maybeSingle();
    const [{ data: anchorMeta }, { data: dateChangesMeta }, { data: sched }] = await Promise.all([
      sip().from('meta').select('value').eq('user_id', ownerId).eq('key', 'calendar_anchor').maybeSingle(),
      sip().from('meta').select('value').eq('user_id', ownerId).eq('key', 'date_changes_count').maybeSingle(),
      sip().from('student_schedules').select('overrides').eq('user_id', ownerId).maybeSingle(),
    ]);
    const anchorDate = (anchorMeta?.value as string | null) ?? null;
    const calOverrides =
      sched?.overrides && typeof sched.overrides === 'object' && !Array.isArray(sched.overrides)
        ? (sched.overrides as Record<string, string>)
        : {};
    const milestones =
      anchorDate && u?.ciclo_type ? await buildMilestones(anchorDate, u.ciclo_type as string, calOverrides) : [];
    const { data: pendingMeta } = await sip()
      .from('meta')
      .select('value')
      .eq('user_id', ownerId)
      .eq('key', 'date_change_requested')
      .maybeSingle();
    return res.json({
      ciclo_type: u?.ciclo_type ?? null,
      anchor_date: anchorDate,
      milestones,
      date_changes: Number(dateChangesMeta?.value ?? 0),
      date_change_requested: pendingMeta?.value === true || pendingMeta?.value === 'true',
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /me/ciclo-history ─────────────────────────────────────────────────────────
studentRouter.get('/me/ciclo-history', async (req, res, next) => {
  try {
    const { data: history } = await sip()
      .from('ciclo_history')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('closed_at', { ascending: false });
    return res.json(
      (history || []).map((h: Record<string, unknown>) => ({
        id: h.id, ciclo_id: h.ciclo_id, ciclo_nome: h.ciclo_nome, ciclo_type: h.ciclo_type,
        ciclo_numero: h.ciclo_numero, data_inicio: h.data_inicio, data_fim: h.data_fim,
        progress_percent: h.progress_percent, completed_tasks: h.completed_tasks, total_tasks: h.total_tasks,
        total_posts: h.total_posts, total_leads: h.total_leads, sdb_submitted: h.sdb_submitted,
        sdb_vendas: h.sdb_vendas, sdb_roi: h.sdb_roi, sdb_nota: h.sdb_nota, closed_at: h.closed_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ── GET /me/reports ──────────────────────────────────────────────────────────────
studentRouter.get('/me/reports', async (req, res, next) => {
  try {
    const { data } = await sip()
      .from('reports')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });
    return res.json(data || []);
  } catch (err) {
    next(err);
  }
});

// ── GET /me/reports/unread-count ──────────────────────────────────────────────────
studentRouter.get('/me/reports/unread-count', async (req, res, next) => {
  try {
    const { data } = await sip()
      .from('reports')
      .select('id, admin_response, responded_at, read_at')
      .eq('user_id', req.user!.id);
    const unread = (data || []).filter(
      (r: { admin_response: string | null; responded_at: string | null; read_at: string | null }) =>
        r.admin_response && r.responded_at && !r.read_at,
    ).length;
    return res.json({ unread });
  } catch (err) {
    next(err);
  }
});

// ── GET /debriefing-status ─────────────────────────────────────────────────────────
studentRouter.get('/debriefing-status', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const ownerId = await effectiveId(req.user!.id);
    const { data: u } = await sip()
      .from('users')
      .select('ciclo_type, raiox_answers, approval_status, monitor_id, onboarding_done')
      .eq('id', ownerId)
      .maybeSingle();
    const taskline = await resolveTaskline({ id: ownerId, ciclo_type: u?.ciclo_type, raiox_answers: u?.raiox_answers });
    const { data: allTasks } = await sip()
      .from('tasks')
      .select('id')
      .eq('ciclo_type', u?.ciclo_type)
      .eq('taskline', taskline)
      .eq('active', true);
    const { data: userProgress } = await sip()
      .from('progress')
      .select('id')
      .eq('user_id', ownerId)
      .eq('completed', true);
    const cycleComplete = (userProgress || []).length === (allTasks || []).length && (allTasks || []).length > 0;
    const liberadoEOnboarded = u?.approval_status === 'approved' && !!u?.monitor_id && !!u?.onboarding_done;
    const { data: existeHistorico } = await sip()
      .from('debriefings')
      .select('id')
      .eq('user_id', ownerId)
      .eq('source', 'historico')
      .maybeSingle();
    const needs_historico_debriefing = liberadoEOnboarded && taskline === 'aurum_senior' && !existeHistorico;
    return res.json({ show_debriefing: cycleComplete, needs_historico_debriefing });
  } catch (err) {
    next(err);
  }
});

// ── GET /me/gamification ───────────────────────────────────────────────────────────
studentRouter.get('/me/gamification', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const ownerId = await effectiveId(req.user!.id);
    const { data: u } = await sip().from('users').select('ciclo_type, raiox_answers').eq('id', ownerId).maybeSingle();
    const taskline = await resolveTaskline({ id: ownerId, ciclo_type: u?.ciclo_type, raiox_answers: u?.raiox_answers });
    const [prog, { data: debriefing }, { data: userPosts }, { data: trafficDays }] = await Promise.all([
      buildProgress(ownerId, u?.ciclo_type as string, taskline),
      sip().from('debriefings').select('id').eq('user_id', ownerId).maybeSingle(),
      sip().from('posts').select('*').eq('user_id', ownerId),
      sip().from('traffic').select('date').eq('user_id', ownerId),
    ]);

    const completedProgress = (prog.allTasks as { id: string }[])
      .filter((t) => prog.progressMap[t.id]?.completed)
      .map((t) => prog.progressMap[t.id]!);

    const activityDates = new Set<string>();
    for (const p of completedProgress) if (p.completed_at) activityDates.add(p.completed_at.split('T')[0]!);
    for (const p of userPosts || []) if (p.date) activityDates.add(p.date);
    for (const t of trafficDays || []) if (t.date) activityDates.add(t.date);

    let streak = 0;
    const todayStr = new Date().toISOString().split('T')[0]!;
    const checkDate = new Date(todayStr + 'T12:00:00');
    if (!activityDates.has(todayStr)) checkDate.setDate(checkDate.getDate() - 1);
    while (true) {
      const ds = checkDate.toISOString().split('T')[0]!;
      if (!activityDates.has(ds)) break;
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    let xp = completedProgress.length * 10 + streak * 5;
    let completedStages = 0;
    const stageClearTimes: Record<string, number> = {};
    for (const stage of prog.stages) {
      const stageTasks = (prog.allTasks as { id: string; stage_id: string }[]).filter((t) => t.stage_id === stage.id);
      if (stageTasks.length > 0 && stageTasks.every((t) => prog.progressMap[t.id]?.completed)) {
        xp += 50;
        completedStages++;
        const latestMs = Math.max(
          ...stageTasks.map((t) => new Date(prog.progressMap[t.id]?.completed_at || 0).getTime()),
        );
        stageClearTimes[stage.id] = latestMs;
      }
    }
    xp += (userPosts || []).length * 5 + (trafficDays || []).length * 5;
    if (debriefing) xp += 100;

    let currentLevel = XP_LEVELS[0]!;
    for (const lvl of XP_LEVELS) if (xp >= lvl.xp_min) currentLevel = lvl;
    const nextLevel = XP_LEVELS.find((l) => l.level === currentLevel.level + 1) || null;
    const xpForNext = nextLevel ? nextLevel.xp_min : currentLevel.xp_min;
    const xpProgress = nextLevel
      ? Math.round(((xp - currentLevel.xp_min) / (xpForNext - currentLevel.xp_min)) * 100)
      : 100;

    const completedTaskIds = new Set(
      (prog.allTasks as { id: string }[]).filter((t) => prog.progressMap[t.id]?.completed).map((t) => t.id),
    );
    const allTaskIds = prog.allTasks as { id: string; stage_number: number; stage_id: string }[];
    const stage1Tasks = allTaskIds.filter((t) => t.stage_number === 1);
    const cycleComplete = allTaskIds.length > 0 && allTaskIds.every((t) => completedTaskIds.has(t.id));

    let conteudoEmDia = false;
    if ((userPosts || []).length >= 7) {
      const byWeek: Record<string, number> = {};
      for (const p of userPosts || []) {
        const d = new Date(p.date + 'T12:00:00');
        d.setDate(d.getDate() - d.getDay());
        const wk = d.toISOString().split('T')[0]!;
        byWeek[wk] = (byWeek[wk] || 0) + 1;
      }
      conteudoEmDia = Object.values(byWeek).some((c) => c >= 7);
    }
    let relampago = false;
    for (const stage of prog.stagesRaw as { id: string }[]) {
      if (!stageClearTimes[stage.id]) continue;
      const stageTasks = allTaskIds.filter((t) => t.stage_id === stage.id);
      const earliestMs = Math.min(
        ...stageTasks.map((t) => new Date(prog.progressMap[t.id]?.completed_at || Infinity).getTime()),
      );
      if ((stageClearTimes[stage.id]! - earliestMs) / 86400000 <= 5) {
        relampago = true;
        break;
      }
    }

    const posts = (userPosts || []).length;
    const traffic = (trafficDays || []).length;
    const badges = [
      { id: 'primeiro_passo', icon: '🚀', name: 'Primeiro Passo', description: 'Concluir a primeira tarefa', earned: completedProgress.length > 0 },
      { id: 'etapa1_completa', icon: '⚡', name: 'Etapa 1 Completa', description: 'Concluir todas as tarefas da Etapa 1', earned: stage1Tasks.length > 0 && stage1Tasks.every((t) => completedTaskIds.has(t.id)) },
      { id: 'relampago', icon: '⚡', name: 'Relâmpago', description: 'Concluir uma etapa em até 5 dias', earned: relampago },
      { id: 'fogo_vivo', icon: '🔥', name: 'Fogo Vivo', description: '7 dias seguidos com atividade', earned: streak >= 7 },
      { id: 'inabalaavel', icon: '🏅', name: 'Inabalável', description: '14 dias seguidos com atividade', earned: streak >= 14 },
      { id: 'conteudo_em_dia', icon: '📝', name: 'Conteúdo em Dia', description: '7 posts em uma mesma semana', earned: conteudoEmDia },
      { id: 'criador_conteudo', icon: '🎬', name: 'Criador de Conteúdo', description: '25 posts registrados', earned: posts >= 25 },
      { id: 'maratonista', icon: '🎯', name: 'Maratonista', description: '50 posts registrados', earned: posts >= 50, secret: posts < 25 },
      { id: 'analista', icon: '📊', name: 'Analista', description: '7 dias de tráfego preenchidos', earned: traffic >= 7 },
      { id: 'ciclo_completo', icon: '🏆', name: 'Ciclo Completo', description: 'Concluir todas as etapas do ciclo', earned: cycleComplete },
      { id: 'debriefing_entregue', icon: '📋', name: 'Debriefing Entregue', description: 'Enviar o debriefing final', earned: !!debriefing },
      { id: 'maquina', icon: '🤖', name: '???', description: 'Um badge secreto aguarda você...', earned: cycleComplete && !!debriefing, secret: !(cycleComplete && !!debriefing) },
    ];

    return res.json({
      xp,
      streak,
      level: currentLevel.level,
      level_name: currentLevel.name,
      xp_current_level: currentLevel.xp_min,
      xp_next_level: xpForNext,
      xp_progress_percent: xpProgress,
      completed_tasks: completedProgress.length,
      total_tasks: allTaskIds.length,
      completed_stages: completedStages,
      badges,
    });
  } catch (err) {
    next(err);
  }
});
