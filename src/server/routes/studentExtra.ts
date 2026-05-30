// Endpoints restantes do aluno (Fase 3c) — porte de handlers/student.ts:
// sessão, debriefing/SuperDebriefing (GET/POST/histórico/timeline), onboarding,
// Raio-X do aluno logado, calendário (POST), convite de sócio.
import { Router } from 'express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { sip } from '../db.js';
import { effectiveId, isUserInWaitMode } from '../domain/student.js';
import { resolveTaskline } from '../domain/taskline.js';
import { buildMilestones, checkAutoComplete } from '../domain/progress.js';
import { computeRaioxScore } from '../domain/raiox.js';
import { sanitizeText } from '../auth/password.js';
import { ERR_ACCESS_DENIED, ERR_WAIT_MODE } from '../domain/settings.js';
import { studentWriteRateLimit } from '../middleware/rateLimit.js';

export const studentExtraRouter = Router();

const denyWait = (res: Response, wait: { reason?: string; data_inicio?: string | null }) =>
  res.status(403).json({ error: ERR_WAIT_MODE, wait_mode: true, reason: wait.reason, data_inicio: wait.data_inicio });

// sdbSummary — extrai colunas-resumo do payload do SDB (porte de student.ts).
function sdbSummary(payload: Record<string, unknown>): Record<string, number | null> {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? n : null;
  };
  const investido = num(payload.valor_investido);
  const faturamento = num(payload.faturamento);
  const roi =
    investido !== null && investido > 0 && faturamento !== null
      ? Number((((faturamento - investido) / investido) * 100).toFixed(1))
      : null;
  return {
    valor_investido: investido,
    leads_builderall: num(payload.leads_builderall),
    cpl: num(payload.cpl),
    cpm: num(payload.cpm),
    ctr: num(payload.ctr),
    taxa_carregamento: num(payload.taxa_carregamento),
    qtd_vendas: num(payload.vendas),
    faturamento_total: faturamento,
    roi,
    nota: num(payload.nota),
  };
}

// ── GET /me/session ────────────────────────────────────────────────────────────
studentExtraRouter.get('/me/session', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const { data: u } = await sip()
      .from('users')
      .select(
        'id, name, email, role, ciclo_type, is_platina, monitor_id, onboarding_done, is_socio, socio_of, approval_status, must_change_password, raiox_submitted_at, email_verified',
      )
      .eq('id', req.user!.id)
      .maybeSingle();
    if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
    let monitor_name = null;
    if (u.monitor_id) {
      const { data: m } = await sip().from('users').select('name').eq('id', u.monitor_id).maybeSingle();
      monitor_name = m?.name ?? null;
    }
    let owner_name = null;
    if (u.is_socio && u.socio_of) {
      const { data: o } = await sip().from('users').select('name').eq('id', u.socio_of).maybeSingle();
      owner_name = o?.name ?? null;
    }
    return res.json({ ...u, monitor_name, owner_name });
  } catch (err) {
    next(err);
  }
});

// ── GET /debriefing ────────────────────────────────────────────────────────────
studentExtraRouter.get('/debriefing', async (req, res, next) => {
  try {
    const ownerId = await effectiveId(req.user!.id);
    const { data: u } = await sip().from('users').select('current_ciclo_id').eq('id', ownerId).maybeSingle();
    const cicloId = u?.current_ciclo_id ?? null;
    let doc: Record<string, unknown> | null = null;
    if (cicloId) {
      const { data } = await sip().from('debriefings').select('*').eq('user_id', ownerId).eq('ciclo_id', cicloId).maybeSingle();
      doc = data ?? null;
    } else {
      const { data } = await sip()
        .from('debriefings')
        .select('*')
        .eq('user_id', ownerId)
        .eq('source', 'ciclo')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      doc = data ?? null;
    }
    return res.json(doc ?? null);
  } catch (err) {
    next(err);
  }
});

