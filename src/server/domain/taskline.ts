// Domínio: Taskline — resolve QUAL trilha de tarefas um aluno enxerga.
// Porte de _shared/domain/taskline.ts (usa o accessor sip() em vez de receber db).
import { sip } from '../db.js';

export type Taskline =
  | 'default'
  | 'aurum_novo'
  | 'aurum_senior'
  | 'seminario_novo'
  | 'seminario_senior';

// Cache em memória dos ids das perguntas de routing (não hardcodar UUIDs).
let _palestrasQId: string | null = null;
let _palestrasQLoaded = false;
let _seminariosQId: string | null = null;
let _seminariosQLoaded = false;

export async function getPalestrasQuestionId(): Promise<string | null> {
  if (_palestrasQLoaded) return _palestrasQId;
  const { data } = await sip()
    .from('raiox_questions')
    .select('id')
    .eq('categoria', 'Palestras')
    .eq('tipo', 'numero')
    .eq('active', true)
    .order('ordem', { ascending: true })
    .limit(1)
    .maybeSingle();
  _palestrasQId = (data?.id as string) ?? null;
  _palestrasQLoaded = true;
  return _palestrasQId;
}

export async function getSeminariosQuestionId(): Promise<string | null> {
  if (_seminariosQLoaded) return _seminariosQId;
  const { data } = await sip()
    .from('raiox_questions')
    .select('id')
    .eq('categoria', 'Seminários')
    .eq('tipo', 'numero')
    .eq('active', true)
    .order('ordem', { ascending: true })
    .limit(1)
    .maybeSingle();
  _seminariosQId = (data?.id as string) ?? null;
  _seminariosQLoaded = true;
  return _seminariosQId;
}

/** Lê a contagem de um evento das respostas do Raio-X. Inválido/ausente → 0. */
export function palestrasCountFromAnswers(
  answers: Record<string, unknown> | null | undefined,
  questionId: string | null,
): number {
  if (!answers || !questionId) return 0;
  const n = Number(answers[questionId]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Resolução pura (já tenho ciclo_type + answers + ids das perguntas). */
export function resolveTasklineFrom(
  user: { ciclo_type?: string | null; raiox_answers?: Record<string, unknown> | null },
  palestrasQId: string | null,
  seminariosQId?: string | null,
): Taskline {
  if (user.ciclo_type === 'aurum') {
    return palestrasCountFromAnswers(user.raiox_answers, palestrasQId) === 0
      ? 'aurum_novo'
      : 'aurum_senior';
  }
  if (user.ciclo_type === 'seminario') {
    return palestrasCountFromAnswers(user.raiox_answers, seminariosQId ?? null) === 0
      ? 'seminario_novo'
      : 'seminario_senior';
  }
  return 'default';
}

/** Resolve a taskline a partir do usuário efetivo (titular já resolvido). */
export async function resolveTaskline(user: {
  id: string;
  ciclo_type?: string | null;
  raiox_answers?: Record<string, unknown> | null;
}): Promise<Taskline> {
  if (user.ciclo_type !== 'aurum' && user.ciclo_type !== 'seminario') return 'default';

  let answers = user.raiox_answers;
  if (answers === undefined) {
    const { data } = await sip()
      .from('users')
      .select('raiox_answers')
      .eq('id', user.id)
      .maybeSingle();
    answers = (data?.raiox_answers as Record<string, unknown> | null) ?? null;
  }

  if (user.ciclo_type === 'aurum') {
    const questionId = await getPalestrasQuestionId();
    return palestrasCountFromAnswers(answers, questionId) === 0 ? 'aurum_novo' : 'aurum_senior';
  }
  const questionId = await getSeminariosQuestionId();
  return palestrasCountFromAnswers(answers, questionId) === 0
    ? 'seminario_novo'
    : 'seminario_senior';
}
