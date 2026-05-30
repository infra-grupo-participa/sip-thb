// Rotas de ESCRITA do aluno (Fase 3) — porte de handlers/student.ts.
// Concluir tarefa (+ handoff ClickUp), /me/meta, perfil, reports, proofs, onboarding.
import { Router } from 'express';
import { sip } from '../db.js';
import { resolveEffectiveUser, isUserInWaitMode } from '../domain/student.js';
import { resolveTaskline } from '../domain/taskline.js';
import { buildProgress } from '../domain/progress.js';
import { ERR_ACCESS_DENIED, ERR_WAIT_MODE } from '../domain/settings.js';
import { studentWriteRateLimit } from '../middleware/rateLimit.js';
import { dispatchHandoff } from '../services/clickup.js';

export const studentWriteRouter = Router();

const STUDENT_META_WRITABLE_KEYS = new Set(['data_reuniao', 'tour_done', 'date_change_requested']);

const denyWait = (res: import('express').Response, wait: { reason?: string; data_inicio?: string | null }) =>
  res.status(403).json({ error: ERR_WAIT_MODE, wait_mode: true, reason: wait.reason, data_inicio: wait.data_inicio });

// ── POST /tasks/:id/complete ───────────────────────────────────────────────────
studentWriteRouter.post('/tasks/:id/complete', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student') {
      const wait = await isUserInWaitMode(userId);
      if (wait.waiting) return denyWait(res, wait);
      if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const taskId = req.params.id;
    const effective = await resolveEffectiveUser(userId);
    if (!effective) return res.status(404).json({ error: 'Usuário não encontrado' });
    const effId = effective.id as string;
    const effCiclo = effective.ciclo_type as string;
    const taskline = await resolveTaskline(effective as { id: string; ciclo_type?: string | null });

    const { data: task } = await sip()
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('ciclo_type', effCiclo)
      .eq('taskline', taskline)
      .maybeSingle();
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
    if ((task.owner ?? 'aluno') === 'equipe') {
      return res.status(403).json({ error: 'Esta tarefa é de responsabilidade da equipe.' });
    }

    const prog = await buildProgress(effId, effCiclo, taskline);
    const stageData = prog.stages.find((s) => s.id === task.stage_id);
    if (!stageData?.unlocked) return res.status(403).json({ error: 'Complete a etapa anterior primeiro' });

    const body = (req.body ?? {}) as { completed?: boolean; completed_at?: string; link?: string };
    const completedVal = body.completed !== false;

    let handoffLink: string | null = null;
    if (completedVal && (task.requires_link || task.clickup_target_key)) {
      const bodyLink = typeof body.link === 'string' ? body.link.trim() : '';
      if (bodyLink) {
        handoffLink = bodyLink;
      } else {
        const { data: existingProof } = await sip()
          .from('task_proofs')
          .select('link')
          .eq('user_id', effId)
          .eq('task_id', taskId)
          .not('link', 'is', null)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        handoffLink = existingProof?.link ?? null;
        if (task.requires_link && !handoffLink) {
          return res
            .status(400)
            .json({ error: 'Esta tarefa exige um link (pasta no Drive) antes de ser concluída.', requires_link: true });
        }
      }
    }

    const { data: existing } = await sip()
      .from('progress')
      .select('*')
      .eq('user_id', effId)
      .eq('task_id', taskId)
      .maybeSingle();
    const completedAtVal = body.completed_at ? new Date(body.completed_at).toISOString() : new Date().toISOString();
    if (existing) {
      await sip().from('progress').update({ completed: completedVal, completed_at: completedAtVal }).eq('id', existing.id);
    } else {
      await sip().from('progress').insert({ user_id: effId, task_id: taskId, completed: completedVal, completed_at: completedAtVal });
    }

    // Handoff ClickUp — fire-and-forget, o aluno nunca espera nem vê erro.
    if (completedVal && (task.clickup_target_key || task.requires_link)) {
      void dispatchHandoff({ userId: effId, cicloType: effCiclo, taskline, task, link: handoffLink }).catch((e) =>
        console.error('[handoff] background failure:', e instanceof Error ? e.message : String(e)),
      );
    }

    const freshProg = await buildProgress(effId, effCiclo, taskline);
    const freshStage = freshProg.stages.find((s) => s.id === task.stage_id);
    return res.json({ success: true, stage_completed: freshStage?.completed ?? false, stage_number: task.stage_number });
  } catch (err) {
    next(err);
  }
});

