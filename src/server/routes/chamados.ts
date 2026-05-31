// Chamados / inbox (threads de mensagens) — porte da seção inbox/threads de
// handlers/content.ts. Todos os endpoints exigem requireAuth; a visibilidade
// por papel (student / monitor / admin) está embutida em cada handler, idêntica
// ao legado.
//
// Endpoints:
//   GET    /inbox                 — lista threads (aluno: as suas; monitor: dos
//                                    seus alunos; admin: todas) + flag `unread`
//   POST   /inbox                 — nova thread (aluno cria a sua; admin/monitor
//                                    cria em nome de um aluno)
//   GET    /inbox/unread-count    — contagem de threads não lidas
//   GET    /inbox/:threadId       — thread + mensagens (marca como lida)
//   POST   /inbox/:threadId/reply — responde thread
//   DELETE /inbox/:threadId       — admin deleta thread
//
// Tabelas: message_threads, messages, message_reads, users (schema sip).
import { Router } from 'express';
import { sip } from '../db.js';
import { ERR_ACCESS_DENIED } from '../domain/settings.js';

export const chamadosRouter = Router();

// ── GET /inbox — listar threads ────────────────────────────────────────────────
// (aluno vê as suas; monitor vê dos seus alunos; admin vê todas)
chamadosRouter.get('/inbox', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;

    let threads: Array<Record<string, unknown>> | null = null;
    if (userRole === 'admin') {
      const { data } = await sip()
        .from('message_threads')
        .select('id, subject, created_at, last_msg_at, student_id, sip_users:student_id(name, ciclo_type, monitor_id)')
        .order('last_msg_at', { ascending: false });
      threads = data;
    } else if (userRole === 'monitor') {
      const { data: myStudents } = await sip().from('users').select('id').eq('monitor_id', userId).eq('role', 'student');
      const ids = (myStudents || []).map((s: Record<string, unknown>) => s.id);
      if (ids.length === 0) return res.json([]);
      const { data } = await sip()
        .from('message_threads')
        .select('id, subject, created_at, last_msg_at, student_id, sip_users:student_id(name, ciclo_type, monitor_id)')
        .in('student_id', ids)
        .order('last_msg_at', { ascending: false });
      threads = data;
    } else {
      const { data } = await sip()
        .from('message_threads')
        .select('id, subject, created_at, last_msg_at, student_id')
        .eq('student_id', userId)
        .order('last_msg_at', { ascending: false });
      threads = data;
    }

    // Conta não lidas por thread
    const threadIds = (threads || []).map((t: Record<string, unknown>) => t.id);
    const { data: reads } = threadIds.length > 0
      ? await sip().from('message_reads').select('thread_id').eq('user_id', userId).in('thread_id', threadIds)
      : { data: [] as Array<Record<string, unknown>> };
    const { data: lastMsgs } = threadIds.length > 0
      ? await sip().from('messages').select('thread_id, created_at').in('thread_id', threadIds).order('created_at', { ascending: false })
      : { data: [] as Array<Record<string, unknown>> };

    const readMap = new Set((reads || []).map((r: Record<string, unknown>) => r.thread_id));
    const lastMsgMap: Record<string, string> = {};
    for (const m of (lastMsgs || [])) {
      const tid = m.thread_id as string;
      if (!lastMsgMap[tid]) lastMsgMap[tid] = m.created_at as string;
    }

    const result = (threads || []).map((t: Record<string, unknown>) => ({
      ...t,
      unread: !readMap.has(t.id as string),
    }));
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /inbox — nova thread ────────────────────────────────────────────────────
// (aluno cria a sua; admin/monitor cria em nome do aluno)
chamadosRouter.post('/inbox', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const { subject, body, student_id } = (req.body ?? {}) as { subject?: string; body?: string; student_id?: string };
    const targetStudentId = userRole === 'student' ? userId : student_id;
    if (!targetStudentId) return res.status(400).json({ error: 'student_id obrigatório' });
    if (!body?.trim()) return res.status(400).json({ error: 'Mensagem não pode ser vazia' });

    // Monitor só pode criar thread para seus alunos
    if (userRole === 'monitor') {
      const { data: st } = await sip().from('users').select('id').eq('id', targetStudentId).eq('monitor_id', userId).maybeSingle();
      if (!st) return res.status(403).json({ error: ERR_ACCESS_DENIED });
    }
    // Admin pode atingir qualquer student_id, mas valida que existe e é student
    // (evita thread órfã se FK falhar).
    if (userRole === 'admin') {
      const { data: st } = await sip().from('users').select('id, role').eq('id', targetStudentId).maybeSingle();
      if (!st || st.role !== 'student') return res.status(404).json({ error: 'Aluno não encontrado.' });
    }

    const { data: thread } = await sip()
      .from('message_threads')
      .insert({ student_id: targetStudentId, subject: subject?.trim() || null })
      .select()
      .single();
    const { data: u } = await sip().from('users').select('role').eq('id', userId).maybeSingle();
    await sip().from('messages').insert({ thread_id: thread.id, sender_id: userId, sender_role: u?.role || userRole, body: body.trim() });
    await sip().from('message_reads').upsert({ thread_id: thread.id, user_id: userId });
    return res.status(201).json(thread);
  } catch (err) {
    next(err);
  }
});

