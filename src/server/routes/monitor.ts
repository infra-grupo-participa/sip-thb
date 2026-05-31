// Monitor — portal do monitor (porte de handlers/monitor.ts + GET /monitor/reports
// de handlers/chamados.ts). Visão do papel "monitor" sobre os alunos sob sua
// responsabilidade, sempre filtrando por `monitor_id = userId` para isolar dados
// entre monitores. O gate de montagem (monitorGate) garante role monitor|admin.
//
// Endpoints:
//   GET /monitor/students          → listagem com progresso + date_change_requested
//   GET /monitor/students/:id/full → ficha completa de um aluno do próprio monitor
//   GET /monitor/reports           → chamados do monitor (filtro opcional por status)
import { Router } from 'express';
import { sip } from '../db.js';
import { resolveTaskline } from '../domain/taskline.js';
import { buildProgress } from '../domain/progress.js';

export const monitorRouter = Router();

// USER_FULL_COLS: admin/monitor visualiza ficha do aluno; tudo exceto hash e auth_id.
// (cópia do legado handlers/_shared.ts)
const USER_FULL_COLS =
  'id, name, email, role, ciclo_type, current_ciclo_id, monitor_id, onboarding_done, phone, city, self_registered, profissao, tempo_carreira, lancamentos_anteriores, faturamento_atual, instagram_handle, fez_curso_thb_antes, is_socio, socio_of, created_at, raiox_answers, raiox_score, raiox_max_score, raiox_submitted_at, approval_status, approval_decided_at, approval_decided_by, approval_note, interesse_ciclo, turma_aurum, is_platina, turma_thb, onboarding_perfil, must_change_password, password_changed_at, nivel';

// ── GET /monitor/students ──────────────────────────────────────────────────
monitorRouter.get('/monitor/students', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { data: students } = await sip()
      .from('users')
      .select('id, name, email, ciclo_type')
      .eq('role', 'student')
      .eq('monitor_id', userId);
    const result = await Promise.all(
      (students || []).map(async (student: Record<string, unknown>) => {
        // Taskline-aware: usa buildProgress (filtra ciclo_type + taskline e conta
        // só tarefas do aluno, owner != equipe) p/ o percentual bater com a visão
        // do próprio aluno.
        const taskline = await resolveTaskline({
          id: student.id as string,
          ciclo_type: student.ciclo_type as string,
        });
        const [prog, { data: metaEntries }] = await Promise.all([
          buildProgress(student.id as string, student.ciclo_type as string, taskline),
          sip().from('meta').select('key, value').eq('user_id', student.id as string),
        ]);
        const meta: Record<string, unknown> = {};
        for (const e of metaEntries || []) meta[e.key] = e.value;
        return {
          id: student.id,
          name: student.name,
          email: student.email,
          ciclo_type: student.ciclo_type,
          completed_tasks: prog.completed,
          total_tasks: prog.total,
          progress_percent: prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0,
          date_change_requested:
            meta.date_change_requested === true || meta.date_change_requested === 'true',
        };
      }),
    );
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /monitor/students/:id/full ─────────────────────────────────────────
monitorRouter.get('/monitor/students/:id/full', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { data: student } = await sip()
      .from('users')
      .select(USER_FULL_COLS)
      .eq('id', req.params.id)
      .eq('role', 'student')
      .eq('monitor_id', userId)
      .maybeSingle();
    if (!student) return res.status(404).json({ error: 'Aluno não encontrado ou não associado a você' });
    const taskline = await resolveTaskline(student);
    const prog = await buildProgress(student.id, student.ciclo_type, taskline);
    const [{ data: posts }, { data: trafficRows }, { data: metaEntries }] = await Promise.all([
      sip().from('posts').select('*').eq('user_id', student.id).order('date', { ascending: false }),
      sip().from('traffic').select('*').eq('user_id', student.id).order('date'),
      sip().from('meta').select('key, value').eq('user_id', student.id),
    ]);
    const meta: Record<string, unknown> = {};
    for (const e of metaEntries || []) meta[e.key] = e.value;
    return res.json({
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
        ciclo_type: student.ciclo_type,
        onboarding_perfil: student.onboarding_perfil ?? null,
      },
      stages: prog.stages,
      total: prog.total,
      completed: prog.completed,
      posts: posts ?? [],
      traffic: trafficRows ?? [],
      meta,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /monitor/reports ───────────────────────────────────────────────────
// Porte de handlers/chamados.ts: lista chamados do monitor, filtro opcional por
// status (?status=...). Ordena por last_message_at asc (nullsFirst).
monitorRouter.get('/monitor/reports', async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;

    let q = sip()
      .from('reports')
      .select(
        'id, user_name, user_email, kind, status, created_at, last_message_at, last_message_by, monitor_id',
      )
      .eq('monitor_id', userId)
      .order('last_message_at', { ascending: true, nullsFirst: true });

    if (statusFilter) q = q.eq('status', statusFilter);

    const { data } = await q;
    return res.json({ items: data || [] });
  } catch (err) {
    next(err);
  }
});