// ── GET /superdebriefing ───────────────────────────────────────────────────────
studentExtraRouter.get('/superdebriefing', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const ownerId = await effectiveId(req.user!.id);
    const { data: ownerUser } = await sip().from('users').select('current_ciclo_id').eq('id', ownerId).maybeSingle();
    const currentCicloId = ownerUser?.current_ciclo_id ?? null;
    const existingQuery = currentCicloId
      ? sip().from('debriefings').select('*').eq('user_id', ownerId).eq('ciclo_id', currentCicloId).maybeSingle()
      : sip().from('debriefings').select('*').eq('user_id', ownerId).eq('source', 'ciclo').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const [{ data: existing }, { data: metaEntries }, { data: trafficRows }, { data: posts }] = await Promise.all([
      existingQuery,
      sip().from('meta').select('key, value').eq('user_id', ownerId),
      sip().from('traffic').select('*').eq('user_id', ownerId),
      sip().from('posts').select('*').eq('user_id', ownerId),
    ]);
    const meta: Record<string, unknown> = {};
    for (const e of metaEntries || []) meta[e.key] = e.value;
    const zero = { spent: 0, impressions: 0, clicks: 0, page_views: 0, leads_meta: 0, leads_builderall: 0 };
    const totals = (trafficRows || []).reduce(
      (acc: typeof zero, r: typeof zero) => ({
        spent: acc.spent + (r.spent || 0),
        impressions: acc.impressions + (r.impressions || 0),
        clicks: acc.clicks + (r.clicks || 0),
        page_views: acc.page_views + (r.page_views || 0),
        leads_meta: acc.leads_meta + (r.leads_meta || 0),
        leads_builderall: acc.leads_builderall + (r.leads_builderall || 0),
      }),
      zero,
    );
    const cpl = totals.leads_builderall > 0 ? totals.spent / totals.leads_builderall : null;
    const cpm = totals.impressions > 0 ? (totals.spent / totals.impressions) * 1000 : null;
    const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null;
    const load_rate = totals.clicks > 0 ? (totals.page_views / totals.clicks) * 100 : null;
    const postCounts: Record<string, Record<string, number>> = { instagram: {}, facebook: {}, youtube: {} };
    for (const p of posts || []) {
      if (!postCounts[p.platform]) postCounts[p.platform] = {};
      postCounts[p.platform]![p.format] = (postCounts[p.platform]![p.format] || 0) + 1;
    }
    const prefilled = {
      instagram_url: meta.instagram_url ?? null, facebook_url: meta.facebook_url ?? null,
      youtube_url: meta.youtube_url ?? null, pagina_url: meta.pagina_url ?? null,
      precheckout_url: meta.precheckout_url ?? null, data_palestra: meta.data_palestra ?? null,
      data_reuniao: meta.data_reuniao ?? null, valor_investido: totals.spent || null,
      leads_builderall: totals.leads_builderall || null, cpl, cpm, ctr, taxa_carregamento: load_rate,
      investimento_lembrete: totals.spent > 0 ? +(totals.spent * 0.075).toFixed(2) : null,
      roi_calculado:
        existing?.faturamento_total && totals.spent > 0
          ? +(((existing.faturamento_total - totals.spent) / totals.spent) * 100).toFixed(1)
          : null,
      reels_instagram: postCounts.instagram!['Reels'] || 0,
      carrossel_instagram: postCounts.instagram!['Carrossel'] || 0,
      estatico_instagram: postCounts.instagram!['Estático'] || 0,
      raiz_facebook: postCounts.facebook!['Raiz'] || 0,
      shorts_youtube: postCounts.youtube!['Shorts'] || 0,
      videos_youtube: postCounts.youtube!['Vídeo Longo'] || 0,
    };
    return res.json({ existing: existing ?? null, prefilled });
  } catch (err) {
    next(err);
  }
});

// ── GET /superdebriefing/timeline ───────────────────────────────────────────────
studentExtraRouter.get('/superdebriefing/timeline', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const ownerId = await effectiveId(req.user!.id);
    const { data } = await sip()
      .from('debriefings')
      .select(
        'id, source, ciclo_id, palestra_label, palestra_date, seq, ciclo_type, payload, qtd_vendas, faturamento_total, roi, nota, valor_investido, leads_builderall, submitted_at, created_at',
      )
      .eq('user_id', ownerId)
      .order('seq')
      .order('palestra_date', { nullsFirst: true })
      .order('created_at');
    return res.json({ entries: data || [] });
  } catch (err) {
    next(err);
  }
});

// ── GET /me/invite ──────────────────────────────────────────────────────────────
studentExtraRouter.get('/me/invite', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const userId = req.user!.id;
    const { data: me } = await sip().from('users').select('is_socio').eq('id', userId).maybeSingle();
    if (me?.is_socio) return res.status(403).json({ error: 'Sócio não pode convidar.' });
    const { data: socio } = await sip().from('users').select('id, name, email').eq('socio_of', userId).maybeSingle();
    if (socio) return res.json({ socio });
    const { data: pending } = await sip()
      .from('invites')
      .select('token, expires_at')
      .eq('owner_id', userId)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return res.json({ pending_invite: pending ?? null });
  } catch (err) {
    next(err);
  }
});

