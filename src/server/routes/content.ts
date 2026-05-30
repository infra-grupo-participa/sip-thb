// Conteúdo do aluno: posts e tráfego — porte de handlers/content.ts (parte
// posts/traffic; inbox/mensagens entra na fase de chamados).
import { Router } from 'express';
import { sip } from '../db.js';
import { resolveEffectiveUser, isUserInWaitMode } from '../domain/student.js';
import { checkAutoComplete } from '../domain/progress.js';
import { ERR_ACCESS_DENIED, ERR_WAIT_MODE } from '../domain/settings.js';
import { studentWriteRateLimit } from '../middleware/rateLimit.js';
import { audit } from '../domain/audit.js';
import { parsePagination, applyCursor, buildPaginated } from '../domain/cursor.js';
import { sanitizeTrafficFields, calcTrafficKpis, extractIgShortcode } from '../domain/traffic.js';

export const contentRouter = Router();

const denyWait = (res: import('express').Response, wait: { reason?: string; data_inicio?: string | null }) =>
  res.status(403).json({ error: ERR_WAIT_MODE, wait_mode: true, reason: wait.reason, data_inicio: wait.data_inicio });

async function effectiveId(userId: string): Promise<string> {
  const eff = await resolveEffectiveUser(userId);
  return (eff?.id as string) ?? userId;
}

// ── GET /posts ──────────────────────────────────────────────────────────────
contentRouter.get('/posts', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const ownerId = await effectiveId(req.user!.id);
    const { limit, cursor, hasLimitParam } = parsePagination(req.query as Record<string, unknown>);
    let total: number | undefined;
    if (hasLimitParam && !cursor) {
      const { count } = await sip().from('posts').select('id', { count: 'exact', head: true }).eq('user_id', ownerId);
      total = count ?? 0;
    }
    let q = sip().from('posts').select('*').eq('user_id', ownerId);
    q = applyCursor(q, cursor, 'date').order('date', { ascending: false }).order('id', { ascending: false });
    if (hasLimitParam) q = q.limit(limit + 1);
    const { data } = await q;
    return res.json(buildPaginated((data || []) as Array<{ id: string; date: string }>, limit, hasLimitParam, 'date', total));
  } catch (err) {
    next(err);
  }
});

// ── POST /posts ─────────────────────────────────────────────────────────────
contentRouter.post('/posts', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student') {
      const wait = await isUserInWaitMode(userId);
      if (wait.waiting) return denyWait(res, wait);
      if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const ownerId = await effectiveId(userId);
    const { data: u } = await sip().from('users').select('ciclo_type').eq('id', ownerId).maybeSingle();
    const { date, platform, format, link, manual_reach } = (req.body ?? {}) as {
      date?: string; platform?: string; format?: string; link?: string; manual_reach?: unknown;
    };
    if (!date || !platform || !format) return res.status(400).json({ error: 'date, platform e format são obrigatórios' });
    if (!['instagram', 'facebook', 'youtube'].includes(platform)) return res.status(400).json({ error: 'Plataforma inválida' });
    const ig_shortcode = platform === 'instagram' && link ? extractIgShortcode(link) : null;
    const reachVal = manual_reach != null ? parseInt(String(manual_reach), 10) : null;
    const safeReach = reachVal != null && !Number.isNaN(reachVal) && reachVal >= 0 ? reachVal : null;
    const { data: post, error: insertErr } = await sip()
      .from('posts')
      .insert({ user_id: ownerId, ciclo_type: u?.ciclo_type, date, platform, format, link: link || null, ig_shortcode, manual_reach: safeReach })
      .select()
      .single();
    if (insertErr) {
      console.error('[POST /posts] insert failed:', insertErr);
      return res.status(500).json({ error: `Erro ao salvar post (${insertErr.code || '?'}).` });
    }
    const auto_completed = await checkAutoComplete(ownerId, u?.ciclo_type as string, 'posts');
    return res.json({ success: true, post, auto_completed });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /posts/:id ─────────────────────────────────────────────────────────
contentRouter.delete('/posts/:id', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student') {
      const wait = await isUserInWaitMode(userId);
      if (wait.waiting) return denyWait(res, wait);
      if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const ownerId = await effectiveId(userId);
    const { data: post } = await sip()
      .from('posts')
      .select('id, platform, format, date')
      .eq('id', req.params.id)
      .eq('user_id', ownerId)
      .maybeSingle();
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });
    await sip().from('posts').delete().eq('id', req.params.id);
    await audit(userId, 'ACTION', 'posts', req.params.id, {
      what: 'delete_post', platform: post.platform, format: post.format, date: post.date, owner_id: ownerId,
    });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /traffic ──────────────────────────────────────────────────────────────
