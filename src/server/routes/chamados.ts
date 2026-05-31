// Chamados / inbox (threads de mensagens) — porte da seção inbox/threads de
// handlers/content.ts. Todos os endpoints exigem requireAuth; a visibilidade
// por papel (student / monitor / admin) está embutida em cada handler, idêntica
// ao legado.
//
// Endpoints (inbox legado):
//   GET    /inbox                 — lista threads (aluno: as suas; monitor: dos
//                                    seus alunos; admin: todas) + flag `unread`
//   POST   /inbox                 — nova thread (aluno cria a sua; admin/monitor
//                                    cria em nome de um aluno)
//   GET    /inbox/unread-count    — contagem de threads não lidas
//   GET    /inbox/:threadId       — thread + mensagens (marca como lida)
//   POST   /inbox/:threadId/reply — responde thread
//   DELETE /inbox/:threadId       — admin deleta thread
//
// Endpoints (chat de chamados — ticket_messages, porte de handlers/chamados.ts):
//   GET    /me/reports/:id/messages       — aluno: thread do seu chamado
//   POST   /me/reports/:id/messages       — aluno: responde (bloqueado se finalizado)
//   POST   /me/reports/:id/reopen         — aluno: solicita reabertura (status→aberto)
//   GET    /admin/reports/:id/messages    — admin: report + thread
//   POST   /admin/reports/:id/messages    — admin: responde (auto-promove aberto→em_atendimento)
//   PATCH  /admin/reports/:id/status      — admin: finalizar/reabrir
//   GET    /monitor/reports/:id/messages  — monitor (dono): report + thread
//   POST   /monitor/reports/:id/messages  — monitor (dono): responde (auto-promove)
//   PATCH  /monitor/reports/:id/status    — monitor (dono): só pode finalizar
//
// Tabelas: message_threads, messages, message_reads, reports, ticket_messages,
// users (schema sip). Sem Realtime: o front usa polling (refetchInterval).
import { Router } from 'express';
import { sip } from '../db.js';
import { ERR_ACCESS_DENIED } from '../domain/settings.js';

export const chamadosRouter = Router();

// ── Tipos do chat de chamados ──────────────────────────────────────────────────
interface Attachment {
  path: string;
  name: string;
  type: string;
  size: number;
  signed_url?: string;
}

interface TicketMessageRow {
  id: string;
  report_id: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string;
  body: string | null;
  attachments: Attachment[];
  created_at: string;
}

// Insere mensagem em ticket_messages e atualiza meta (last_message_at/by) do report.
// supabase-js não lança em write → checamos { error }.
async function insertTicketMessage(args: {
  reportId: string;
  senderId: string | null;
  senderName: string;
  senderRole: string;
  body: string | null;
  attachments: Attachment[];
}): Promise<TicketMessageRow | null> {
  const { data: msg, error } = await sip()
    .from('ticket_messages')
    .insert({
      report_id: args.reportId,
      sender_id: args.senderId,
      sender_name: args.senderName,
      sender_role: args.senderRole,
      body: args.body || null,
      attachments: args.attachments.length > 0 ? args.attachments : [],
    })
    .select('*')
    .single();

  if (error || !msg) return null;
  const row = msg as TicketMessageRow;

  await sip()
    .from('reports')
    .update({ last_message_at: row.created_at, last_message_by: args.senderRole })
    .eq('id', args.reportId);

  return row;
}

// Auto-promoção: aberto → em_atendimento na primeira resposta de admin/monitor.
async function autoPromoteStatus(reportId: string): Promise<boolean> {
  const { data: rep } = await sip().from('reports').select('status').eq('id', reportId).maybeSingle();
  if (!rep || rep.status !== 'aberto') return false;
  const { count } = await sip()
    .from('ticket_messages')
    .select('id', { count: 'exact', head: true })
    .eq('report_id', reportId)
    .in('sender_role', ['admin', 'monitor']);
  if ((count ?? 0) > 0) return false;
  await sip().from('reports').update({ status: 'em_atendimento' }).eq('id', reportId);
  return true;
}

// Lê o nome do usuário (fallback no parâmetro).
async function userName(userId: string, fallback: string): Promise<string> {
  const { data: u } = await sip().from('users').select('name').eq('id', userId).maybeSingle();
  return (u?.name as string | undefined) ?? fallback;
}

// Verifica se o monitor é o responsável pelo report (monitor_id desnormalizado).
async function monitorOwnsReport(reportId: string, monitorId: string): Promise<boolean> {
  const { data } = await sip().from('reports').select('monitor_id').eq('id', reportId).maybeSingle();
  return !!data && data.monitor_id === monitorId;
}

