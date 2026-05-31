// Agendador interno (node-cron) — substitui os pg_cron → HTTP do legado
// (sip-clickup-retry, ig-collect e a limpeza de login_attempts), centralizando
// os jobs dentro do próprio servidor Express. Ver doc 08-target-architecture §3B.
//
// FIDELIDADE AO LEGADO:
//   - ig-collect: legado roda em 0,6,12,18 UTC com { include_stories: true }.
//     Aqui mantemos a coleta diária (posts + stories) guardada por
//     IG_COLLECT_SECRET (mesmo guard do Edge Function).
//   - clickup-retry: legado roda a cada hora (:15) pegando até 20 proofs
//     com sent_to_clickup=false, clickup_target_key não-nulo e idade ≥5min,
//     re-disparando idempotentemente. Aqui rodamos a cada 30min, guardado por
//     CLICKUP_RETRY_SECRET. O retry é idempotente (dispatchClickUp faz noop em
//     subtarefas já existentes na checklist do ClickUp).
//   - limpeza login_attempts: remove tentativas com >7 dias (attempted_at).
//
// registerCron() NÃO é invocado aqui — o integrador chama no index.ts.
//
// supabase-js NÃO lança em write: sempre checamos { error }.
import * as cron from 'node-cron';
import { sip } from '../db.js';
import { env } from '../env.js';
import { dispatchClickUp } from '../services/clickup.js';
// services/instagram.ts é criado pelo agente ig-backend; assume-se runIgCollect
// exportado com a mesma assinatura de flags do Edge Function ig-collect.
import { runIgCollect } from '../services/instagram.js';

// ── Defaults do retry (espelham o legado sip-clickup-retry) ──────────────────
const RETRY_LIMIT = 20;
const RETRY_AGE_MIN = 5;
// Limpeza: tentativas de login com mais de 7 dias são descartadas.
const LOGIN_ATTEMPTS_MAX_AGE_DAYS = 7;

// ════════════════════════════════════════════════════════════════════════════
// CLICKUP RETRY — re-disparo idempotente de handoffs falhados
// ════════════════════════════════════════════════════════════════════════════

interface RetrySummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

// Porte de retryHandoffById (handlers/_shared.ts + adminConfig.ts). Faz claim
// otimista (clickup_dispatched_at) e re-dispara um único proof. Nunca lança.
async function retryHandoffById(proofId: string): Promise<{ ok: boolean; error?: string }> {
  const claimAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await sip()
    .from('task_proofs')
    .update({ clickup_dispatched_at: claimAt })
    .eq('id', proofId)
    .eq('sent_to_clickup', false)
    .select(
      'id, user_id, task_id, task_title, ciclo_type, link, submitted_at, clickup_target_key, aluno_nome, aluno_email, tasks:task_id(taskline)',
    )
    .maybeSingle();
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed) return { ok: true }; // já enviado por outra janela — noop
  const p = claimed as Record<string, unknown>;

  const targetKey = (p.clickup_target_key as string | null) ?? null;
  if (!targetKey) {
    await sip().from('task_proofs').update({ clickup_error: 'no_clickup_target_key' }).eq('id', proofId);
    return { ok: false, error: 'no_clickup_target_key' };
  }

  const taskRec = p.tasks as { taskline?: string } | null;
  const taskline = taskRec?.taskline ?? (p.ciclo_type as string);

  const { data: target } = await sip()
    .from('clickup_targets')
    .select('clickup_task_id, operator_steps')
    .eq('key', targetKey)
    .eq('taskline', taskline)
    .maybeSingle();
  const parentId = (target?.clickup_task_id as string) ?? null;
  if (!parentId) {
    const errMsg = `no_parent_id (key=${targetKey}, taskline=${taskline})`;
    await sip().from('task_proofs').update({ clickup_error: errMsg }).eq('id', proofId);
    return { ok: false, error: errMsg };
  }

  // Prefere snapshots (aluno_nome/email no proof); fallback ao users só p/ antigos.
  let alunoNome = (p.aluno_nome as string | null) ?? null;
  let alunoEmail = (p.aluno_email as string | null) ?? null;
  let monitorNome: string | null = null;
  if (!alunoNome || !alunoEmail) {
    const { data: u } = await sip()
      .from('users')
      .select('name, email, monitor_id')
      .eq('id', p.user_id as string)
      .maybeSingle();
    alunoNome = alunoNome ?? ((u?.name as string | undefined) ?? null);
    alunoEmail = alunoEmail ?? ((u?.email as string | undefined) ?? null);
    if (u?.monitor_id) {
      const { data: m } = await sip().from('users').select('name').eq('id', u.monitor_id).maybeSingle();
      monitorNome = (m?.name as string | undefined) ?? null;
    }
  }

  const result = await dispatchClickUp({
    aluno_nome: (alunoNome ?? (p.user_id as string)).slice(0, 100),
    aluno_email: alunoEmail ?? '',
    ciclo_type: p.ciclo_type as string,
    taskline,
    monitor_nome: monitorNome,
    task_titulo: p.task_title as string,
    passo: p.task_title as string,
    link: (p.link as string | null) ?? null,
    parent_task_id: parentId,
    operator_steps: (target?.operator_steps as string[] | null) ?? [],
    submitted_at: p.submitted_at as string,
  });

  await sip()
    .from('task_proofs')
    .update({
      sent_to_clickup: result.ok,
      clickup_dispatched_at: new Date().toISOString(),
      clickup_error: result.ok ? null : (result.error ?? 'retry_failed'),
    })
    .eq('id', proofId);

  return result;
}

