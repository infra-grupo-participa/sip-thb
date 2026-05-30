// Agregados de admin: completion taskline-aware — porte de _shared.ts.
import { sip } from '../db.js';
import { getPalestrasQuestionId, getSeminariosQuestionId, palestrasCountFromAnswers } from './taskline.js';

/** Map `${ciclo_type}|${taskline}` → nº de tarefas do aluno (owner != equipe, ativas). */
export async function buildTasklineTotals(): Promise<Map<string, number>> {
  const { data: tasks } = await sip().from('tasks').select('ciclo_type, taskline, owner').eq('active', true);
  const totals = new Map<string, number>();
  for (const t of tasks || []) {
    if ((t.owner ?? 'aluno') === 'equipe') continue;
    const key = `${t.ciclo_type}|${t.taskline ?? 'default'}`;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return totals;
}

/** Resolve a taskline de vários alunos em lote (1 query por ciclo). */
export async function resolveTasklinesForStudents(
  students: Array<{ id: string; ciclo_type?: string | null }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const s of students) map.set(s.id, 'default');

  const aurumIds = students.filter((s) => s.ciclo_type === 'aurum').map((s) => s.id);
  const seminarioIds = students.filter((s) => s.ciclo_type === 'seminario').map((s) => s.id);

  if (aurumIds.length > 0) {
    const pqId = await getPalestrasQuestionId();
    const { data } = await sip().from('users').select('id, raiox_answers').in('id', aurumIds);
    const byId = new Map<string, unknown>();
    for (const u of data || []) byId.set(u.id, u.raiox_answers);
    for (const id of aurumIds) {
      const ans = byId.get(id) as Record<string, unknown> | null | undefined;
      map.set(id, palestrasCountFromAnswers(ans, pqId) === 0 ? 'aurum_novo' : 'aurum_senior');
    }
  }
  if (seminarioIds.length > 0) {
    const sqId = await getSeminariosQuestionId();
    const { data } = await sip().from('users').select('id, raiox_answers').in('id', seminarioIds);
    const byId = new Map<string, unknown>();
    for (const u of data || []) byId.set(u.id, u.raiox_answers);
    for (const id of seminarioIds) {
      const ans = byId.get(id) as Record<string, unknown> | null | undefined;
      map.set(id, palestrasCountFromAnswers(ans, sqId) === 0 ? 'seminario_novo' : 'seminario_senior');
    }
  }
  return map;
}

export function tasklineTotalFor(
  totals: Map<string, number>,
  cicloType: string | null | undefined,
  taskline: string | undefined,
): number {
  return totals.get(`${cicloType}|${taskline ?? 'default'}`) ?? 0;
}