function readMessageBody(body: unknown): { trimmed: string | null; attachments: Attachment[] } {
  const b = (body ?? {}) as { body?: string; attachments?: Attachment[] };
  const trimmed = b.body?.trim() || null;
  const attachments = Array.isArray(b.attachments) ? b.attachments : [];
  return { trimmed, attachments };
}

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

// ════════════════════════════════════════════════════════════════════════════════
// CHAT DE CHAMADOS (ticket_messages) — porte de handlers/chamados.ts
//
// Estas rotas são montadas no chamadosRouter (em /api), ANTES dos gates de
// monitor/admin. Por isso a verificação de papel é feita INLINE em cada handler
// (admin → role 'admin'; monitor → dono via monitor_id; aluno → owner do report).
// ════════════════════════════════════════════════════════════════════════════════

// ── GET /me/reports/:id/messages ────────────────────────────────────────────────
chamadosRouter.get('/me/reports/:id/messages', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const reportId = req.params.id;
    const { data: rep } = await sip().from('reports').select('user_id, status').eq('id', reportId).maybeSingle();
    if (!rep || rep.user_id !== userId) return res.status(403).json({ error: ERR_ACCESS_DENIED });

    const { data: msgs } = await sip()
      .from('ticket_messages')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    return res.json({ messages: (msgs || []) as TicketMessageRow[], status: rep.status });
  } catch (err) {
    next(err);
  }
});

// ── POST /me/reports/:id/messages ───────────────────────────────────────────────
chamadosRouter.post('/me/reports/:id/messages', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const reportId = req.params.id;
    const { data: rep } = await sip().from('reports').select('user_id, status').eq('id', reportId).maybeSingle();
    if (!rep || rep.user_id !== userId) return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (rep.status === 'finalizado')
      return res.status(403).json({ error: 'Chamado encerrado. Use "Solicitar reabertura" para reabrir.' });

    const { trimmed, attachments } = readMessageBody(req.body);
    if (!trimmed && attachments.length === 0) return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });

    const name = await userName(userId, 'Aluno');
    const msg = await insertTicketMessage({
      reportId,
      senderId: userId,
      senderName: name,
      senderRole: 'student',
      body: trimmed,
      attachments,
    });
    if (!msg) return res.status(500).json({ error: 'Falha ao enviar mensagem.' });

    return res.status(201).json({ id: msg.id, created_at: msg.created_at });
  } catch (err) {
    next(err);
  }
});

