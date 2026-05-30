// Sessão do usuário logado. GET /api/me — usado pelos route guards do front
// para restaurar a sessão a partir do JWT (recarga de página).
import { Router } from 'express';
import { sip } from '../db.js';
import { buildSessionUser } from '../domain/sessionUser.js';

export const sessionRouter = Router();

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
