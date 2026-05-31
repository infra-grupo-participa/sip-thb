// Instagram — routers HTTP (porte do legado supabase/functions/sip-api/handlers/ig.ts).
//
// Três níveis de montagem (ver `mount` no retorno da task):
//   - igPublicRouter   → GET /ig/callback  (PÚBLICO; state é JWT, sem Bearer)
//   - igRouter         → /me/ig/* connect/status/metrics (autenticado, req.user)
//   - igAdminRouter    → /admin/ig/cohort, POST /admin/ig/collect-all,
//                        GET /admin/students/:id/ig-metrics  (sob adminGate)
//
// Toda a lógica de domínio/Graph API vive em services/instagram.ts. Aqui só
// orquestramos HTTP + autorização, no padrão dos demais routers (Router do
// express, sip() do db.js, try/catch → next(err)).
//
// Notas de contrato (paridade com o legado):
//   - O legado expunha /ig/connect-url, /ig/disconnect, /ig/collect-now, /ig/metrics
//     no namespace autenticado. Aqui mantemos os mesmos sufixos sob /me/ig/* como
//     pede a task (connect/status/metrics), preservando shape de resposta.
//   - supabase-js NÃO lança em write → checamos { error } onde relevante.

import { Router } from 'express';
import { sip } from '../db.js';
import { env } from '../env.js';
import {
  IG_FLAGS,
  SEVERITY_RANK,
  buildConnectUrl,
  verifyStateJwt,
  exchangeCodeForToken,
  exchangeForLongLived,
  getIgUserInfo,
  collectPosts,
  collectStories,
  collectAccountSnapshot,
  collectAll,
  computeEvolution,
  computeProjection,
  computeInsights,
  computeCurrentStage,
  computeMedian,
  computeIgFlags,
  computeStreak,
  type IgDb,
  type IgFlag,
  type IgSeverity,
  type PostRow,
  type SnapRow,
} from '../services/instagram.js';

// ── Routers exportados ──────────────────────────────────────────────────────
export const igPublicRouter = Router();
export const igRouter = Router();
export const igAdminRouter = Router();

const igConfigured = () => Boolean(env.META_APP_ID && env.META_REDIRECT_URI);