// ── GET /inbox/unread-count ──────────────────────────────────────────────────────
// (Registrado antes de /inbox/:threadId para não ser capturado pela rota genérica.)
chamadosRouter.get('/inbox/unread-count', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;

    let threadIds: string[] = [];
    if (userRole === 'admin') {
      const { data } = await sip().from('message_threads').select('id');
      threadIds = (data || []).map((t: Record<string, unknown>) => t.id as string);
    } else if (userRole === 'monitor') {
      const { data: myStudents } = await sip().from('users').select('id').eq('monitor_id', userId).eq('role', 'student');
      const ids = (myStudents || []).map((s: Record<string, unknown>) => s.id as string);
      if (ids.length > 0) {
        const { data } = await sip().from('message_threads').select('id').in('student_id', ids);
        threadIds = (data || []).map((t: Record<string, unknown>) => t.id as string);
      }
    } else {
      const { data } = await sip().from('message_threads').select('id').eq('student_id', userId);
      threadIds = (data || []).map((t: Record<string, unknown>) => t.id as string);
    }
    if (threadIds.length === 0) return res.json({ count: 0 });
    const { data: reads } = await sip().from('message_reads').select('thread_id').eq('user_id', userId).in('thread_id', threadIds);
    const readSet = new Set((reads || []).map((r: Record<string, unknown>) => r.thread_id));
    const unread = threadIds.filter((id) => !readSet.has(id)).length;
    return res.json({ count: unread });
  } catch (err) {
    next(err);
  }
});

// ── GET /inbox/:threadId — mensagens da thread ───────────────────────────────────
chamadosRouter.get('/inbox/:threadId', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const threadId = req.params.threadId;

    const { data: thread } = await sip().from('message_threads').select('*').eq('id', threadId).maybeSingle();
    if (!thread) return res.status(404).json({ error: 'Thread não encontrada' });
    // Verifica acesso
    if (userRole === 'student' && thread.student_id !== userId) return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (userRole === 'monitor') {
      const { data: st } = await sip().from('users').select('id').eq('id', thread.student_id).eq('monitor_id', userId).maybeSingle();
      if (!st) return res.status(403).json({ error: ERR_ACCESS_DENIED });
    }
    const { data: msgs } = await sip()
      .from('messages')
      .select('id, sender_id, sender_role, body, created_at, sip_users:sender_id(name)')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    // Marca como lida
    await sip().from('message_reads').upsert({ thread_id: threadId, user_id: userId });
    return res.json({ thread, messages: msgs || [] });
  } catch (err) {
    next(err);
  }
});

// ── POST /inbox/:threadId/reply — responder thread ───────────────────────────────
chamadosRouter.post('/inbox/:threadId/reply', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const threadId = req.params.threadId;

    const { body } = (req.body ?? {}) as { body?: string };
    if (!body?.trim()) return res.status(400).json({ error: 'Mensagem não pode ser vazia' });
    const { data: thread } = await sip().from('message_threads').select('*').eq('id', threadId).maybeSingle();
    if (!thread) return res.status(404).json({ error: 'Thread não encontrada' });
    if (userRole === 'student' && thread.student_id !== userId) return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (userRole === 'monitor') {
      const { data: st } = await sip().from('users').select('id').eq('id', thread.student_id).eq('monitor_id', userId).maybeSingle();
      if (!st) return res.status(403).json({ error: ERR_ACCESS_DENIED });
    }
    const { data: u } = await sip().from('users').select('role, name').eq('id', userId).maybeSingle();
    const { data: msg } = await sip()
      .from('messages')
      .insert({ thread_id: threadId, sender_id: userId, sender_role: u?.role || userRole, body: body.trim() })
      .select()
      .single();
    // Marca como lida pelo remetente, invalida leitura dos outros
    await sip().from('message_reads').delete().eq('thread_id', threadId).neq('user_id', userId);
    await sip().from('message_reads').upsert({ thread_id: threadId, user_id: userId });
    return res.json({ ...msg, sender_name: u?.name });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /inbox/:threadId — admin deleta thread ────────────────────────────────
// No legado o branch só existe quando userRole === 'admin'; caso contrário a
// requisição não casa nenhuma rota e cai no 404 padrão da API. Preservamos esse
// comportamento devolvendo o mesmo 404 para não-admins.
chamadosRouter.delete('/inbox/:threadId', async (req, res, next) => {
  try {
    if (req.user!.role !== 'admin') return res.status(404).json({ error: 'Rota não encontrada' });
    await sip().from('message_threads').delete().eq('id', req.params.threadId);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