// ── POST /me/reports/:id/reopen ───────────────────────────────────────────────────
chamadosRouter.post('/me/reports/:id/reopen', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const reportId = req.params.id;
    const { data: rep } = await sip().from('reports').select('user_id, status').eq('id', reportId).maybeSingle();
    if (!rep || rep.user_id !== userId) return res.status(403).json({ error: ERR_ACCESS_DENIED });
    if (rep.status !== 'finalizado') return res.status(400).json({ error: 'Chamado não está finalizado.' });

    const sysMsg = await insertTicketMessage({
      reportId,
      senderId: null,
      senderName: 'Sistema',
      senderRole: 'system',
      body: '🔄 Aluno solicitou reabertura do chamado.',
      attachments: [],
    });
    if (!sysMsg) return res.status(500).json({ error: 'Falha ao reabrir chamado.' });

    await sip().from('reports').update({ status: 'aberto' }).eq('id', reportId);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /admin/reports/:id/messages ───────────────────────────────────────────────
chamadosRouter.get('/admin/reports/:id/messages', async (req, res, next) => {
  try {
    if (req.user!.role !== 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const reportId = req.params.id;
    const { data: rep } = await sip()
      .from('reports')
      .select('id, status, kind, user_name, user_email, created_at, last_message_at')
      .eq('id', reportId)
      .maybeSingle();
    if (!rep) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const { data: msgs } = await sip()
      .from('ticket_messages')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    return res.json({ report: rep, messages: (msgs || []) as TicketMessageRow[] });
  } catch (err) {
    next(err);
  }
});

// ── POST /admin/reports/:id/messages ──────────────────────────────────────────────
chamadosRouter.post('/admin/reports/:id/messages', async (req, res, next) => {
  try {
    if (req.user!.role !== 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const userId = req.user!.id;
    const reportId = req.params.id;
    const { data: rep } = await sip().from('reports').select('status').eq('id', reportId).maybeSingle();
    if (!rep) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const { trimmed, attachments } = readMessageBody(req.body);
    if (!trimmed && attachments.length === 0) return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });

    const promoted = await autoPromoteStatus(reportId);
    const name = await userName(userId, 'Admin');
    const msg = await insertTicketMessage({
      reportId,
      senderId: userId,
      senderName: name,
      senderRole: 'admin',
      body: trimmed,
      attachments,
    });
    if (!msg) return res.status(500).json({ error: 'Falha ao enviar mensagem.' });

    return res.status(201).json({ id: msg.id, created_at: msg.created_at, promoted });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /admin/reports/:id/status ───────────────────────────────────────────────
chamadosRouter.patch('/admin/reports/:id/status', async (req, res, next) => {
  try {
    if (req.user!.role !== 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const reportId = req.params.id;
    const { status } = (req.body ?? {}) as { status?: string };
    const ALLOWED = ['finalizado', 'aberto'];
    if (!status || !ALLOWED.includes(status))
      return res.status(400).json({ error: 'Status inválido. Use "finalizado" ou "aberto".' });

    const { data: rep } = await sip().from('reports').select('status').eq('id', reportId).maybeSingle();
    if (!rep) return res.status(404).json({ error: 'Chamado não encontrado.' });

    await sip().from('reports').update({ status }).eq('id', reportId);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /monitor/reports/:id/messages ─────────────────────────────────────────────
chamadosRouter.get('/monitor/reports/:id/messages', async (req, res, next) => {
  try {
    const role = req.user!.role;
    if (role !== 'monitor' && role !== 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const reportId = req.params.id;
    if (role === 'monitor' && !(await monitorOwnsReport(reportId, req.user!.id)))
      return res.status(403).json({ error: ERR_ACCESS_DENIED });

    const { data: rep } = await sip()
      .from('reports')
      .select('id, status, kind, user_name, user_email, created_at, last_message_at')
      .eq('id', reportId)
      .maybeSingle();
    if (!rep) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const { data: msgs } = await sip()
      .from('ticket_messages')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    return res.json({ report: rep, messages: (msgs || []) as TicketMessageRow[] });
  } catch (err) {
    next(err);
  }
});

// ── POST /monitor/reports/:id/messages ────────────────────────────────────────────
chamadosRouter.post('/monitor/reports/:id/messages', async (req, res, next) => {
  try {
    const role = req.user!.role;
    if (role !== 'monitor' && role !== 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const userId = req.user!.id;
    const reportId = req.params.id;
    if (role === 'monitor' && !(await monitorOwnsReport(reportId, userId)))
      return res.status(403).json({ error: ERR_ACCESS_DENIED });

    const { data: rep } = await sip().from('reports').select('status').eq('id', reportId).maybeSingle();
    if (!rep) return res.status(404).json({ error: 'Chamado não encontrado.' });

    const { trimmed, attachments } = readMessageBody(req.body);
    if (!trimmed && attachments.length === 0) return res.status(400).json({ error: 'Mensagem não pode estar vazia.' });

    const promoted = await autoPromoteStatus(reportId);
    const name = await userName(userId, 'Monitor');
    const msg = await insertTicketMessage({
      reportId,
      senderId: userId,
      senderName: name,
      senderRole: 'monitor',
      body: trimmed,
      attachments,
    });
    if (!msg) return res.status(500).json({ error: 'Falha ao enviar mensagem.' });

    return res.status(201).json({ id: msg.id, created_at: msg.created_at, promoted });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /monitor/reports/:id/status ─────────────────────────────────────────────
// Monitor só pode finalizar (não reabrir). Admin (via gate) pode usar a rota admin.
chamadosRouter.patch('/monitor/reports/:id/status', async (req, res, next) => {
  try {
    const role = req.user!.role;
    if (role !== 'monitor' && role !== 'admin') return res.status(403).json({ error: ERR_ACCESS_DENIED });
    const reportId = req.params.id;
    if (role === 'monitor' && !(await monitorOwnsReport(reportId, req.user!.id)))
      return res.status(403).json({ error: ERR_ACCESS_DENIED });

    const { status } = (req.body ?? {}) as { status?: string };
    if (status !== 'finalizado') return res.status(400).json({ error: 'Monitor só pode finalizar chamados.' });

    const { data: rep } = await sip().from('reports').select('status').eq('id', reportId).maybeSingle();
    if (!rep) return res.status(404).json({ error: 'Chamado não encontrado.' });

    await sip().from('reports').update({ status: 'finalizado' }).eq('id', reportId);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
