// Domínio: progresso/taskline materializado — porte de handlers/_shared.ts
// (buildProgress, buildMilestones, templates). Usa o accessor sip().
import { sip } from '../db.js';
import { resolveTaskline } from './taskline.js';
import {
  buildSchedule,
  type CicloTemplate,
  type ScheduleMilestone,
  type ScheduleOverrides,
} from './schedule.js';

// ── Cache de templates (TTL 60s) ────────────────────────────────────────────
type CachedTemplates = { value: Map<string, CicloTemplate>; expires: number };
let _templateCache: CachedTemplates | null = null;
const TEMPLATE_TTL_MS = 60_000;

export function _invalidateTemplateCache(): void {
  _templateCache = null;
}

export async function loadCicloTemplates(): Promise<Map<string, CicloTemplate>> {
  const now = Date.now();
  if (_templateCache && _templateCache.expires > now) return _templateCache.value;
  const { data, error } = await sip()
    .from('ciclo_templates')
    .select('ciclo_type, duracao_dias, milestones, rules');
  if (error) {
    console.error('[loadCicloTemplates] erro:', error);
    throw new Error('Falha ao carregar templates de ciclo');
  }
  const map = new Map<string, CicloTemplate>();
  for (const row of data || []) map.set(row.ciclo_type, row as CicloTemplate);
  _templateCache = { value: map, expires: now + TEMPLATE_TTL_MS };
  return map;
}

export async function getCicloTemplate(cicloType: string): Promise<CicloTemplate> {
  const templates = await loadCicloTemplates();
  const t = templates.get(cicloType);
  if (!t) throw new Error(`Template não encontrado para ciclo_type=${cicloType}`);
  return t;
}

export async function buildMilestones(
  anchorDate: string,
  cicloType: string,
  overrides: ScheduleOverrides = {},
): Promise<ScheduleMilestone[]> {
  const template = await getCicloTemplate(cicloType);
  return buildSchedule(anchorDate, template, overrides);
}

// ── buildProgress ───────────────────────────────────────────────────────────
type ProgressRow = { task_id: string; completed: boolean; completed_at: string | null; auto_completed?: boolean };

export interface BuildProgressResult {
  stages: Array<Record<string, unknown> & { id: string; unlocked: boolean; completed: boolean }>;
  total: number;
  completed: number;
  progressMap: Record<string, ProgressRow>;
  allTasks: Array<Record<string, unknown>>;
  stagesRaw: Array<Record<string, unknown>>;
}

export async function buildProgress(
  userId: string,
  cicloType: string,
  taskline = 'default',
): Promise<BuildProgressResult> {
  const [
    { data: stages },
    { data: allTasks },
    { data: userProgress },
    { data: dataPalestraMeta },
    { data: gateMeta },
  ] = await Promise.all([
    sip().from('stages').select('*').eq('ciclo_type', cicloType).eq('taskline', taskline).order('stage_number'),
    sip().from('tasks').select('*').eq('ciclo_type', cicloType).eq('taskline', taskline).eq('active', true).order('stage_number').order('order_index'),
    sip().from('progress').select('*').eq('user_id', userId),
    sip().from('meta').select('value').eq('user_id', userId).eq('key', 'data_palestra').maybeSingle(),
    sip().from('meta').select('value').eq('user_id', '__settings__').eq('key', 'launch_gate_aurum').maybeSingle(),
  ]);

  const launchGateOn = (gateMeta?.value ?? 'off') === 'on';
  const gateAllowedStage = taskline === 'aurum_novo' ? 1 : taskline === 'aurum_senior' ? 6 : null;

  const progressMap: Record<string, ProgressRow> = {};
  for (const p of userProgress || []) progressMap[p.task_id] = p;

  const palestraDateRaw = (dataPalestraMeta?.value ?? null) as unknown;
  const palestraDateStr = typeof palestraDateRaw === 'string' ? palestraDateRaw.trim().slice(0, 10) : null;
  const todayStr = new Date().toISOString().slice(0, 10);
  const palestraGateOpen = palestraDateStr ? todayStr >= palestraDateStr : true;

  const result: BuildProgressResult['stages'] = [];
  let previousStageCompleted = true;

  for (const stage of stages || []) {
    const stageTasks = (allTasks || []).filter((t: { stage_id: string }) => t.stage_id === stage.id);
    const categoriesMap: Record<string, unknown[]> = {};

    for (const task of stageTasks) {
      if (!categoriesMap[task.category]) categoriesMap[task.category] = [];
      const prog = progressMap[task.id];
      const owner = task.owner ?? 'aluno';
      categoriesMap[task.category]!.push({
        id: task.id,
        title: task.title,
        order_index: task.order_index,
        completed: prog?.completed ?? false,
        completed_at: prog?.completed_at ?? null,
        tutorial_url: task.tutorial_url ?? null,
        why_text: task.why_text ?? null,
        mission: task.mission ?? null,
        auto_trigger: task.auto_trigger ?? null,
        requires_link: task.requires_link === true,
        link_label: task.link_label ?? null,
        owner,
        prazo_label: task.prazo_label ?? null,
        is_handoff: !!task.clickup_target_key,
        interactive: owner !== 'equipe',
      });
    }

    const studentTasks = stageTasks.filter((t: { owner?: string }) => (t.owner ?? 'aluno') !== 'equipe');
    const completedCount = studentTasks.filter((t: { id: string }) => progressMap[t.id]?.completed).length;
    const totalCount = studentTasks.length;
    const stageCompleted = totalCount === 0 ? true : completedCount === totalCount;

    const isPalestraStage = cicloType === 'aurum' && stage.stage_number === 5;
    let unlocked = previousStageCompleted && (!isPalestraStage || palestraGateOpen);

    if (launchGateOn && gateAllowedStage !== null && stage.stage_number !== gateAllowedStage) {
      unlocked = false;
    }

    result.push({
      id: stage.id,
      stage_number: stage.stage_number,
      title: stage.title,
      description: stage.description,
      unlocked,
      completed: stageCompleted,
      completed_count: completedCount,
      total_count: totalCount,
      categories: categoriesMap,
    });

    previousStageCompleted = stageCompleted;
  }

  const studentAllTasks = (allTasks || []).filter((t: { owner?: string }) => (t.owner ?? 'aluno') !== 'equipe');
  const totalTasks = studentAllTasks.length;
  const completedTasks = studentAllTasks.filter((t: { id: string }) => progressMap[t.id]?.completed).length;
  return {
    stages: result,
    total: totalTasks,
    completed: completedTasks,
    progressMap,
    allTasks: allTasks || [],
    stagesRaw: stages || [],
  };
}

