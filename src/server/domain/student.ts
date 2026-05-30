// Helpers de aluno: wait-mode, effective user (sócio→titular).
// Porte de handlers/_shared.ts (isUserInWaitMode, resolveEffectiveUser).
import { sip } from '../db.js';
import { USER_SESSION_COLS } from './settings.js';

export interface WaitState {
  waiting: boolean;
  reason?: string;
  data_inicio?: string | null;
}

export async function isUserInWaitMode(userId: string): Promise<WaitState> {
  const { data: u } = await sip()
    .from('users')
    .select('current_ciclo_id, monitor_id, approval_status, role')
    .eq('id', userId)
    .maybeSingle();
  if (!u) return { waiting: false };
  if (u.role !== 'student') return { waiting: false };
  if (u.approval_status !== 'approved') return { waiting: false };
  if (!u.current_ciclo_id) return { waiting: true, reason: 'no_cycle' };
  const { data: c } = await sip()
    .from('ciclos')
    .select('id, status, data_inicio')
    .eq('id', u.current_ciclo_id)
    .maybeSingle();
  if (!c) return { waiting: true, reason: 'no_cycle' };
  if (c.status !== 'active') return { waiting: true, reason: 'cycle_not_active', data_inicio: c.data_inicio };
  if (c.data_inicio) {
    const today = new Date().toISOString().slice(0, 10);
    if (today < c.data_inicio) return { waiting: true, reason: 'cycle_not_started', data_inicio: c.data_inicio };
  }
  return { waiting: false };
}

/** sócio → titular; titular → ele mesmo. Devolve a row (USER_SESSION_COLS). */
export async function resolveEffectiveUser(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const { data: user } = await sip().from('users').select(USER_SESSION_COLS).eq('id', userId).maybeSingle();
  if (!user) return null;
  if (user.is_socio && user.socio_of) {
    const { data: owner } = await sip().from('users').select(USER_SESSION_COLS).eq('id', user.socio_of).maybeSingle();
    return owner || user;
  }
  return user;
}

/** Atalho: id do usuário efetivo (titular para sócio). */
export async function effectiveId(userId: string): Promise<string> {
  const eff = await resolveEffectiveUser(userId);
  return (eff?.id as string) ?? userId;
}
