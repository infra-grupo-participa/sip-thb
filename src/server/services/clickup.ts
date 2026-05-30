// Serviço ClickUp — porte de sip-clickup/index.ts + dispatchHandoff de
// handlers/_shared.ts. Diferença da stack atual: chama a API do ClickUp
// DIRETAMENTE (sem HTTP cross-function). Fire-and-forget no caller.
import { sip } from '../db.js';
import { env } from '../env.js';

export interface ClickUpPayload {
  aluno_nome: string;
  aluno_email: string;
  ciclo_type: string;
  taskline: string;
  monitor_nome: string | null;
  task_titulo: string;
  passo?: string | null;
  link?: string | null;
  parent_task_id?: string | null;
  operator_steps?: string[] | null;
  submitted_at: string;
}

export interface ClickUpDispatchResult {
  ok: boolean;
  error?: string;
}

const CHECKLIST_NAME = 'Passo a passo';
const MAX_SUBTASK_NAME = 250;
const MAX_ALUNO_NAME = 80;
const MAX_RETRY_AFTER_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function cuGet(path: string): Promise<Response> {
  return fetch(`https://api.clickup.com/api/v2${path}`, { headers: { Authorization: env.CLICKUP_TOKEN } });
}
function cuPost(path: string, body: unknown): Promise<Response> {
  return fetch(`https://api.clickup.com/api/v2${path}`, {
    method: 'POST',
    headers: { Authorization: env.CLICKUP_TOKEN, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}
async function cuPostRetry(path: string, body: unknown): Promise<Response> {
  const res = await cuPost(path, body);
  if (res.status !== 429) return res;
  const ra = res.headers.get('retry-after');
  const waitMs = Math.min(MAX_RETRY_AFTER_MS, Number(ra) > 0 ? Number(ra) * 1000 : 2000);
  console.warn(`[clickup] 429 rate limit, retry em ${waitMs}ms`);
  await sleep(waitMs);
  return cuPost(path, body);
}

async function getParentContext(
  parentTaskId: string,
): Promise<{ listId: string | null; existingSubtaskNames: Set<string> }> {
  const empty = { listId: null as string | null, existingSubtaskNames: new Set<string>() };
  const res = await cuGet(`/task/${parentTaskId}?include_subtasks=true`);
  if (!res.ok) {
    console.error('[clickup] erro ao buscar task-mãe:', res.status, await res.text());
    return empty;
  }
  const data = (await res.json()) as { list?: { id?: string }; subtasks?: Array<{ name?: string }> };
  const listId = data.list?.id ?? null;
  const names = new Set<string>((data.subtasks ?? []).map((s) => (s.name || '').trim()));
  return { listId, existingSubtaskNames: names };
}

function buildDescription(p: ClickUpPayload): string {
  const lines: string[] = [`**Tarefa:** ${p.task_titulo}`];
  if (p.aluno_email) lines.push(`**E-mail:** ${p.aluno_email}`);
  if (p.monitor_nome) lines.push(`**Monitor:** ${p.monitor_nome}`);
  lines.push(`**Trilha:** ${p.taskline}`);
  if (p.link) lines.push(`**Link enviado:** ${p.link}`);
  return lines.join('\n');
}

/** Cria a subtarefa-por-aluno + checklist. Devolve {ok,error}. */
export async function dispatchClickUp(p: ClickUpPayload): Promise<ClickUpDispatchResult> {
  if (!env.CLICKUP_TOKEN) return { ok: false, error: 'clickup_token_missing' };
  if (!p.parent_task_id) return { ok: false, error: 'no_parent_id' };
  try {
    const { listId, existingSubtaskNames } = await getParentContext(p.parent_task_id);
    if (!listId) return { ok: false, error: 'no_list_id' };

    const dataFormatada = new Date(p.submitted_at).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
    const alunoNomeSafe = (p.aluno_nome || '—').slice(0, MAX_ALUNO_NAME);
    let subtaskName = `${alunoNomeSafe} — ${dataFormatada}`;
    if (subtaskName.length > MAX_SUBTASK_NAME) subtaskName = subtaskName.slice(0, MAX_SUBTASK_NAME - 1) + '…';

    if (existingSubtaskNames.has(subtaskName.trim())) return { ok: true }; // idempotente

    const createRes = await cuPostRetry(`/list/${listId}/task`, {
      name: subtaskName,
      parent: p.parent_task_id,
      description: buildDescription(p),
    });
    if (!createRes.ok) {
      return { ok: false, error: `create_failed_${createRes.status}` };
    }
    const created = (await createRes.json()) as { id?: string };
    const subtaskId = created.id ?? null;
    if (!subtaskId) return { ok: false, error: 'no_subtask_id' };

    const steps = (p.operator_steps ?? []).filter((s) => typeof s === 'string' && s.trim());
    if (steps.length > 0) {
      const chkRes = await cuPostRetry(`/task/${subtaskId}/checklist`, { name: CHECKLIST_NAME });
      if (chkRes.ok) {
        const chkData = (await chkRes.json()) as { checklist?: { id?: string } };
        const checklistId = chkData.checklist?.id ?? null;
        if (checklistId) {
          for (const step of steps) {
            await cuPostRetry(`/checklist/${checklistId}/checklist_item`, { name: step.slice(0, 500) });
          }
        }
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown_error' };
  }
}

// ── dispatchHandoff (porte de _shared.ts) ───────────────────────────────────
// Registra task_proofs (anti-dup) e dispara o ClickUp. Nunca lança ao caller.
export async function dispatchHandoff(opts: {
  userId: string;
  cicloType: string;
  taskline: string;
  task: { id: string; title: string; ciclo_type?: string | null; clickup_target_key?: string | null; owner?: string | null };
  link: string | null;
}): Promise<void> {
  const { userId, cicloType, taskline, task, link } = opts;
  if ((task.owner ?? 'aluno') === 'equipe') return;

  const { data: existingDispatch } = await sip()
    .from('task_proofs')
    .select('id, sent_to_clickup, clickup_target_key')
    .eq('user_id', userId)
    .eq('task_id', task.id)
    .eq('status', 'enviado')
    .limit(1)
    .maybeSingle();
  if (existingDispatch) return;

  const hasKey = !!task.clickup_target_key;
  let parentId: string | null = null;
  let operatorSteps: string[] = [];
  if (hasKey) {
    const { data: target } = await sip()
      .from('clickup_targets')
      .select('clickup_task_id, operator_steps')
      .eq('key', task.clickup_target_key)
      .eq('taskline', taskline)
      .maybeSingle();
    parentId = (target?.clickup_task_id as string) ?? null;
    operatorSteps = (target?.operator_steps as string[] | null) ?? [];
  }

  const { data: userData } = await sip().from('users').select('name, email, monitor_id').eq('id', userId).maybeSingle();
  let monitorNome: string | null = null;
  if (userData?.monitor_id) {
    const { data: mon } = await sip().from('users').select('name').eq('id', userData.monitor_id).maybeSingle();
    monitorNome = mon?.name ?? null;
  }

  const submittedAt = new Date().toISOString();
  const { data: proofRow, error: insErr } = await sip()
    .from('task_proofs')
    .insert({
      user_id: userId, task_id: task.id, task_title: task.title,
      ciclo_type: task.ciclo_type ?? cicloType, link: link ?? null,
      status: 'enviado', submitted_at: submittedAt,
      clickup_target_key: task.clickup_target_key ?? null,
      sent_to_clickup: false,
      aluno_nome: userData?.name ?? null,
      aluno_email: userData?.email ?? null,
    })
    .select('id')
    .single();

  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return; // race — noop
    console.error('[handoff] insert task_proofs failed:', insErr);
    return;
  }
  const proofId = proofRow?.id as string | undefined;

  if (!parentId) {
    if (hasKey && proofId) {
      await sip()
        .from('task_proofs')
        .update({ clickup_error: `clickup_target sem clickup_task_id (key=${task.clickup_target_key})` })
        .eq('id', proofId);
    }
    return;
  }

  const result = await dispatchClickUp({
    aluno_nome: (userData?.name ?? userId).slice(0, 100),
    aluno_email: userData?.email ?? '',
    ciclo_type: cicloType,
    taskline,
    monitor_nome: monitorNome,
    task_titulo: task.title,
    passo: task.title,
    link: link ?? null,
    parent_task_id: parentId,
    operator_steps: operatorSteps,
    submitted_at: submittedAt,
  });

  if (proofId) {
    await sip()
      .from('task_proofs')
      .update({
        sent_to_clickup: result.ok,
        clickup_dispatched_at: new Date().toISOString(),
        clickup_error: result.ok ? null : (result.error ?? 'dispatch_failed'),
      })
      .eq('id', proofId);
  }
}