// ── POST /onboarding ──────────────────────────────────────────────────────────
studentExtraRouter.post('/onboarding', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student' && !studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const { data: u } = await sip().from('users').select('monitor_id').eq('id', userId).maybeSingle();
    if (!u?.monitor_id) return res.status(403).json({ error: 'Aguardando atribuição de monitor' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const businessFields = ['profissao', 'tempo_carreira', 'lancamentos_anteriores', 'faturamento_atual', 'instagram_handle', 'fez_curso_thb_antes'];
    const userUpdate: Record<string, unknown> = { onboarding_done: true };
    for (const k of businessFields) if (b[k] !== undefined) userUpdate[k] = b[k];
    if (b.onboarding_perfil && typeof b.onboarding_perfil === 'object' && !Array.isArray(b.onboarding_perfil)) {
      const perfilRaw = b.onboarding_perfil as Record<string, unknown>;
      const perfilClean: Record<string, string> = {};
      const KEYS_WITH_LIMITS: Array<[string, number]> = [
        ['tempo_carreira', 30], ['faturamento_atual', 30], ['pitch', 250], ['motivacao', 350],
        ['maior_dificuldade', 60], ['nivel_lancamentos', 30], ['palestra_tema', 150], ['palestra_publico', 300],
        ['palestra_transformacao', 300], ['palestra_oferta', 250], ['palestra_preco', 30], ['palestra_case', 30],
        ['palestra_observacao', 450],
      ];
      for (const [k, maxLen] of KEYS_WITH_LIMITS) {
        const v = perfilRaw[k];
        if (typeof v === 'string' && v.trim()) perfilClean[k] = v.trim().slice(0, maxLen);
      }
      if (Object.keys(perfilClean).length > 0) userUpdate.onboarding_perfil = perfilClean;
    }
    await sip().from('users').update(userUpdate).eq('id', userId);

    const metaFields = ['data_reuniao', 'meta_vendas_pessoal', 'investimento_previsto', 'meta_captacao_leads'];
    const nowIso = new Date().toISOString();
    const metaRows: Array<Record<string, unknown>> = [];
    for (const k of metaFields) {
      if (b[k] === undefined || b[k] === null || b[k] === '') continue;
      metaRows.push({ user_id: userId, key: k, value: b[k], updated_at: nowIso });
    }
    if (b.recursos && typeof b.recursos === 'object') {
      metaRows.push({ user_id: userId, key: 'recursos_prontos', value: b.recursos, updated_at: nowIso });
    }
    if (metaRows.length > 0) await sip().from('meta').upsert(metaRows, { onConflict: 'user_id,key' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /me/raiox ──────────────────────────────────────────────────────────────
studentExtraRouter.post('/me/raiox', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role !== 'student') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const { data: u } = await sip().from('users').select('raiox_submitted_at').eq('id', userId).maybeSingle();
    if (u?.raiox_submitted_at) return res.status(409).json({ error: 'Raio-X já preenchido.' });
    const body = (req.body ?? {}) as { raiox_answers?: Record<string, unknown> };
    const answers = body.raiox_answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return res.status(400).json({ error: 'Respostas inválidas.' });
    if (Object.keys(answers).length > 100) return res.status(400).json({ error: 'Raio-X com payload acima do permitido.' });
    const { data: questions } = await sip().from('raiox_questions').select('id, tipo, peso').eq('active', true);
    const r = computeRaioxScore(answers, questions || [], sanitizeText);
    const { error } = await sip()
      .from('users')
      .update({ raiox_answers: r.cleaned, raiox_score: r.total, raiox_max_score: r.max, raiox_submitted_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) return res.status(500).json({ error: 'Erro ao salvar Raio-X.' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /me/calendar (admin-owned; aluno recebe 403) ──────────────────────────
studentExtraRouter.post('/me/calendar', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'student' && !studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const { anchor_date } = (req.body ?? {}) as { anchor_date?: string };
    if (!anchor_date) return res.status(400).json({ error: 'anchor_date é obrigatório' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor_date) || Number.isNaN(new Date(anchor_date).getTime())) {
      return res.status(400).json({ error: 'anchor_date deve estar em formato YYYY-MM-DD válido.' });
    }
    const { data: u } = await sip().from('users').select('ciclo_type, current_ciclo_id').eq('id', userId).maybeSingle();
    if (role === 'student') {
      return res.status(403).json({
        error: 'A data do seu evento é definida pelo seu admin. Fale com seu monitor para solicitar uma mudança.',
        admin_owned: true,
      });
    }
    const { data: ex } = await sip().from('meta').select('id').eq('user_id', userId).eq('key', 'calendar_anchor').maybeSingle();
    if (ex) await sip().from('meta').update({ value: anchor_date, updated_at: new Date().toISOString() }).eq('id', ex.id);
    else await sip().from('meta').insert({ user_id: userId, key: 'calendar_anchor', value: anchor_date });
    const milestones = await buildMilestones(anchor_date, (u?.ciclo_type as string) ?? 'aurum');
    return res.json({ success: true, anchor_date, milestones });
  } catch (err) {
    next(err);
  }
});

// ── POST /superdebriefing ──────────────────────────────────────────────────────
studentExtraRouter.post('/superdebriefing', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student') {
      const wait = await isUserInWaitMode(userId);
      if (wait.waiting) return denyWait(res, wait);
      if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const ownerId = await effectiveId(userId);
    const { data: u } = await sip().from('users').select('ciclo_type, current_ciclo_id').eq('id', ownerId).maybeSingle();
    const cicloType = u?.ciclo_type ?? null;
    const currentCicloId = u?.current_ciclo_id ?? null;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const summary = sdbSummary(body);
    const now = new Date().toISOString();
    const row = { user_id: ownerId, ciclo_type: cicloType, ciclo_id: currentCicloId, source: 'ciclo', seq: 0, payload: body, submitted_at: now, ...summary };
    const { data: existing } = currentCicloId
      ? await sip().from('debriefings').select('id').eq('user_id', ownerId).eq('ciclo_id', currentCicloId).maybeSingle()
      : await sip().from('debriefings').select('id').eq('user_id', ownerId).eq('source', 'ciclo').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing) {
      const { error: updateErr } = await sip().from('debriefings').update({ ...row, updated_at: now }).eq('id', existing.id);
      if (updateErr) return res.status(500).json({ error: `Erro ao salvar superdebriefing (${updateErr.code || '?'}).` });
    } else {
      const { error: insertErr } = await sip().from('debriefings').insert({ ...row, created_at: now });
      if (insertErr) return res.status(500).json({ error: `Erro ao salvar superdebriefing (${insertErr.code || '?'}).` });
    }
    const auto_completed = await checkAutoComplete(ownerId, cicloType as string, 'debriefing');
    return res.json({ success: true, auto_completed });
  } catch (err) {
    next(err);
  }
});

// ── POST /superdebriefing/historico ─────────────────────────────────────────────
studentExtraRouter.post('/superdebriefing/historico', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student' && !studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const ownerId = await effectiveId(userId);
    const { data: u } = await sip().from('users').select('ciclo_type, raiox_answers').eq('id', ownerId).maybeSingle();
    const cicloType = u?.ciclo_type ?? null;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const summary = sdbSummary(body);
    const now = new Date().toISOString();
    const row = { user_id: ownerId, ciclo_type: cicloType, ciclo_id: null, source: 'historico', seq: -1, palestra_label: 'Palestra anterior', payload: body, submitted_at: now, ...summary };
    const { data: existing } = await sip().from('debriefings').select('id').eq('user_id', ownerId).eq('source', 'historico').maybeSingle();
    if (existing) {
      const { error: updateErr } = await sip().from('debriefings').update({ ...row, updated_at: now }).eq('id', existing.id);
      if (updateErr) return res.status(500).json({ error: `Erro ao salvar debriefing histórico (${updateErr.code || '?'}).` });
    } else {
      const { error: insertErr } = await sip().from('debriefings').insert({ ...row, created_at: now });
      if (insertErr) return res.status(500).json({ error: `Erro ao salvar debriefing histórico (${insertErr.code || '?'}).` });
    }
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /me/invite ──────────────────────────────────────────────────────────────
studentExtraRouter.post('/me/invite', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student' && !studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    const { data: me } = await sip().from('users').select('name, ciclo_type, is_socio').eq('id', userId).maybeSingle();
    if (!me) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (me.is_socio) return res.status(403).json({ error: 'Sócio não pode convidar.' });
    if (!me.ciclo_type) return res.status(400).json({ error: 'Defina seu ciclo antes de convidar um sócio.' });
    const { data: existingSocio } = await sip().from('users').select('id').eq('socio_of', userId).maybeSingle();
    if (existingSocio) return res.status(409).json({ error: 'Você já tem um sócio vinculado. Remova-o antes de gerar novo convite.' });
    await sip().from('invites').update({ used: true, used_at: new Date().toISOString() }).eq('owner_id', userId).eq('used', false);
    const token = randomUUID();
    const expires = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const { data: invite, error } = await sip()
      .from('invites')
      .insert({ token, owner_id: userId, owner_name: me.name, ciclo_type: me.ciclo_type, expires_at: expires })
      .select('token, expires_at')
      .single();
    if (error || !invite) {
      if ((error as { code?: string } | null)?.code === '23505') return res.status(409).json({ error: 'Já existe um convite ativo. Recarregue a página.' });
      return res.status(500).json({ error: 'Erro ao gerar convite.' });
    }
    return res.json({ invite });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /me/invite ──────────────────────────────────────────────────────────
studentExtraRouter.delete('/me/invite', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student' && !studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    await sip().from('invites').update({ used: true, used_at: new Date().toISOString() }).eq('owner_id', userId).eq('used', false);
    await sip().from('users').update({ is_socio: false, socio_of: null }).eq('socio_of', userId);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