// ── POST /me/meta ─────────────────────────────────────────────────────────────
studentWriteRouter.post('/me/meta', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'student') {
      const wait = await isUserInWaitMode(userId);
      if (wait.waiting) return denyWait(res, wait);
      if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const { key, value } = (req.body ?? {}) as { key?: string; value?: unknown };
    if (!key) return res.status(400).json({ error: 'key é obrigatório' });
    if (role === 'student' && !STUDENT_META_WRITABLE_KEYS.has(key)) {
      return res.status(403).json({
        error: `A chave "${key}" não pode ser editada pelo aluno. Esse campo é definido pelo admin.`,
        admin_owned: true,
      });
    }
    const validators: Record<string, (v: unknown) => boolean> = {
      data_reuniao: (v) => typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)),
      tour_done: (v) => typeof v === 'boolean' || v === 'true' || v === 'false' || v == null,
      date_change_requested: (v) => typeof v === 'boolean' || v === 'true' || v === 'false' || v == null,
      calendar_anchor: (v) => typeof v === 'string' && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)),
    };
    const validator = validators[key];
    if (validator && !validator(value)) return res.status(400).json({ error: `Valor inválido para "${key}".` });
    const { data: ex } = await sip().from('meta').select('id').eq('user_id', userId).eq('key', key).maybeSingle();
    if (ex) await sip().from('meta').update({ value, updated_at: new Date().toISOString() }).eq('id', ex.id);
    else await sip().from('meta').insert({ user_id: userId, key, value });
    return res.json({ success: true, key, value });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /me/profile ────────────────────────────────────────────────────────
