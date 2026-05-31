// Instagram (Instagram Login API / graph.instagram.com) — porte fiel do legado:
//   - supabase/functions/_shared/domain/ig.ts        (Graph API helpers, flags, streak)
//   - supabase/functions/_shared/domain/ig-flags.mjs (computeIgFlags + constantes)
//   - supabase/functions/_shared/domain/ig-streak.mjs(computeStreak)
//   - supabase/functions/sip-api/handlers/ig.ts      (OAuth/coleta/analytics)
//   - supabase/functions/ig-collect/index.ts         (coleta em lote + token renewal)
//
// Aqui concentramos toda a lógica de domínio/serviço (Graph API, OAuth state JWT,
// coleta de posts/stories/snapshots, flags/streak, analytics). O router (ig.ts)
// só orquestra HTTP + autorização.
//
// Notas de portabilidade:
//  - djwt (Deno) → jsonwebtoken (Node), mantendo HS256 + claims (aud 'ig:oauth').
//  - O state JWT usa SIP_JWT_SECRET (mesmo segredo do login), como no legado.
//  - supabase-js NÃO lança em write → checamos { error } onde relevante.
//  - Sem `noUncheckedIndexedAccess` surpresas: acessos indexados tratados.

import jwt from 'jsonwebtoken';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

// ── Tipos do client schema-scoped (sip()) ──────────────────────────────────────
// sip() devolve um PostgrestClient com schema 'sip' já aplicado. Tipamos como
// `IgDb` (subset usado aqui) para evitar `any` mantendo o build estrito.
export type IgDb = ReturnType<SupabaseClient['schema']>;

// ── Graph API constants ─────────────────────────────────────────────────────
export const IG_API_BASE = 'https://graph.instagram.com';
export const META_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 20 posts × ~250ms por insight ≈ 5s/conta. BATCH_SIZE=10 em paralelo.
const MAX_POSTS = 20;
const BATCH_SIZE = 10;

// ── Flags (porte de ig-flags.mjs) ─────────────────────────────────────────────

export const IG_FLAGS = {
  NO_POSTS_DAYS: 7,
  LOW_VOLUME_30D_THRESHOLD: 3,
  REACH_DROP_PCT: -50,
  BELOW_COHORT_RATIO: 0.5,
  COHORT_MIN_SIZE: 3,
} as const;

export type IgFlag =
  | 'not_connected'
  | 'revoked'
  | 'no_posts'
  | 'low_volume'
  | 'reach_drop'
  | 'below_cohort'
  | 'ok';

export type IgSeverity = 'red' | 'orange' | 'yellow' | 'green';

const FLAG_SEVERITY: Record<IgFlag, IgSeverity> = {
  not_connected: 'red',
  revoked: 'red',
  no_posts: 'orange',
  low_volume: 'orange',
  reach_drop: 'yellow',
  below_cohort: 'yellow',
  ok: 'green',
};

export const SEVERITY_RANK: Record<IgSeverity, number> = { red: 3, orange: 2, yellow: 1, green: 0 };

export interface IgFlagInput {
  connected: boolean;
  status: 'active' | 'revoked' | 'error' | null;
  posts_count: number;
  avg_reach: number | null;
  prev_avg_reach: number | null;
  cohort_median: number | null;
  window_days: number;
}

export interface IgFlagOutput {
  flags: IgFlag[];
  severity: IgSeverity;
}