// Porte de sip-clickup-retry/index.ts: lista os proofs pendentes e re-dispara
// sequencialmente (respeita rate-limit do ClickUp). Idempotente.
async function retryFailedHandoffs(opts: {
  limit?: number;
  olderThanMinutes?: number;
}): Promise<RetrySummary> {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || RETRY_LIMIT));
  const ageMinRaw = Number(opts.olderThanMinutes);
  const ageMin = Number.isFinite(ageMinRaw) ? Math.max(0, ageMinRaw) : RETRY_AGE_MIN;
  const cutoff = new Date(Date.now() - ageMin * 60_000).toISOString();

  const { data: pending, error } = await sip()
    .from('task_proofs')
    .select('id')
    .eq('sent_to_clickup', false)
    .not('clickup_target_key', 'is', null)
    .lt('submitted_at', cutoff)
    .order('submitted_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[cron clickup-retry] lookup failed:', error.message);
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const proofIds = (pending ?? []).map((row) => (row as Record<string, unknown>).id as string);
  if (proofIds.length === 0) return { attempted: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  for (const pid of proofIds) {
    const r = await retryHandoffById(pid);
    if (r.ok) succeeded += 1;
    else failed += 1;
  }

  console.log(
    `[cron clickup-retry] attempted=${proofIds.length} succeeded=${succeeded} failed=${failed}`,
  );
  return { attempted: proofIds.length, succeeded, failed };
}

// ════════════════════════════════════════════════════════════════════════════
// LIMPEZA DE login_attempts (>7 dias)
// ════════════════════════════════════════════════════════════════════════════

async function cleanupLoginAttempts(): Promise<void> {
  const cutoff = new Date(Date.now() - LOGIN_ATTEMPTS_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { error } = await sip().from('login_attempts').delete().lt('attempted_at', cutoff);
  if (error) {
    console.error('[cron cleanup login_attempts] delete failed:', error.message);
    return;
  }
  console.log(`[cron cleanup login_attempts] removed attempts older than ${cutoff}`);
}

// ════════════════════════════════════════════════════════════════════════════
// REGISTRO DOS JOBS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Registra os jobs do node-cron. Chamado UMA vez pelo integrador no boot do
 * servidor (index.ts). Os horários usam o fuso America/Sao_Paulo (BRT, UTC-3).
 */
export function registerCron(): void {
  // ── ig-collect: coleta diária (posts + stories). Guard por IG_COLLECT_SECRET.
  // 06:00 BRT (legado roda quad-daily; aqui consolidamos numa coleta diária).
  cron.schedule(
    '0 6 * * *',
    () => {
      if (!env.IG_COLLECT_SECRET) return;
      runIgCollect({ include_stories: true }).catch((e: unknown) =>
        console.error('[cron ig-collect]', e instanceof Error ? e.message : e),
      );
    },
    { timezone: 'America/Sao_Paulo' },
  );

  // ── clickup-retry: re-dispara handoffs falhados a cada 30min.
  // Guard por CLICKUP_RETRY_SECRET (mantém paridade com o Edge Function legado).
  cron.schedule('*/30 * * * *', () => {
    if (!env.CLICKUP_RETRY_SECRET) return;
    if (!env.CLICKUP_TOKEN) return; // sem token não há dispatcher
    retryFailedHandoffs({ limit: RETRY_LIMIT, olderThanMinutes: RETRY_AGE_MIN }).catch((e: unknown) =>
      console.error('[cron clickup-retry]', e instanceof Error ? e.message : e),
    );
  });

  // ── limpeza diária de login_attempts (>7d). 03:00 BRT.
  cron.schedule(
    '0 3 * * *',
    () => {
      cleanupLoginAttempts().catch((e: unknown) =>
        console.error('[cron cleanup login_attempts]', e instanceof Error ? e.message : e),
      );
    },
    { timezone: 'America/Sao_Paulo' },
  );

  console.log('[cron] jobs registrados: ig-collect (06:00 BRT), clickup-retry (*/30min), cleanup login_attempts (03:00 BRT)');
}
