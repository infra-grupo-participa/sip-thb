// Domínio: progresso/taskline materializado — porte de handlers/_shared.ts
// (buildProgress, buildMilestones, templates). Usa o accessor sip().
import { sip } from '../db.js';
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