export function computeIgFlags(input: IgFlagInput): IgFlagOutput {
  const flags: IgFlag[] = [];

  if (!input.connected) {
    flags.push('not_connected');
    return { flags, severity: FLAG_SEVERITY.not_connected };
  }
  if (input.status === 'revoked') {
    flags.push('revoked');
    return { flags, severity: FLAG_SEVERITY.revoked };
  }

  if (input.posts_count === 0 && input.window_days <= IG_FLAGS.NO_POSTS_DAYS) {
    flags.push('no_posts');
  }
  if (input.window_days >= 30 && input.posts_count < IG_FLAGS.LOW_VOLUME_30D_THRESHOLD) {
    flags.push('low_volume');
  }

  if (input.posts_count > 0) {
    if (input.prev_avg_reach != null && input.prev_avg_reach > 0 && input.avg_reach != null) {
      const dropPct = ((input.avg_reach - input.prev_avg_reach) / input.prev_avg_reach) * 100;
      if (dropPct <= IG_FLAGS.REACH_DROP_PCT) flags.push('reach_drop');
    }
    if (
      input.cohort_median != null && input.cohort_median > 0 &&
      input.avg_reach != null &&
      input.avg_reach < input.cohort_median * IG_FLAGS.BELOW_COHORT_RATIO
    ) {
      flags.push('below_cohort');
    }
  }

  if (flags.length === 0) {
    flags.push('ok');
    return { flags, severity: 'green' };
  }

  let worst: IgSeverity = 'green';
  for (const f of flags) {
    const s = FLAG_SEVERITY[f];
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return { flags, severity: worst };
}

// ── Streak (porte de ig-streak.mjs) ───────────────────────────────────────────

/** ISO date string (YYYY-MM-DD) para um timestamp UTC em ms. */
function isoDateOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Streak atual: dias consecutivos terminando em hoje OU ontem (tolerância ao
 * cron de madrugada). Um dia com total > 0 conta como "postou".
 */
export function computeStreak(
  rows: Array<{ date: string; total: number }>,
  todayIso: string,
): { days: number; last_post_date: string | null } {
  if (!rows || rows.length === 0) return { days: 0, last_post_date: null };

  const byDate = new Map<string, number>();
  let globalLastPost: string | null = null;
  for (const r of rows) {
    byDate.set(r.date, r.total);
    if ((r.total ?? 0) > 0) {
      if (!globalLastPost || r.date > globalLastPost) globalLastPost = r.date;
    }
  }

  const todayMs = new Date(todayIso + 'T00:00:00Z').getTime();
  const todayStr = todayIso;
  const yesterdayStr = isoDateOf(todayMs - 86_400_000);

  const startDate =
    (byDate.get(todayStr) ?? 0) > 0 ? todayStr
    : (byDate.get(yesterdayStr) ?? 0) > 0 ? yesterdayStr
    : null;

  if (!startDate) return { days: 0, last_post_date: globalLastPost };

  let days = 0;
  let curMs = new Date(startDate + 'T00:00:00Z').getTime();
  while ((byDate.get(isoDateOf(curMs)) ?? 0) > 0) {
    days++;
    curMs -= 86_400_000;
  }

  return { days, last_post_date: startDate };
}

// ── Shortcode / metric helpers ────────────────────────────────────────────────

export function extractIgShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return match ? (match[1] ?? null) : null;
}

function _fullMetrics(mediaType: string): string {
  const base = 'reach,views,likes,comments,shares,saved,total_interactions';
  if (mediaType === 'REEL') return `${base},plays,profile_visits`;
  if (mediaType === 'VIDEO') return base;
  return `${base},profile_visits,follows`;
}

const _SAFE_METRICS = 'reach,likes,comments,saved,total_interactions';

function _parseInsights(json: Record<string, unknown>): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of ((json.data || []) as Record<string, unknown>[])) {
    const name = entry.name as string;
    const vals = (entry.values as Array<{ value: number }>) || [];
    map[name] = vals[0]?.value
      ?? ((entry.total_value as Record<string, unknown>)?.value as number)
      ?? 0;
  }
  return map;
}

/**
 * Insights lifetime de um media. full→safe fallback; mapeia `views`→`impressions`
 * e `total_interactions`→`engagement` para preservar nomes de colunas.
 */