// ── checkAutoComplete (porte de _shared.ts) ─────────────────────────────────
// Auto-completa tarefas com auto_trigger satisfeito (posts/traffic/debriefing).
export async function checkAutoComplete(
  userId: string,
  cicloType: string,
  triggerType: string,
): Promise<Array<{ task_id: string; title: string; stage_number: number }>> {
  const taskline = await resolveTaskline({ id: userId, ciclo_type: cicloType });
  const { data: tasks } = await sip()
    .from('tasks')
    .select('id, stage_id, stage_number, title, auto_trigger')
    .eq('ciclo_type', cicloType)
    .eq('taskline', taskline)
    .eq('active', true)
    .not('auto_trigger', 'is', null);

  const triggered = (tasks || []).filter(
    (t: { auto_trigger: { type: string } }) => t.auto_trigger?.type === triggerType,
  );
  if (triggered.length === 0) return [];

  const taskIds = triggered.map((t: { id: string }) => t.id);
  const { data: progressRows } = await sip()
    .from('progress')
    .select('id, task_id, completed')
    .eq('user_id', userId)
    .in('task_id', taskIds);
  const progressByTask = new Map<string, { id: string; completed: boolean }>();
  for (const p of progressRows || []) progressByTask.set(p.task_id, p);

  const candidates = triggered.filter((t: { id: string }) => !progressByTask.get(t.id)?.completed);
  if (candidates.length === 0) return [];

  let trafficRows: Array<{ date: string }> | null = null;
  let postsRows: Array<{ date: string; platform: string }> | null = null;
  let debriefingExists = false;
  if (triggerType === 'traffic') {
    const { data } = await sip().from('traffic').select('date').eq('user_id', userId);
    trafficRows = data || [];
  } else if (triggerType === 'posts') {
    const { data } = await sip().from('posts').select('date, platform').eq('user_id', userId);
    postsRows = data || [];
  } else if (triggerType === 'debriefing') {
    const { data } = await sip().from('debriefings').select('id').eq('user_id', userId).maybeSingle();
    debriefingExists = !!data;
  }

  const prog = await buildProgress(userId, cicloType, taskline);
  const stageById = new Map<string, { unlocked: boolean }>();
  for (const s of prog.stages) stageById.set(s.id, s);

  const completed: Array<{ task_id: string; title: string; stage_number: number }> = [];
  const toUpdate: string[] = [];
  const toInsert: Array<Record<string, unknown>> = [];
  const nowIso = new Date().toISOString();

  for (const task of candidates) {
    const cond = task.auto_trigger.condition;
    let satisfied = false;
    if (triggerType === 'traffic' && trafficRows) {
      const count = cond.days_range
        ? trafficRows.filter((r) => (Date.now() - new Date(r.date).getTime()) / 86400000 <= cond.days_range).length
        : trafficRows.length;
      satisfied = count >= cond.min_count;
    } else if (triggerType === 'posts' && postsRows) {
      const filtered = cond.platform ? postsRows.filter((p) => p.platform === cond.platform) : postsRows;
      if (cond.days_range) {
        const since = new Date(Date.now() - cond.days_range * 86400000).toISOString().split('T')[0]!;
        satisfied = filtered.filter((p) => p.date >= since).length >= cond.min_count;
      } else {
        satisfied = filtered.length >= cond.min_count;
      }
    } else if (triggerType === 'debriefing') {
      satisfied = debriefingExists;
    }
    if (!satisfied) continue;
    if (!stageById.get(task.stage_id)?.unlocked) continue;

    const existing = progressByTask.get(task.id);
    if (existing) toUpdate.push(existing.id);
    else toInsert.push({ user_id: userId, task_id: task.id, completed: true, completed_at: nowIso, auto_completed: true });
    completed.push({ task_id: task.id, title: task.title, stage_number: task.stage_number });
  }

  if (toUpdate.length > 0) {
    await sip().from('progress').update({ completed: true, completed_at: nowIso, auto_completed: true }).in('id', toUpdate);
  }
  if (toInsert.length > 0) {
    await sip().from('progress').insert(toInsert);
  }
  return completed;
}
