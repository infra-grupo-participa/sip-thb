// Monta o objeto `user` devolvido por /login e /me — mesma forma do legado
// (sip-auth/index.ts). Mantém paridade de contrato com o frontend.
import { sip } from '../db.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'monitor' | 'student';
  ciclo_type: 'aurum' | 'seminario' | null;
  onboarding_done: boolean;
  monitor_id: string | null;
  monitor_name: string | null;
  is_socio: boolean;
  socio_of: string | null;
  owner_name: string | null;
  must_change_password: boolean;
  approval_status: string;
  email_verified: boolean;
  raiox_submitted_at: string | null;
}

/**
 * A partir de uma row de sip.users, resolve monitor_name e owner_name (titular
 * do sócio) e devolve o objeto de sessão. Lança { ownerInactive: true } se o
 * titular do sócio não existir mais (login devolve 403 nesse caso, como o legado).
 */
export async function buildSessionUser(
  user: Record<string, unknown>,
): Promise<SessionUser> {
  let monitor_name: string | null = null;
  if (user.monitor_id) {
    const { data: nav } = await sip()
      .from('users')
      .select('name')
      .eq('id', user.monitor_id as string)
      .maybeSingle();
    monitor_name = (nav?.name as string) ?? null;
  }

  let owner_name: string | null = null;
  if (user.is_socio && user.socio_of) {
    const { data: owner } = await sip()
      .from('users')
      .select('name')
      .eq('id', user.socio_of as string)
      .maybeSingle();
    if (!owner) {
      const err = new Error('owner-inactive') as Error & { ownerInactive?: boolean };
      err.ownerInactive = true;
      throw err;
    }
    owner_name = owner.name as string;
  }

  return {
    id: user.id as string,
    name: user.name as string,
    email: user.email as string,
    role: user.role as SessionUser['role'],
    ciclo_type: (user.ciclo_type as SessionUser['ciclo_type']) ?? null,
    onboarding_done: (user.onboarding_done as boolean) ?? false,
    monitor_id: (user.monitor_id as string) ?? null,
    monitor_name,
    is_socio: (user.is_socio as boolean) ?? false,
    socio_of: (user.socio_of as string) ?? null,
    owner_name,
    must_change_password: (user.must_change_password as boolean) ?? false,
    approval_status: (user.approval_status as string) ?? 'approved',
    email_verified: user.email_verified === true,
    raiox_submitted_at: (user.raiox_submitted_at as string) ?? null,
  };
}