export async function fetchPostInsights(
  mediaId: string,
  mediaType: string,
  token: string,
): Promise<Record<string, number>> {
  const tryFetch = async (metrics: string, attempt: string): Promise<Record<string, number> | null> => {
    const res = await fetch(
      `${IG_API_BASE}/${mediaId}/insights?metric=${metrics}&period=lifetime&access_token=${token}`,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[ig] insights ${attempt} failed media=${mediaId} type=${mediaType} status=${res.status} body=${body.slice(0, 300)}`);
      return null;
    }
    return _parseInsights(await res.json() as Record<string, unknown>);
  };

  const raw = (await tryFetch(_fullMetrics(mediaType), 'full'))
    ?? (await tryFetch(_SAFE_METRICS, 'safe'))
    ?? {};

  const out: Record<string, number> = { ...raw };
  if (raw.views != null) out.impressions = raw.views;
  if (raw.total_interactions != null) out.engagement = raw.total_interactions;
  return out;
}

// ── Stories ───────────────────────────────────────────────────────────────────

export interface IgStoryItem {
  id: string;
  media_type: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

const _STORY_FULL_METRICS = 'reach,views,replies,exits,navigation,taps_forward,taps_back,profile_visits,follows';
const _STORY_SAFE_METRICS = 'reach,views,replies,exits';

export async function fetchUserStories(igUserId: string, token: string): Promise<IgStoryItem[]> {
  const fields = 'id,media_type,media_url,thumbnail_url,permalink,timestamp';
  const res = await fetch(
    `${IG_API_BASE}/${igUserId}/stories?fields=${fields}&access_token=${token}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ig] stories fetch failed ig_user_id=${igUserId} status=${res.status} body=${body.slice(0, 300)}`);
    return [];
  }
  const json = await res.json() as { data?: unknown[] };
  return (json.data || []) as IgStoryItem[];
}

export async function fetchStoryInsights(mediaId: string, token: string): Promise<Record<string, number>> {
  const tryFetch = async (metrics: string, attempt: string): Promise<Record<string, number> | null> => {
    const res = await fetch(
      `${IG_API_BASE}/${mediaId}/insights?metric=${metrics}&period=lifetime&access_token=${token}`,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[ig] story insights ${attempt} failed media=${mediaId} status=${res.status} body=${body.slice(0, 300)}`);
      return null;
    }
    return _parseInsights(await res.json() as Record<string, unknown>);
  };

  return (await tryFetch(_STORY_FULL_METRICS, 'full'))
    ?? (await tryFetch(_STORY_SAFE_METRICS, 'safe'))
    ?? {};
}

