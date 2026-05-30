// Auditoria — porte de handlers/_shared.ts. Falha silenciosa (nunca quebra fluxo).
import { sip } from '../db.js';

export async function audit(
  actorId: string | null,
  action: string,
  table: string,
  targetId: string | null,
  diff?: Record<string, unknown>,
): Promise<void> {
  try {
    await sip().rpc('log_audit_event', {
      p_actor: actorId,
      p_action: action,
      p_table: table,
      p_target_id: targetId,
      p_diff: diff ?? null,
    });
  } catch (e) {
    console.error('[audit]', e);
  }
}