contentRouter.get('/traffic', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const ownerId = await effectiveId(req.user!.id);
    const { data: rows } = await sip().from('traffic').select('*').eq('user_id', ownerId).order('date');
    const withKpis = calcTrafficKpis((rows || []) as Record<string, number>[]);
    const zero = { spent: 0, impressions: 0, clicks: 0, page_views: 0, leads_meta: 0, leads_builderall: 0, leads_whatsapp: 0, grupos_whatsapp: 0 };
    const totals = (rows || []).reduce(
      (acc: typeof zero, r: Record<string, number>) => ({
        spent: acc.spent + (r.spent || 0),
        impressions: acc.impressions + (r.impressions || 0),
        clicks: acc.clicks + (r.clicks || 0),
        page_views: acc.page_views + (r.page_views || 0),
        leads_meta: acc.leads_meta + (r.leads_meta || 0),
        leads_builderall: acc.leads_builderall + (r.leads_builderall || 0),
        leads_whatsapp: acc.leads_whatsapp + (r.leads_whatsapp || 0),
        grupos_whatsapp: acc.grupos_whatsapp + (r.grupos_whatsapp || 0),
      }),
      zero,
    );
    const totalKpis = calcTrafficKpis([totals])[0];
    const distribution =
      totals.spent > 0
        ? { escala: +(totals.spent * 0.775).toFixed(2), teste: +(totals.spent * 0.125).toFixed(2), lembrete: +(totals.spent * 0.075).toFixed(2), ehoje: +(totals.spent * 0.025).toFixed(2) }
        : null;
    return res.json({ rows: withKpis, totals: totalKpis, distribution });
  } catch (err) {
    next(err);
  }
});

// ── POST /traffic ───────────────────────────────────────────────────────────────
contentRouter.post('/traffic', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student') {
      const wait = await isUserInWaitMode(userId);
      if (wait.waiting) return denyWait(res, wait);
      if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const ownerId = await effectiveId(userId);
    const { data: u } = await sip().from('users').select('ciclo_type').eq('id', ownerId).maybeSingle();
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!body.date) return res.status(400).json({ error: 'date é obrigatório' });
    const fields = sanitizeTrafficFields(body);
    let existingQ = sip().from('traffic').select('id').eq('user_id', ownerId).eq('date', body.date as string);
    existingQ =
      fields.platform === 'outros' ? existingQ.or('platform.is.null,platform.eq.outros') : existingQ.eq('platform', fields.platform);
    const { data: existing } = await existingQ.maybeSingle();
    if (existing) {
      const { error: updateErr } = await sip().from('traffic').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (updateErr) {
        console.error('[POST /traffic] update failed:', updateErr);
        return res.status(500).json({ error: `Erro ao atualizar tráfego (${updateErr.code || '?'}).` });
      }
    } else {
      const { error: insertErr } = await sip().from('traffic').insert({ user_id: ownerId, ciclo_type: u?.ciclo_type, date: body.date, ...fields });
      if (insertErr) {
        console.error('[POST /traffic] insert failed:', insertErr);
        return res.status(500).json({ error: `Erro ao salvar tráfego (${insertErr.code || '?'}).` });
      }
    }
    const auto_completed = await checkAutoComplete(ownerId, u?.ciclo_type as string, 'traffic');
    return res.json({ success: true, auto_completed });
  } catch (err) {
    next(err);
  }
});