export async function fetchAccountFields(
  igUserId: string,
  token: string,
): Promise<{ followers_count?: number; media_count?: number } | null> {
  const res = await fetch(
    `${IG_API_BASE}/${igUserId}?fields=followers_count,media_count&access_token=${token}`,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[ig] account fields failed ig_user_id=${igUserId} status=${res.status} body=${body.slice(0, 300)}`);
    return null;
  }
  return res.json() as Promise<{ followers_count?: number; media_count?: number }>;
}

// ── OAuth state JWT (djwt → jsonwebtoken) ─────────────────────────────────────

export function makeStateJwt(userId: string): string {
  return jwt.sign(
    {
      sub: userId,
      aud: 'ig:oauth',
      nonce: cryptoRandom(),
    },
    env.SIP_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '10m' },
  );
}

export function verifyStateJwt(state: string): string | null {
  try {
    const payload = jwt.verify(state, env.SIP_JWT_SECRET, {
      algorithms: ['HS256'],
      audience: 'ig:oauth',
    }) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

function cryptoRandom(): string {
  // Node 18+ tem globalThis.crypto.randomUUID.
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

export function buildConnectUrl(userId: string): string {
  const state = makeStateJwt(userId);
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: env.META_REDIRECT_URI,
    scope: META_SCOPES.join(','),
    response_type: 'code',
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

// ── Instagram Login API token exchange ────────────────────────────────────────

export async function exchangeCodeForToken(code: string): Promise<{ access_token: string; user_id: string } | null> {
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: env.META_REDIRECT_URI,
    code,
  });
  const res = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: params });
  if (!res.ok) { console.error('[ig] exchangeCode failed', await res.text()); return null; }
  return res.json() as Promise<{ access_token: string; user_id: string }>;
}

export async function exchangeForLongLived(shortToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_id: env.META_APP_ID,
    client_secret: env.META_APP_SECRET,
    access_token: shortToken,
  });
  const res = await fetch(`${IG_API_BASE}/access_token?${params}`);
  if (!res.ok) { console.error('[ig] exchangeLLT failed', await res.text()); return null; }
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

export async function getIgUserInfo(accessToken: string): Promise<{ id: string; username: string } | null> {
  const res = await fetch(`${IG_API_BASE}/me?fields=id,username&access_token=${accessToken}`);
  if (!res.ok) return null;
  return res.json() as Promise<{ id: string; username: string }>;
}

export async function renewToken(token: string): Promise<{ access_token: string; expires_in: number } | null> {
  const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  const res = await fetch(`${IG_API_BASE}/refresh_access_token?${params}`);
  if (!res.ok) { console.error('[ig] renewToken failed', await res.text()); return null; }
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

// ── Coleta: posts / stories / snapshot ─────────────────────────────────────────

type Conn = Record<string, unknown>;

export async function collectAccountSnapshot(conn: Conn, db: IgDb): Promise<void> {
  const data = await fetchAccountFields(conn.ig_user_id as string, conn.access_token as string);
  if (!data) return;
  await db.from('ig_account_snapshots').upsert({
    user_id: conn.user_id,
    snapshot_date: new Date().toISOString().slice(0, 10),
    followers_count: data.followers_count ?? null,
    media_count: data.media_count ?? null,
  }, { onConflict: 'user_id,snapshot_date' });
}

export async function collectPosts(conn: Conn, db: IgDb): Promise<{ collected: number; errors: string[] }> {
  const errors: string[] = [];
  let collected = 0;
  const token = conn.access_token as string;
  const igUserId = conn.ig_user_id as string;
  const userId = conn.user_id as string;

  const mediaRes = await fetch(
    `${IG_API_BASE}/${igUserId}/media` +
    `?fields=id,permalink,media_type,timestamp,like_count,comments_count,caption,media_url,thumbnail_url` +
    `&limit=${MAX_POSTS}&access_token=${token}`,
  );
  if (!mediaRes.ok) { errors.push(`media_fetch_failed:${mediaRes.status}`); return { collected, errors }; }

  const mediaJson = await mediaRes.json() as { data?: Record<string, unknown>[] };
  const items = ((mediaJson.data || []) as Record<string, unknown>[]).filter((m) =>
    ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM', 'REEL'].includes(m.media_type as string),
  );

  for (const item of items) {
    await sleep(200);

    const mediaType = item.media_type as string;
    const ins = await fetchPostInsights(item.id as string, mediaType, token);
    const shortcode = extractIgShortcode(item.permalink as string);

    await db.from('ig_post_metrics').upsert({
      user_id: userId,
      ig_media_id: item.id,
      ig_media_type: mediaType,
      permalink: item.permalink,
      published_at: item.timestamp,
      like_count: item.like_count ?? ins.likes ?? 0,
      comments_count: item.comments_count ?? 0,
      reach: ins.reach ?? 0,
      impressions: ins.impressions ?? null,
      saved: ins.saved ?? null,
      shares: ins.shares ?? null,
      video_views: ins.video_views ?? null,
      plays: ins.plays ?? null,
      engagement: ins.engagement ?? null,
      profile_visits: ins.profile_visits ?? null,
      follows: ins.follows ?? null,
      caption: (item.caption as string | undefined)?.slice(0, 500) ?? null,
      media_url: item.media_url ?? null,
      thumbnail_url: item.thumbnail_url ?? null,
      collected_date: new Date().toISOString().slice(0, 10),
    }, { onConflict: 'ig_media_id,collected_date' });

    if (shortcode) {
      await db.from('posts')
        .update({ ig_media_id: item.id })
        .eq('ig_shortcode', shortcode)
        .eq('user_id', userId);
    }

    // Daily activity rollup (idempotente via ig_activity_counted PK).
    const mediaId = item.id as string;
    const { error: countedErr } = await db.from('ig_activity_counted').insert({ ig_media_id: mediaId });
    if (!countedErr) {
      const activityDate = item.timestamp
        ? (item.timestamp as string).slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const isReel = mediaType === 'REEL';
      const isCarousel = mediaType === 'CAROUSEL_ALBUM';
      await db.rpc('upsert_ig_daily_activity', {
        p_user_id: userId,
        p_date: activityDate,
        p_feed_delta: (!isReel && !isCarousel) ? 1 : 0,
        p_reel_delta: isReel ? 1 : 0,
        p_carousel_delta: isCarousel ? 1 : 0,
        p_story_delta: 0,
        p_reach_delta: (ins.reach ?? 0),
      });
    }

    collected++;
  }

  await db.from('ig_connections')
    .update({ last_collected_at: new Date().toISOString() })
    .eq('id', conn.id);

  return { collected, errors };
}

export async function collectStories(conn: Conn, db: IgDb): Promise<{ collected: number; errors: string[] }> {
  const errors: string[] = [];
  let collected = 0;
  const token = conn.access_token as string;
  const userId = conn.user_id as string;
  const igUserId = conn.ig_user_id as string;

  const stories = await fetchUserStories(igUserId, token);

  for (const story of stories) {
    await sleep(200);

    const ins = await fetchStoryInsights(story.id, token);
    const publishedAt = story.timestamp ?? new Date().toISOString();
    const isExpired = story.timestamp
      ? (Date.now() - new Date(story.timestamp).getTime()) > 24 * 3_600_000
      : false;

    await db.from('ig_story_metrics').upsert({
      user_id: userId,
      ig_media_id: story.id,
      media_type: story.media_type,
      media_url: story.media_url ?? null,
      thumbnail_url: story.thumbnail_url ?? null,
      permalink: story.permalink ?? null,
      published_at: publishedAt,
      reach: ins.reach ?? null,
      views: ins.views ?? null,
      replies: ins.replies ?? null,
      exits: ins.exits ?? null,
      navigation: ins.navigation ?? null,
      taps_forward: ins.taps_forward ?? null,
      taps_back: ins.taps_back ?? null,
      profile_visits: ins.profile_visits ?? null,
      follows: ins.follows ?? null,
      collected_date: new Date().toISOString().slice(0, 10),
      is_expired: isExpired,
    }, { onConflict: 'ig_media_id,collected_date' });

    const { error: countedErr } = await db.from('ig_activity_counted').insert({ ig_media_id: story.id });
    if (!countedErr) {
      const activityDate = story.timestamp ? story.timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
      await db.rpc('upsert_ig_daily_activity', {
        p_user_id: userId,
        p_date: activityDate,
        p_feed_delta: 0,
        p_reel_delta: 0,
        p_carousel_delta: 0,
        p_story_delta: 1,
        p_reach_delta: ins.reach ?? 0,
      });
    }

    collected++;
  }

  return { collected, errors };
}

/** Renova token se expira em < 7 dias; revoga conexão se renovação falhar. */
async function ensureToken(conn: Conn, db: IgDb): Promise<{ conn: Conn; revoked: boolean }> {
  if (new Date(conn.token_expires_at as string).getTime() - Date.now() < 7 * 86_400_000) {
    const renewed = await renewToken(conn.access_token as string);
    if (renewed?.access_token) {
      await db.from('ig_connections').update({
        access_token: renewed.access_token,
        token_expires_at: new Date(Date.now() + (renewed.expires_in ?? 5_184_000) * 1000).toISOString(),
      }).eq('id', conn.id);
      return { conn: { ...conn, access_token: renewed.access_token }, revoked: false };
    }
    await db.from('ig_connections').update({ status: 'revoked' }).eq('id', conn.id);
    return { conn, revoked: true };
  }
  return { conn, revoked: false };
}

/** Per-account: renova token + coleta posts/stories + snapshot. */
export async function processAccount(
  conn: Conn,
  db: IgDb,
  doPosts = true,
  doStories = false,
): Promise<{ collected: number; errors: Array<{ user_id: string; reason: string }> }> {
  const userId = conn.user_id as string;
  try {
    const ensured = await ensureToken(conn, db);
    if (ensured.revoked) return { collected: 0, errors: [{ user_id: userId, reason: 'token_renewal_failed' }] };
    const c = ensured.conn;

    const tasks: Array<Promise<{ collected: number; errors: string[] } | void>> = [];
    if (doPosts) { tasks.push(collectPosts(c, db), collectAccountSnapshot(c, db)); }
    if (doStories) { tasks.push(collectStories(c, db)); }

    const results = await Promise.allSettled(tasks);
    const errors: Array<{ user_id: string; reason: string }> = [];
    let collected = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const val = r.value;
        if (val && typeof val === 'object' && 'collected' in val) {
          collected += val.collected ?? 0;
          for (const e of val.errors ?? []) errors.push({ user_id: userId, reason: e });
        }
      } else {
        errors.push({ user_id: userId, reason: String(r.reason) });
      }
    }
    return { collected, errors };
  } catch (e: unknown) {
    return { collected: 0, errors: [{ user_id: userId, reason: e instanceof Error ? e.message : 'unknown' }] };
  }
}

/** Coleta em lote (admin / cron) — batches paralelos de 10. */
export async function collectAll(
  db: IgDb,
  opts: { doPosts?: boolean; doStories?: boolean } = {},
): Promise<{ collected: number; skipped: number; errors: Array<{ user_id: string; reason: string }>; total_accounts: number }> {
  const doPosts = opts.doPosts ?? true;
  const doStories = opts.doStories ?? false;

  const { data: conns } = await db.from('ig_connections').select('*').eq('status', 'active');
  const active = (conns || []) as Conn[];

  let totalCollected = 0;
  const allErrors: Array<{ user_id: string; reason: string }> = [];

  for (let i = 0; i < active.length; i += BATCH_SIZE) {
    const batch = active.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((conn) => processAccount(conn, db, doPosts, doStories)));
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalCollected += r.value.collected;
        allErrors.push(...r.value.errors);
      } else {
        allErrors.push({ user_id: 'unknown', reason: String(r.reason) });
      }
    }
  }

  return { collected: totalCollected, skipped: allErrors.length, errors: allErrors, total_accounts: active.length };
}

/**
 * Entrypoint do cron interno (substitui o Edge Function ig-collect). Porte fiel
 * de ig-collect/index.ts: grava log row em ig_collect_log, roda collectAll e
 * fecha o log. Flags { include_stories, only_stories } com a mesma semântica:
 *   { include_stories: true } → posts + stories
 *   { only_stories: true }    → stories only
 *   {}                        → posts only
 */
export async function runIgCollect(
  flags: { include_stories?: boolean; only_stories?: boolean } = {},
): Promise<{ collected: number; skipped: number; errors: Array<{ user_id: string; reason: string }>; status: string }> {
  const { sip } = await import('../db.js');
  const db = sip() as IgDb;

  const doStories = !!(flags.include_stories || flags.only_stories);
  const doPosts = !flags.only_stories;

  const { data: logRow } = await db.from('ig_collect_log').insert({
    run_date: new Date().toISOString().slice(0, 10),
    started_at: new Date().toISOString(),
    status: 'running',
  }).select('id').single();
  const logId = (logRow as { id?: string } | null)?.id;

  const result = await collectAll(db, { doPosts, doStories });
  const finalStatus = result.errors.length > 0 && result.collected === 0 ? 'failed' : 'done';

  if (logId) {
    await db.from('ig_collect_log').update({
      finished_at: new Date().toISOString(),
      total_accounts: result.total_accounts,
      collected: result.collected,
      errors: result.errors,
      status: finalStatus,
    }).eq('id', logId);
  }

  console.log(`[ig-collect] accounts=${result.total_accounts} collected=${result.collected} errors=${result.errors.length} posts=${doPosts} stories=${doStories}`);

  return { collected: result.collected, skipped: result.skipped, errors: result.errors, status: finalStatus };
}

// ── Analytics (evolution / projection / insights) ─────────────────────────────

export type PostRow = Record<string, unknown>;
export type SnapRow = { snapshot_date: string; followers_count: number | null };

const _num = (p: PostRow, key: string): number => (p[key] as number) ?? 0;
const _sumKey = (set: PostRow[], key: string): number => set.reduce((s, p) => s + _num(p, key), 0);

export function computeEvolution(posts: PostRow[], periodDays = 7) {
  const now = Date.now();
  const periodMs = periodDays * 86_400_000;
  const ts = (p: PostRow) => (p.published_at ? new Date(p.published_at as string).getTime() : 0);
  const inWindow = (p: PostRow, from: number, to: number) => {
    const t = ts(p);
    return t >= from && t < to;
  };

  const current = posts.filter((p) => inWindow(p, now - periodMs, now + 1));
  const previous = posts.filter((p) => inWindow(p, now - 2 * periodMs, now - periodMs));

  const aggOf = (set: PostRow[]) => ({
    posts_count: set.length,
    reach: _sumKey(set, 'reach'),
    impressions: _sumKey(set, 'impressions'),
    engagement: _sumKey(set, 'engagement'),
    follows: _sumKey(set, 'follows'),
    profile_visits: _sumKey(set, 'profile_visits'),
  });

  const cur = aggOf(current);
  const prev = aggOf(previous);

  const pct = (a: number, b: number): number | null => {
    if (b === 0) return a > 0 ? null : 0;
    return Math.round(((a - b) / b) * 100);
  };

  return {
    period_days: periodDays,
    current: cur,
    previous: prev,
    diff_pct: {
      reach: pct(cur.reach, prev.reach),
      impressions: pct(cur.impressions, prev.impressions),
      engagement: pct(cur.engagement, prev.engagement),
      follows: pct(cur.follows, prev.follows),
      profile_visits: pct(cur.profile_visits, prev.profile_visits),
      posts_count: pct(cur.posts_count, prev.posts_count),
    },
  };
}

export function computeProjection(snapshots: SnapRow[]) {
  const valid = snapshots.filter((s) => s.followers_count != null);
  if (valid.length < 3) return null;

  const sorted = valid.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const daysDelta = (new Date(last.snapshot_date).getTime() - new Date(first.snapshot_date).getTime()) / 86_400_000;
  if (daysDelta < 1) return null;

  const perDay = (last.followers_count! - first.followers_count!) / daysDelta;
  return {
    followers_per_day: Math.round(perDay * 10) / 10,
    followers_30d: Math.max(0, Math.round(last.followers_count! + perDay * 30)),
    based_on_days: Math.round(daysDelta),
  };
}

export function computeInsights(posts: PostRow[]) {
  const typeMap = new Map<string, { sum: number; count: number }>();
  for (const p of posts) {
    const t = (p.ig_media_type as string) || 'OTHER';
    const cur = typeMap.get(t) ?? { sum: 0, count: 0 };
    cur.sum += _num(p, 'reach'); cur.count++;
    typeMap.set(t, cur);
  }
  let bestType: { type: string; avg_reach: number; count: number } | null = null;
  for (const [type, d] of typeMap) {
    if (d.count >= 2) {
      const avg = d.sum / d.count;
      if (!bestType || avg > bestType.avg_reach) bestType = { type, avg_reach: Math.round(avg), count: d.count };
    }
  }

  const HOUR_LABELS: Record<number, string> = { 0: 'Madrugada', 6: 'Manhã', 12: 'Tarde', 18: 'Noite' };
  const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const hourMap = new Map<number, { sum: number; count: number }>();
  const dowMap = new Map<number, { sum: number; count: number }>();
  for (const p of posts) {
    if (!p.published_at) continue;
    const d = new Date(p.published_at as string);
    const bucket = Math.floor(d.getHours() / 6) * 6;
    const dow = d.getDay();
    const r = _num(p, 'reach');
    const h = hourMap.get(bucket) ?? { sum: 0, count: 0 };
    h.sum += r; h.count++; hourMap.set(bucket, h);
    const w = dowMap.get(dow) ?? { sum: 0, count: 0 };
    w.sum += r; w.count++; dowMap.set(dow, w);
  }
  let bestHour: { bucket: number; label: string; avg_reach: number; count: number } | null = null;
  for (const [bucket, d] of hourMap) {
    if (d.count >= 2) {
      const avg = d.sum / d.count;
      if (!bestHour || avg > bestHour.avg_reach) bestHour = { bucket, label: HOUR_LABELS[bucket] ?? `${bucket}h`, avg_reach: Math.round(avg), count: d.count };
    }
  }
  let bestDow: { day: number; label: string; avg_reach: number; count: number } | null = null;
  for (const [day, d] of dowMap) {
    if (d.count >= 2) {
      const avg = d.sum / d.count;
      if (!bestDow || avg > bestDow.avg_reach) bestDow = { day, label: DOW_LABELS[day] ?? `${day}`, avg_reach: Math.round(avg), count: d.count };
    }
  }

  let topEng: {
    ig_media_id: string; permalink: string; thumbnail_url: string | null; media_url: string | null;
    ig_media_type: string; published_at: string;
    engagement: number; reach: number; engagement_rate: number;
  } | null = null;
  for (const p of posts) {
    const reach = _num(p, 'reach');
    if (reach < 10) continue;
    const eng = _num(p, 'engagement') || (_num(p, 'like_count') + _num(p, 'comments_count') + _num(p, 'saved') + _num(p, 'shares'));
    const rate = (eng / reach) * 100;
    if (!topEng || rate > topEng.engagement_rate) {
      topEng = {
        ig_media_id: p.ig_media_id as string,
        permalink: p.permalink as string,
        thumbnail_url: (p.thumbnail_url as string) ?? null,
        media_url: (p.media_url as string) ?? null,
        ig_media_type: p.ig_media_type as string,
        published_at: p.published_at as string,
        engagement: eng,
        reach,
        engagement_rate: Math.round(rate * 10) / 10,
      };
    }
  }

  return {
    best_type: bestType,
    best_hour: bestHour,
    best_day_of_week: bestDow,
    top_engagement_post: topEng,
  };
}

// ── Cohort helpers (current_stage / median) ───────────────────────────────────

export function computeCurrentStage(
  stages: Array<{ id: string; stage_number: number }>,
  tasks: Array<{ id: string; stage_id: string }>,
  doneIds: Set<string>,
): number {
  if (stages.length === 0 || tasks.length === 0) return 0;
  let cur = 1;
  for (const st of stages) {
    const sTasks = tasks.filter((t) => t.stage_id === st.id);
    if (sTasks.length > 0 && sTasks.every((t) => doneIds.has(t.id))) cur = st.stage_number + 1;
  }
  return Math.min(cur, stages.length);
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}