// ════════════════════════════════════════════════════════════════════════════
// PÚBLICO — GET /ig/callback (state é JWT; sem Bearer)
// ════════════════════════════════════════════════════════════════════════════
igPublicRouter.get('/ig/callback', async (req, res, next) => {
  try {
    const dashboardUrl = env.SIP_APP_URL ? `${env.SIP_APP_URL}/dashboard.html` : '';
    const redirect = (suffix: string) =>
      res.redirect(dashboardUrl ? `${dashboardUrl}${suffix}` : `https://sipmentor.com.br/dashboard.html${suffix}`);

    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const error = typeof req.query.error === 'string' ? req.query.error : null;

    if (error || !code || !state) return redirect('?ig_error=cancelled');

    const userId = verifyStateJwt(state);
    if (!userId) return redirect('?ig_error=invalid_state');

    const shortData = await exchangeCodeForToken(code);
    if (!shortData?.access_token) return redirect('?ig_error=token_exchange');

    const lltData = await exchangeForLongLived(shortData.access_token);
    if (!lltData?.access_token) return redirect('?ig_error=token_exchange');

    const tokenExpiresAt = new Date(Date.now() + (lltData.expires_in ?? 5_184_000) * 1000).toISOString();

    const userInfo = await getIgUserInfo(lltData.access_token);
    if (!userInfo?.id) return redirect('?ig_error=not_business');

    const { error: upsertErr } = await sip().from('ig_connections').upsert({
      user_id: userId,
      ig_user_id: userInfo.id,
      ig_username: userInfo.username ?? null,
      access_token: lltData.access_token,
      token_expires_at: tokenExpiresAt,
      status: 'active',
      connected_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

    if (upsertErr) {
      console.error('[ig] upsert failed', JSON.stringify(upsertErr));
      return redirect('?ig_error=db_error');
    }

    return redirect('?ig_connected=1');
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// AUTENTICADO — /me/ig/*
// ════════════════════════════════════════════════════════════════════════════

// GET /me/ig/connect — URL de autorização (state JWT). (legado: /ig/connect-url)
igRouter.get('/me/ig/connect', (req, res) => {
  if (!igConfigured()) return res.status(503).json({ error: 'Instagram não configurado' });
  return res.json({ url: buildConnectUrl(req.user!.id) });
});

// GET /me/ig/status — estado da conexão (resumo leve).
igRouter.get('/me/ig/status', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { data: conn } = await sip().from('ig_connections')
      .select('status, ig_username, last_collected_at, token_expires_at')
      .eq('user_id', userId).maybeSingle();
    if (!conn) return res.json({ connected: false });
    return res.json({
      connected: true,
      status: conn.status,
      ig_username: conn.ig_username,
      last_collected_at: conn.last_collected_at,
      token_expires_at: conn.token_expires_at,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /me/ig/connect — desconectar. (legado: /ig/disconnect)
igRouter.delete('/me/ig/connect', async (req, res, next) => {
  try {
    await sip().from('ig_connections').delete().eq('user_id', req.user!.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /me/ig/collect — coleta imediata (rate-limit: 1x/hora). (legado: /ig/collect-now)
igRouter.post('/me/ig/collect', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const db = sip();
    const { data: conn } = await db.from('ig_connections')
      .select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!conn) return res.status(404).json({ error: 'Nenhuma conta conectada' });

    const lastAt = conn.last_collected_at ? new Date(conn.last_collected_at as string).getTime() : 0;
    if (Date.now() - lastAt < 3_600_000) {
      return res.status(429).json({
        error: 'Coleta disponível uma vez por hora',
        next_at: new Date(lastAt + 3_600_000).toISOString(),
      });
    }

    const [postResult] = await Promise.allSettled([
      collectPosts(conn as Record<string, unknown>, db as IgDb),
      collectAccountSnapshot(conn as Record<string, unknown>, db as IgDb),
    ]);

    const collected = postResult.status === 'fulfilled' ? postResult.value.collected : 0;
    const errors = postResult.status === 'fulfilled'
      ? postResult.value.errors
      : [String((postResult as PromiseRejectedResult).reason)];

    return res.json({ collected, errors });
  } catch (err) {
    next(err);
  }
});

// GET /me/ig/metrics — dashboard de métricas do próprio aluno. (legado: /ig/metrics)
igRouter.get('/me/ig/metrics', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const db = sip();
    const { data: conn } = await db.from('ig_connections')
      .select('*').eq('user_id', userId).maybeSingle();
    if (!conn) return res.json({ connected: false });

    const [metricsRes, snapshotsRes, sipPostsRes] = await Promise.all([
      db.from('ig_post_metrics').select('*')
        .eq('user_id', userId)
        .order('collected_date', { ascending: false })
        .order('published_at', { ascending: false }),
      db.from('ig_account_snapshots')
        .select('snapshot_date, followers_count, following_count, media_count')
        .eq('user_id', userId)
        .order('snapshot_date', { ascending: false })
        .limit(30),
      db.from('posts').select('id, ig_media_id')
        .eq('user_id', userId)
        .not('ig_media_id', 'is', null),
    ]);

    const sipPostMap = new Map<string, string>();
    for (const p of ((sipPostsRes.data || []) as Record<string, unknown>[])) {
      sipPostMap.set(p.ig_media_id as string, p.id as string);
    }

    const seen = new Set<string>();
    const posts: Record<string, unknown>[] = [];
    for (const m of ((metricsRes.data || []) as Record<string, unknown>[])) {
      const mid = m.ig_media_id as string;
      if (seen.has(mid)) continue;
      seen.add(mid);
      posts.push({ ...m, sip_post_id: sipPostMap.get(mid) ?? null });
    }

    const totalReach = posts.reduce((s, p) => s + ((p.reach as number) || 0), 0);
    const totalImpressions = posts.reduce((s, p) => s + ((p.impressions as number) || (p.plays as number) || 0), 0);
    const totalEngagement = posts.reduce((s, p) => s + ((p.engagement as number) || 0), 0);
    const totalShares = posts.reduce((s, p) => s + ((p.shares as number) || 0), 0);

    const byType: Record<string, number> = {};
    for (const p of posts) {
      const t = (p.ig_media_type as string) || 'UNKNOWN';
      byType[t] = (byType[t] || 0) + 1;
    }

    const snapshots = (snapshotsRes.data || []) as Record<string, unknown>[];
    const latestSnap = snapshots[0] ?? null;

    const evolution = computeEvolution(posts as PostRow[], 7);
    const projection = computeProjection(snapshots as unknown as SnapRow[]);
    const insights = computeInsights(posts as PostRow[]);

    return res.json({
      connected: true,
      status: conn.status,
      ig_username: conn.ig_username,
      last_collected_at: conn.last_collected_at,
      account: latestSnap ? {
        followers_count: latestSnap.followers_count,
        media_count: latestSnap.media_count,
        snapshot_date: latestSnap.snapshot_date,
      } : null,
      followers_history: snapshots.slice(0, 14).map((s) => ({
        date: s.snapshot_date,
        followers: s.followers_count,
      })).reverse(),
      summary: {
        total_posts_collected: posts.length,
        avg_reach: posts.length ? Math.round(totalReach / posts.length) : 0,
        total_impressions: totalImpressions,
        total_engagement: totalEngagement,
        total_shares: totalShares,
        by_type: byType,
      },
      evolution,
      projection,
      insights,
      posts,
    });
  } catch (err) {
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN — /admin/ig/* (montar sob adminGate)
// ════════════════════════════════════════════════════════════════════════════

// POST /admin/ig/collect-all
igAdminRouter.post('/admin/ig/collect-all', async (_req, res, next) => {
  try {
    const result = await collectAll(sip() as IgDb, { doPosts: true });
    return res.json({ collected: result.collected, skipped: result.skipped, errors: result.errors });
  } catch (err) {
    next(err);
  }
});

// GET /admin/ig/cohort?window=7d|30d|since_palestra
igAdminRouter.get('/admin/ig/cohort', async (req, res, next) => {
  try {
    const rawWindow = typeof req.query.window === 'string' ? req.query.window : '7d';
    const windowParam: CohortWindow = (rawWindow === '30d' || rawWindow === 'since_palestra') ? rawWindow : '7d';
    const payload = await buildCohortResponse(sip() as IgDb, windowParam);
    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

// GET /admin/students/:id/ig-metrics
igAdminRouter.get('/admin/students/:id/ig-metrics', async (req, res, next) => {
  try {
    const payload = await buildAdminStudentIgMetrics(sip() as IgDb, req.params.id);
    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

// ── Cohort builder ────────────────────────────────────────────────────────────

type CohortWindow = '7d' | '30d' | 'since_palestra';

interface CohortRow {
  user_id: string;
  name: string;
  email: string;
  ciclo_type: string | null;
  is_platina: boolean;
  current_stage: number | null;
  total_stages: number | null;
  data_palestra: string | null;
  monitor_id: string | null;
  monitor_name: string | null;
  ig: {
    status: 'active' | 'revoked' | 'not_connected';
    ig_username: string | null;
    last_collected_at: string | null;
    followers_count: number | null;
    followers_snapshot_date: string | null;
  };
  window: {
    posts_count: number;
    avg_reach: number | null;
    total_impressions: number | null;
    total_engagement: number | null;
    by_type: Record<string, number>;
    last_post_at: string | null;
    days_since_last_post: number | null;
  };
  reach_drop_pct: number | null;
  manual_posts_count: number;
  matched_posts_count: number;
  streak: { days: number; last_post_date: string | null };
  flags: IgFlag[];
  severity: IgSeverity;
}

async function buildCohortResponse(db: IgDb, windowParam: CohortWindow) {
  if (!igConfigured()) {
    return {
      items: [],
      meta: {
        window: windowParam, configured: false, generated_at: new Date().toISOString(),
        total_students: 0, total_connected: 0, total_with_metrics_in_window: 0, cohorts: [],
      },
    };
  }

  const { data: studentsRaw } = await db.from('users')
    .select('id, name, email, ciclo_type, is_platina, monitor_id, role, is_socio')
    .eq('role', 'student')
    .neq('is_socio', true);

  const students = (studentsRaw || []) as Record<string, unknown>[];
  if (students.length === 0) {
    return {
      items: [],
      meta: {
        window: windowParam, configured: true, generated_at: new Date().toISOString(),
        total_students: 0, total_connected: 0, total_with_metrics_in_window: 0, cohorts: [],
      },
    };
  }

  const studentIds = students.map((s) => s.id as string);

  const POSTS_HORIZON_DAYS = 180;
  const horizonIso = new Date(Date.now() - POSTS_HORIZON_DAYS * 86_400_000).toISOString();
  const horizonDateOnly = horizonIso.slice(0, 10);
  const streakHorizonIso = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

  const igDailySafe = (q: PromiseLike<{ data: unknown; error: unknown }>) =>
    Promise.resolve(q).then((r) => (r.error ? { data: [] } : r)).catch(() => ({ data: [] }));

  const [
    { data: monitorsRaw },
    { data: connsRaw },
    { data: snapsRaw },
    { data: postMetricsRaw },
    { data: manualPostsRaw },
    { data: metaRaw },
    { data: tasksRaw },
    { data: stagesRaw },
    { data: progressRaw },
    { data: dailyActivityRaw },
  ] = await Promise.all([
    db.from('users').select('id, name').in('role', ['monitor', 'admin']),
    db.from('ig_connections').select('user_id, status, ig_username, last_collected_at').in('user_id', studentIds),
    db.from('ig_account_snapshots').select('user_id, snapshot_date, followers_count')
      .in('user_id', studentIds).order('snapshot_date', { ascending: false }),
    db.from('ig_post_metrics')
      .select('user_id, ig_media_id, ig_media_type, reach, impressions, engagement, published_at, collected_date')
      .in('user_id', studentIds)
      .gte('published_at', horizonIso)
      .order('collected_date', { ascending: false })
      .order('published_at', { ascending: false }),
    db.from('posts').select('user_id, date, ig_media_id, ig_shortcode')
      .in('user_id', studentIds).gte('date', horizonDateOnly),
    db.from('meta').select('user_id, key, value').in('user_id', studentIds).eq('key', 'data_palestra'),
    db.from('tasks').select('id, stage_id, ciclo_type').eq('active', true),
    db.from('stages').select('id, stage_number, ciclo_type').order('stage_number'),
    db.from('progress').select('user_id, task_id, completed').in('user_id', studentIds),
    igDailySafe(
      db.from('ig_daily_activity').select('user_id, activity_date, total_count')
        .in('user_id', studentIds)
        .gte('activity_date', streakHorizonIso)
        .order('activity_date', { ascending: true }) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
    ),
  ]);

  const monitors = (monitorsRaw || []) as Array<{ id: string; name: string }>;
  const conns = (connsRaw || []) as Array<Record<string, unknown>>;
  const snaps = (snapsRaw || []) as Array<{ user_id: string; snapshot_date: string; followers_count: number | null }>;
  const postMetrics = (postMetricsRaw || []) as Array<Record<string, unknown>>;
  const manualPosts = (manualPostsRaw || []) as Array<{ user_id: string; date: string; ig_media_id: string | null; ig_shortcode: string | null }>;
  const meta = (metaRaw || []) as Array<{ user_id: string; key: string; value: unknown }>;
  const tasks = (tasksRaw || []) as Array<{ id: string; stage_id: string; ciclo_type: string }>;
  const stages = (stagesRaw || []) as Array<{ id: string; stage_number: number; ciclo_type: string }>;
  const progress = (progressRaw || []) as Array<{ user_id: string; task_id: string; completed: boolean }>;
  const dailyActivity = (dailyActivityRaw || []) as Array<{ user_id: string; activity_date: string; total_count: number }>;

  const dailyByUser = new Map<string, Array<{ date: string; total: number }>>();
  for (const row of dailyActivity) {
    const arr = dailyByUser.get(row.user_id) ?? [];
    arr.push({ date: row.activity_date, total: row.total_count ?? 0 });
    dailyByUser.set(row.user_id, arr);
  }
  const todayIso = new Date().toISOString().slice(0, 10);

  const monitorNameById = new Map<string, string>();
  for (const m of monitors) monitorNameById.set(m.id, m.name);

  const connByUser = new Map<string, Record<string, unknown>>();
  for (const c of conns) connByUser.set(c.user_id as string, c);

  const palestraByUser = new Map<string, string>();
  for (const e of meta) if (typeof e.value === 'string') palestraByUser.set(e.user_id, e.value);

  const latestSnapByUser = new Map<string, { snapshot_date: string; followers_count: number | null }>();
  for (const s of snaps) if (!latestSnapByUser.has(s.user_id)) latestSnapByUser.set(s.user_id, s);

  const dedupedPosts = new Map<string, Record<string, unknown>>();
  for (const p of postMetrics) {
    const mid = p.ig_media_id as string;
    if (!dedupedPosts.has(mid)) dedupedPosts.set(mid, p);
  }
  const dedupedByUser = new Map<string, Array<Record<string, unknown>>>();
  for (const p of dedupedPosts.values()) {
    const uid = p.user_id as string;
    const arr = dedupedByUser.get(uid) ?? [];
    arr.push(p);
    dedupedByUser.set(uid, arr);
  }

  const manualByUser = new Map<string, Array<{ date: string; ig_media_id: string | null; ig_shortcode: string | null }>>();
  for (const p of manualPosts) {
    const arr = manualByUser.get(p.user_id) ?? [];
    arr.push(p);
    manualByUser.set(p.user_id, arr);
  }

  const currentStageByUser = new Map<string, { current: number; total: number }>();
  const progressByUser = new Map<string, Set<string>>();
  for (const pr of progress) {
    if (!pr.completed) continue;
    const set = progressByUser.get(pr.user_id) ?? new Set<string>();
    set.add(pr.task_id);
    progressByUser.set(pr.user_id, set);
  }
  const stagesByCiclo = new Map<string, Array<{ id: string; stage_number: number }>>();
  const tasksByCiclo = new Map<string, Array<{ id: string; stage_id: string }>>();
  for (const st of stages) {
    const arr = stagesByCiclo.get(st.ciclo_type) ?? [];
    arr.push({ id: st.id, stage_number: st.stage_number });
    stagesByCiclo.set(st.ciclo_type, arr);
  }
  for (const t of tasks) {
    const arr = tasksByCiclo.get(t.ciclo_type) ?? [];
    arr.push({ id: t.id, stage_id: t.stage_id });
    tasksByCiclo.set(t.ciclo_type, arr);
  }
  for (const s of students) {
    const ciclo = s.ciclo_type as string | null;
    if (!ciclo) { currentStageByUser.set(s.id as string, { current: 0, total: 0 }); continue; }
    const cTasks = tasksByCiclo.get(ciclo) ?? [];
    const cStages = stagesByCiclo.get(ciclo) ?? [];
    const doneSet = progressByUser.get(s.id as string) ?? new Set<string>();
    currentStageByUser.set(s.id as string, {
      current: computeCurrentStage(cStages, cTasks, doneSet),
      total: cStages.length,
    });
  }

  const nowMs = Date.now();
  function windowBounds(userId: string): { fromMs: number; toMs: number; days: number; prevFromMs: number; prevToMs: number } {
    if (windowParam === '7d') {
      const d = 7;
      return { fromMs: nowMs - d * 86_400_000, toMs: nowMs + 1, days: d, prevFromMs: nowMs - 2 * d * 86_400_000, prevToMs: nowMs - d * 86_400_000 };
    }
    if (windowParam === '30d') {
      const d = 30;
      return { fromMs: nowMs - d * 86_400_000, toMs: nowMs + 1, days: d, prevFromMs: nowMs - 2 * d * 86_400_000, prevToMs: nowMs - d * 86_400_000 };
    }
    const palestra = palestraByUser.get(userId);
    if (!palestra) return { fromMs: nowMs, toMs: nowMs, days: 0, prevFromMs: nowMs, prevToMs: nowMs };
    const palestraMs = new Date(palestra + 'T00:00:00').getTime();
    const days = Math.max(1, Math.round((nowMs - palestraMs) / 86_400_000));
    return { fromMs: palestraMs, toMs: nowMs + 1, days, prevFromMs: palestraMs - days * 86_400_000, prevToMs: palestraMs };
  }

  type PrelimRow = Omit<CohortRow, 'flags' | 'severity'> & { _windowDays: number; _connected: boolean; _prevAvgReach: number | null };
  const prelim: PrelimRow[] = [];

  for (const s of students) {
    const uid = s.id as string;
    const stage = currentStageByUser.get(uid) ?? { current: 0, total: 0 };
    const conn = connByUser.get(uid);
    const userPosts = dedupedByUser.get(uid) ?? [];
    const { fromMs, toMs, days, prevFromMs, prevToMs } = windowBounds(uid);

    const inWindow = userPosts.filter((p) => {
      const t = p.published_at ? new Date(p.published_at as string).getTime() : 0;
      return t >= fromMs && t < toMs;
    });
    const inPrev = userPosts.filter((p) => {
      const t = p.published_at ? new Date(p.published_at as string).getTime() : 0;
      return t >= prevFromMs && t < prevToMs;
    });

    const reachSum = inWindow.reduce((acc, p) => acc + ((p.reach as number) || 0), 0);
    const impressionsSum = inWindow.reduce((acc, p) => acc + ((p.impressions as number) || 0), 0);
    const engagementSum = inWindow.reduce((acc, p) => acc + ((p.engagement as number) || 0), 0);
    const prevReachSum = inPrev.reduce((acc, p) => acc + ((p.reach as number) || 0), 0);

    const avgReach = inWindow.length > 0 ? Math.round(reachSum / inWindow.length) : null;
    const prevAvgReach = inPrev.length > 0 ? Math.round(prevReachSum / inPrev.length) : null;
    const reachDropPct = (prevAvgReach != null && prevAvgReach > 0 && avgReach != null)
      ? Math.round(((avgReach - prevAvgReach) / prevAvgReach) * 100)
      : null;

    const byType: Record<string, number> = {};
    for (const p of inWindow) {
      const t = (p.ig_media_type as string) || 'OTHER';
      byType[t] = (byType[t] || 0) + 1;
    }
    const lastPostAtMs = inWindow.reduce((max, p) => {
      const t = p.published_at ? new Date(p.published_at as string).getTime() : 0;
      return Math.max(max, t);
    }, 0);
    const lastPostAt = lastPostAtMs > 0 ? new Date(lastPostAtMs).toISOString() : null;
    const daysSinceLastPost = lastPostAtMs > 0 ? Math.floor((nowMs - lastPostAtMs) / 86_400_000) : null;

    const userManuals = manualByUser.get(uid) ?? [];
    const manualsInWindow = userManuals.filter((p) => {
      const t = p.date ? new Date(p.date + 'T00:00:00').getTime() : 0;
      return t >= fromMs && t < toMs;
    });
    const matchedCount = manualsInWindow.filter((p) => p.ig_media_id != null).length;

    const snap = latestSnapByUser.get(uid);

    const connStatus = conn ? (conn.status as 'active' | 'revoked' | 'error') : null;
    const connected = connStatus === 'active';
    const ig = {
      status: !conn ? 'not_connected' as const : (connStatus === 'active' ? 'active' as const : 'revoked' as const),
      ig_username: (conn?.ig_username as string) ?? null,
      last_collected_at: (conn?.last_collected_at as string) ?? null,
      followers_count: snap?.followers_count ?? null,
      followers_snapshot_date: snap?.snapshot_date ?? null,
    };

    prelim.push({
      user_id: uid,
      name: (s.name as string) ?? '',
      email: (s.email as string) ?? '',
      ciclo_type: (s.ciclo_type as string) ?? null,
      is_platina: s.is_platina === true,
      current_stage: stage.total > 0 ? stage.current : null,
      total_stages: stage.total || null,
      data_palestra: palestraByUser.get(uid) ?? null,
      monitor_id: (s.monitor_id as string) ?? null,
      monitor_name: s.monitor_id ? (monitorNameById.get(s.monitor_id as string) ?? null) : null,
      ig,
      window: {
        posts_count: inWindow.length,
        avg_reach: avgReach,
        total_impressions: inWindow.length > 0 ? impressionsSum : null,
        total_engagement: inWindow.length > 0 ? engagementSum : null,
        by_type: byType,
        last_post_at: lastPostAt,
        days_since_last_post: daysSinceLastPost,
      },
      reach_drop_pct: reachDropPct,
      manual_posts_count: manualsInWindow.length,
      matched_posts_count: matchedCount,
      streak: computeStreak(dailyByUser.get(uid) ?? [], todayIso),
      _windowDays: days,
      _connected: connected,
      _prevAvgReach: prevAvgReach,
    });
  }

  type CohortKey = string;
  function cohortKey(ciclo: string | null, stage: number | null): CohortKey | null {
    if (!ciclo || stage == null) return null;
    const lo = Math.max(1, stage - 1);
    const hi = stage + 1;
    return `${ciclo}|${lo}-${hi}`;
  }

  const cohortMembers = new Map<CohortKey, number[]>();
  for (const r of prelim) {
    if (!r._connected || r.window.avg_reach == null) continue;
    const key = cohortKey(r.ciclo_type, r.current_stage);
    if (!key) continue;
    const arr = cohortMembers.get(key) ?? [];
    arr.push(r.window.avg_reach);
    cohortMembers.set(key, arr);
  }

  const cohortMedian = new Map<CohortKey, number | null>();
  const cohortMeta: Array<{ ciclo_type: string; stage_min: number; stage_max: number; size: number; median_avg_reach: number | null }> = [];
  for (const [key, values] of cohortMembers) {
    const size = values.length;
    const median = size >= IG_FLAGS.COHORT_MIN_SIZE ? computeMedian(values) : null;
    cohortMedian.set(key, median);
    const [ciclo, range] = key.split('|');
    const [lo, hi] = (range ?? '0-0').split('-').map(Number);
    cohortMeta.push({ ciclo_type: ciclo ?? '', stage_min: lo ?? 0, stage_max: hi ?? 0, size, median_avg_reach: median });
  }

  const items: CohortRow[] = prelim.map((r) => {
    const key = cohortKey(r.ciclo_type, r.current_stage);
    const median = key ? (cohortMedian.get(key) ?? null) : null;
    const { flags, severity } = computeIgFlags({
      connected: r._connected,
      status: r.ig.status === 'not_connected' ? null : (r.ig.status as 'active' | 'revoked'),
      posts_count: r.window.posts_count,
      avg_reach: r.window.avg_reach,
      prev_avg_reach: r._prevAvgReach,
      cohort_median: median,
      window_days: r._windowDays,
    });
    const { _windowDays: _w, _connected: _c, _prevAvgReach: _p, ...clean } = r;
    return { ...clean, flags, severity };
  });

  items.sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name, 'pt-BR');
  });

  return {
    items,
    meta: {
      window: windowParam,
      configured: true,
      generated_at: new Date().toISOString(),
      total_students: students.length,
      total_connected: items.filter((i) => i.ig.status === 'active').length,
      total_with_metrics_in_window: items.filter((i) => i.window.posts_count > 0).length,
      cohorts: cohortMeta,
    },
  };
}

// ── /admin/students/:id/ig-metrics (versão expandida) ──────────────────────────

async function buildAdminStudentIgMetrics(db: IgDb, studentId: string) {
  const { data: conn } = await db.from('ig_connections')
    .select('status, ig_username, last_collected_at, ig_user_id')
    .eq('user_id', studentId).maybeSingle();

  if (!conn) {
    const { data: manuals } = await db.from('posts')
      .select('id, platform, format, date, link, ig_shortcode')
      .eq('user_id', studentId)
      .is('ig_media_id', null)
      .order('date', { ascending: false });
    return { connected: false, unmatched_posts: manuals || [] };
  }

  const { data: student } = await db.from('users')
    .select('id, name, ciclo_type')
    .eq('id', studentId).maybeSingle();
  const cicloType = (student?.ciclo_type as string) ?? null;

  const daily30dIso = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const stories7dIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const streak60dIso = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

  const safe = (q: PromiseLike<{ data: unknown; error: unknown }>) =>
    Promise.resolve(q).then((r) => (r.error ? { data: [] } : r)).catch(() => ({ data: [] }));

  const [metricsRes, snapshotsRes, sipPostsRes, unmatchedRes, dailyRes, storiesRes, streakRes] = await Promise.all([
    db.from('ig_post_metrics').select('*')
      .eq('user_id', studentId)
      .order('collected_date', { ascending: false })
      .order('published_at', { ascending: false }),
    db.from('ig_account_snapshots')
      .select('snapshot_date, followers_count, following_count, media_count')
      .eq('user_id', studentId)
      .order('snapshot_date', { ascending: false })
      .limit(30),
    db.from('posts').select('id, ig_media_id')
      .eq('user_id', studentId)
      .not('ig_media_id', 'is', null),
    db.from('posts').select('id, platform, format, date, link, ig_shortcode')
      .eq('user_id', studentId)
      .is('ig_media_id', null)
      .order('date', { ascending: false }),
    safe(
      db.from('ig_daily_activity')
        .select('activity_date, feed_count, reel_count, carousel_count, story_count, total_count, total_reach')
        .eq('user_id', studentId)
        .gte('activity_date', daily30dIso)
        .order('activity_date', { ascending: true }) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
    ),
    safe(
      db.from('ig_story_metrics')
        .select('ig_media_id, media_type, thumbnail_url, permalink, published_at, reach, views, replies, exits, profile_visits, follows, is_expired')
        .eq('user_id', studentId)
        .gte('published_at', stories7dIso)
        .order('published_at', { ascending: false }) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
    ),
    safe(
      db.from('ig_daily_activity')
        .select('activity_date, total_count')
        .eq('user_id', studentId)
        .gte('activity_date', streak60dIso) as unknown as PromiseLike<{ data: unknown; error: unknown }>,
    ),
  ]);

  const sipPostMap = new Map<string, string>();
  for (const p of ((sipPostsRes.data || []) as Record<string, unknown>[])) {
    sipPostMap.set(p.ig_media_id as string, p.id as string);
  }

  const seen = new Set<string>();
  const posts: Record<string, unknown>[] = [];
  for (const m of ((metricsRes.data || []) as Record<string, unknown>[])) {
    const mid = m.ig_media_id as string;
    if (seen.has(mid)) continue;
    seen.add(mid);
    posts.push({ ...m, sip_post_id: sipPostMap.get(mid) ?? null });
  }

  const totalReach = posts.reduce((s, p) => s + ((p.reach as number) || 0), 0);
  const totalImpressions = posts.reduce((s, p) => s + ((p.impressions as number) || (p.plays as number) || 0), 0);
  const totalEngagement = posts.reduce((s, p) => s + ((p.engagement as number) || 0), 0);

  const byType: Record<string, number> = {};
  for (const p of posts) {
    const t = (p.ig_media_type as string) || 'UNKNOWN';
    byType[t] = (byType[t] || 0) + 1;
  }

  const snapshots = (snapshotsRes.data || []) as Record<string, unknown>[];
  const latestSnap = snapshots[0] ?? null;

  const evolution = computeEvolution(posts as PostRow[], 7);

  let cohortComparison: {
    ciclo_type: string;
    stage_range: [number, number];
    cohort_size: number;
    delta_vs_median: { avg_reach_pct: number | null; posts_count_pct: number | null };
  } | null = null;

  if (cicloType) {
    const [{ data: cStages }, { data: cTasks }, { data: cProgress }] = await Promise.all([
      db.from('stages').select('id, stage_number, ciclo_type').eq('ciclo_type', cicloType).order('stage_number'),
      db.from('tasks').select('id, stage_id, ciclo_type').eq('active', true).eq('ciclo_type', cicloType),
      db.from('progress').select('user_id, task_id, completed').eq('user_id', studentId).eq('completed', true),
    ]);
    const stagesArr = (cStages || []) as Array<{ id: string; stage_number: number }>;
    const tasksArr = (cTasks || []) as Array<{ id: string; stage_id: string }>;

    if (stagesArr.length > 0 && tasksArr.length > 0) {
      const doneIds = new Set<string>(((cProgress || []) as Record<string, unknown>[]).map((p) => p.task_id as string));
      const curStage = computeCurrentStage(stagesArr, tasksArr, doneIds);
      const lo = Math.max(1, curStage - 1);
      const hi = curStage + 1;

      const { data: peers } = await db.from('users')
        .select('id')
        .eq('ciclo_type', cicloType)
        .eq('role', 'student')
        .neq('is_socio', true)
        .neq('id', studentId);
      const peerIds = ((peers || []) as Record<string, unknown>[]).map((p) => p.id as string);

      if (peerIds.length > 0) {
        const sinceMs = Date.now() - 30 * 86_400_000;
        const sinceIso = new Date(sinceMs).toISOString();
        const [{ data: peerProgress }, { data: peerMetricsRaw }] = await Promise.all([
          db.from('progress').select('user_id, task_id, completed').in('user_id', peerIds).eq('completed', true),
          db.from('ig_post_metrics').select('user_id, ig_media_id, reach, published_at, collected_date')
            .in('user_id', peerIds).gte('published_at', sinceIso).order('collected_date', { ascending: false }),
        ]);

        const peerDoneByUser = new Map<string, Set<string>>();
        for (const pr of (peerProgress || []) as Array<{ user_id: string; task_id: string }>) {
          const set = peerDoneByUser.get(pr.user_id) ?? new Set<string>();
          set.add(pr.task_id);
          peerDoneByUser.set(pr.user_id, set);
        }

        const peersInRange = new Set<string>();
        for (const pid of peerIds) {
          const peerDone = peerDoneByUser.get(pid) ?? new Set<string>();
          const peerStage = computeCurrentStage(stagesArr, tasksArr, peerDone);
          if (peerStage >= lo && peerStage <= hi) peersInRange.add(pid);
        }

        const peerPostsByUser = new Map<string, Array<{ reach: number | null }>>();
        const peerSeen = new Map<string, Set<string>>();
        for (const m of ((peerMetricsRaw || []) as Array<Record<string, unknown>>)) {
          const uid = m.user_id as string;
          if (!peersInRange.has(uid)) continue;
          const mid = m.ig_media_id as string;
          let seenSet = peerSeen.get(uid);
          if (!seenSet) { seenSet = new Set(); peerSeen.set(uid, seenSet); }
          if (seenSet.has(mid)) continue;
          seenSet.add(mid);
          const arr = peerPostsByUser.get(uid) ?? [];
          arr.push({ reach: (m.reach as number) ?? null });
          peerPostsByUser.set(uid, arr);
        }

        const peerAvgReach: number[] = [];
        const peerPostCounts: number[] = [];
        for (const arr of peerPostsByUser.values()) {
          if (arr.length === 0) continue;
          const sum = arr.reduce((s, p) => s + (p.reach || 0), 0);
          peerAvgReach.push(Math.round(sum / arr.length));
          peerPostCounts.push(arr.length);
        }

        const studentPostsIn30d = posts.filter((p) => {
          const ts = p.published_at ? new Date(p.published_at as string).getTime() : 0;
          return ts >= sinceMs;
        });
        const studentReach30d = studentPostsIn30d.reduce((s, p) => s + ((p.reach as number) || 0), 0);
        const studentAvgReach30d = studentPostsIn30d.length > 0 ? Math.round(studentReach30d / studentPostsIn30d.length) : 0;
        const studentPostsCount30d = studentPostsIn30d.length;

        const cohortSize = peerAvgReach.length;
        const pctDelta = (a: number, b: number): number | null => (b === 0 ? (a > 0 ? null : 0) : Math.round(((a - b) / b) * 100));

        cohortComparison = {
          ciclo_type: cicloType,
          stage_range: [lo, hi],
          cohort_size: cohortSize,
          delta_vs_median: cohortSize >= IG_FLAGS.COHORT_MIN_SIZE
            ? {
                avg_reach_pct: pctDelta(studentAvgReach30d, computeMedian(peerAvgReach)),
                posts_count_pct: pctDelta(studentPostsCount30d, computeMedian(peerPostCounts)),
              }
            : { avg_reach_pct: null, posts_count_pct: null },
        };
      }
    }
  }

  const dailyRows = ((dailyRes as { data: unknown }).data as Array<Record<string, unknown>>) || [];
  const storiesRows = ((storiesRes as { data: unknown }).data as Array<Record<string, unknown>>) || [];
  const streakRows = ((streakRes as { data: unknown }).data as Array<{ activity_date: string; total_count: number }>) || [];

  return {
    connected: true,
    status: conn.status,
    ig_username: conn.ig_username,
    last_collected_at: conn.last_collected_at,
    account: latestSnap ? {
      followers_count: latestSnap.followers_count,
      media_count: latestSnap.media_count,
      snapshot_date: latestSnap.snapshot_date,
    } : null,
    followers_history: snapshots.slice(0, 14).map((s) => ({ date: s.snapshot_date, followers: s.followers_count })).reverse(),
    summary: {
      total_posts_collected: posts.length,
      avg_reach: posts.length ? Math.round(totalReach / posts.length) : 0,
      total_impressions: totalImpressions,
      total_engagement: totalEngagement,
      by_type: byType,
    },
    evolution,
    cohort_comparison: cohortComparison,
    posts,
    unmatched_posts: unmatchedRes.data || [],
    daily_activity: dailyRows.map((r) => ({
      date: r.activity_date,
      feed: r.feed_count ?? 0,
      reel: r.reel_count ?? 0,
      carousel: r.carousel_count ?? 0,
      story: r.story_count ?? 0,
      total: r.total_count ?? 0,
      reach: r.total_reach ?? 0,
    })),
    recent_stories: storiesRows.filter((r, i, arr) => arr.findIndex((x) => x.ig_media_id === r.ig_media_id) === i),
    streak: computeStreak(
      streakRows.map((r) => ({ date: r.activity_date, total: r.total_count ?? 0 })),
      new Date().toISOString().slice(0, 10),
    ),
  };
}