studentWriteRouter.patch('/me/profile', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if ('phone' in body) {
      const raw = (body.phone ?? '').toString().trim();
      if (!raw) updates.phone = null;
      else {
        const digits = raw.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 11) return res.status(400).json({ error: 'Telefone deve ter 10 ou 11 dígitos.' });
        updates.phone =
          digits.length === 11
            ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
            : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
      }
    }
    if ('city' in body) {
      const raw = (body.city ?? '').toString().trim();
      if (!raw) updates.city = null;
      else {
        if (!/^[\p{L}\s.'\-]+\s*\/\s*[a-zA-Z]{2}$/u.test(raw)) return res.status(400).json({ error: 'Cidade deve estar no formato: Cidade / UF' });
        updates.city = raw.replace(/\/\s*([a-zA-Z]{2})\s*$/, (_m: string, uf: string) => '/ ' + uf.toUpperCase());
      }
    }
    if ('profissao' in body) {
      const raw = (body.profissao ?? '').toString().trim();
      if (!raw) updates.profissao = null;
      else {
        if (raw.length > 80) return res.status(400).json({ error: 'Profissão muito longa.' });
        if (!/^[\p{L}][\p{L}\s.'\-/()]{0,79}$/u.test(raw)) return res.status(400).json({ error: 'Profissão contém caracteres inválidos.' });
        updates.profissao = raw;
      }
    }
    for (const field of ['instagram_handle', 'facebook_handle', 'youtube_handle'] as const) {
      if (field in body) {
        const raw = (body[field] ?? '').toString().trim();
        updates[field] = raw.length > 120 ? raw.slice(0, 120) : raw || null;
      }
    }
    if (Object.keys(updates).length === 0) return res.json({ success: true, updated: false });
    const { error } = await sip().from('users').update(updates).eq('id', userId);
    if (error) return res.status(500).json({ error: 'Erro ao atualizar perfil.' });
    return res.json({ success: true, updated: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /me/reports ───────────────────────────────────────────────────────────
studentWriteRouter.post('/me/reports', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'student') {
      const wait = await isUserInWaitMode(userId);
      if (wait.waiting) return denyWait(res, wait);
      if (!studentWriteRateLimit(userId)) return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const { task_id, kind, message } = (req.body ?? {}) as { task_id?: string; kind?: string; message?: string };
    if (!message || String(message).trim().length < 5) {
      return res.status(400).json({ error: 'Descreva o problema com pelo menos 5 caracteres.' });
    }
    let task_title: string | null = null;
    let task_ciclo: string | null = null;
    if (task_id) {
      const { data: meCiclo } = await sip().from('users').select('ciclo_type').eq('id', userId).maybeSingle();
      const { data: task } = await sip().from('tasks').select('title, ciclo_type').eq('id', task_id).maybeSingle();
      if (task && task.ciclo_type === meCiclo?.ciclo_type) {
        task_title = task.title;
        task_ciclo = task.ciclo_type;
      }
    }
    const { data: u } = await sip().from('users').select('name, email').eq('id', userId).maybeSingle();
    const { data: inserted } = await sip()
      .from('reports')
      .insert({
        user_id: userId, user_name: u?.name ?? null, user_email: u?.email ?? null,
        task_id: task_id || null, task_title, task_ciclo, kind: kind || 'tarefa',
        message: String(message).trim(), status: 'aberto',
      })
      .select('id')
      .single();
    if (!inserted) return res.status(500).json({ error: 'Falha ao registrar chamado' });
    return res.status(201).json({ id: inserted.id });
  } catch (err) {
    next(err);
  }
});

// ── PUT /me/reports/:id/read ───────────────────────────────────────────────────
studentWriteRouter.put('/me/reports/:id/read', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'student' && !studentWriteRateLimit(userId)) {
      return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const { data: r } = await sip().from('reports').select('user_id').eq('id', req.params.id).maybeSingle();
    if (!r || r.user_id !== userId) return res.status(404).json({ error: 'Report não encontrado' });
    await sip().from('reports').update({ read_at: new Date().toISOString() }).eq('id', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET/POST/DELETE /me/tasks/:taskId/proofs ───────────────────────────────────
studentWriteRouter.get('/me/tasks/:taskId/proofs', async (req, res, next) => {
  try {
    if (req.user!.role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const { data } = await sip()
      .from('task_proofs')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('task_id', req.params.taskId)
      .order('submitted_at', { ascending: false });
    return res.json(data || []);
  } catch (err) {
    next(err);
  }
});

studentWriteRouter.post('/me/tasks/:taskId/proofs', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student' && !studentWriteRateLimit(userId)) {
      return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const { data: taskRow } = await sip().from('tasks').select('id, title, ciclo_type').eq('id', req.params.taskId).maybeSingle();
    if (!taskRow) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const { link, description } = (req.body ?? {}) as { link?: string; description?: string };
    if (!link && !description) return res.status(400).json({ error: 'Informe ao menos um link ou descrição' });
    const { data: inserted } = await sip()
      .from('task_proofs')
      .insert({
        user_id: userId,
        task_id: req.params.taskId,
        task_title: taskRow.title,
        ciclo_type: taskRow.ciclo_type,
        link: link || null,
        description: description || null,
        status: 'pendente',
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();
    return res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

studentWriteRouter.delete('/me/tasks/:taskId/proofs/:proofId', async (req, res, next) => {
  try {
    const { role, id: userId } = req.user!;
    if (role === 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (role === 'student' && !studentWriteRateLimit(userId)) {
      return res.status(429).json({ error: 'Muitas requisições. Aguarde.' });
    }
    const { data: proof } = await sip()
      .from('task_proofs')
      .select('id, status')
      .eq('id', req.params.proofId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!proof) return res.status(404).json({ error: 'Comprovação não encontrada' });
    if (proof.status === 'aprovado') return res.status(400).json({ error: 'Não é possível remover uma comprovação já aprovada' });
    await sip().from('task_proofs').delete().eq('id', req.params.proofId);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
