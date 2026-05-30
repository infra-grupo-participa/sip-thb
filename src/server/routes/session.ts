// Sessão do usuário logado. GET /api/me — usado pelos route guards do front
// para restaurar a sessão a partir do JWT (recarga de página).
import { Router } from 'express';
import { sip } from '../db.js';
import { buildSessionUser } from '../domain/sessionUser.js';
import { bcryptCompare, bcryptHash } from '../auth/bcrypt.js';
import { passwordStrengthError } from '../auth/password.js';

export const sessionRouter = Router();

// ── POST /change-password (autenticado) ────────────────────────────────────────
sessionRouter.post('/change-password', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { current_password?: string; new_password?: string };
    const current_password = typeof body.current_password === 'string' ? body.current_password : undefined;
    const new_password = typeof body.new_password === 'string' ? body.new_password : undefined;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Senha atual e nova são obrigatórias.' });
    }
    const pwdErr = passwordStrengthError(new_password);
    if (pwdErr) return res.status(400).json({ error: pwdErr });

    const { data: user } = await sip().from('users').select('id, password_hash').eq('id', req.user!.id).maybeSingle();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const valid = await bcryptCompare(current_password, user.password_hash as string);
    if (!valid) return res.status(401).json({ error: 'Senha atual incorreta.' });
    if (await bcryptCompare(new_password, user.password_hash as string)) {
      return res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
    }
    const new_hash = await bcryptHash(new_password);
    const { error: updateError } = await sip()
      .from('users')
      .update({ password_hash: new_hash, must_change_password: false, password_changed_at: new Date().toISOString() })
      .eq('id', req.user!.id);
    if (updateError) return res.status(500).json({ error: 'Erro ao atualizar senha.' });
    try {
      await sip().rpc('log_audit_event', { p_actor: req.user!.id, p_action: 'PASSWORD_CHANGE', p_table: 'users', p_target_id: req.user!.id, p_diff: null });
    } catch (e) {
      console.error('[audit password_change]', e);
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

sessionRouter.get('/me', async (req, res, next) => {
  try {
    const { data: user } = await sip()
      .from('users')
      .select('*')
      .eq('id', req.user!.id)
      .maybeSingle();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    try {
      const sessionUser = await buildSessionUser(user);
      return res.json(sessionUser);
    } catch (e) {
      if ((e as { ownerInactive?: boolean }).ownerInactive) {
        return res
          .status(403)
          .json({ error: 'O titular desta conta não está mais ativo no sistema' });
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});
