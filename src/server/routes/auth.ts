// Auth — porte de sip-auth/index.ts (Fase 1). Esta entrega inicial cobre o
// /login (paridade 1:1). register/forgot/reset/change-password entram a seguir.
import { Router } from 'express';
import type { Request } from 'express';
import { sip } from '../db.js';
import { bcryptCompare } from '../auth/bcrypt.js';
import { makeJwt } from '../auth/jwt.js';
import { buildSessionUser } from '../domain/sessionUser.js';

export const authRouter = Router();

function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd.length) return fwd[0]!.split(',')[0]!.trim();
  const real = req.headers['x-real-ip'] ?? req.headers['cf-connecting-ip'];
  return typeof real === 'string' ? real : (req.ip ?? null);
}

// POST /api/login — rate limit + bcrypt + JWT HS256 (claims id/email/role/
// ciclo_type/monitor_id) + auditoria. Mesmos status/mensagens do legado.
authRouter.post('/login', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : undefined;
    const password = typeof body.password === 'string' ? body.password : undefined;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const ip = clientIp(req);

    const { data: canTry } = await sip().rpc('check_login_rate_limit', {
      p_email: cleanEmail,
      p_ip: ip,
    });
    if (canTry === false) {
      return res
        .status(429)
        .json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
    }

    const { data: user } = await sip()
      .from('users')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (!user) {
      await sip().rpc('record_login_attempt', { p_email: cleanEmail, p_ip: ip, p_success: false });
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const valid = await bcryptCompare(password, user.password_hash as string);
    if (!valid) {
      await sip().rpc('record_login_attempt', { p_email: cleanEmail, p_ip: ip, p_success: false });
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    if (user.role === 'student' && user.approval_status === 'rejected') {
      return res
        .status(403)
        .json({ error: 'Seu cadastro não foi aprovado. Entre em contato com o suporte.' });
    }

    await sip().rpc('record_login_attempt', { p_email: cleanEmail, p_ip: ip, p_success: true });

    try {
      await sip().rpc('log_audit_event', {
        p_actor: user.id,
        p_action: 'LOGIN',
        p_table: 'users',
        p_target_id: user.id,
        p_diff: { ip, ua: req.headers['user-agent'] ?? null },
      });
    } catch (e) {
      console.error('[audit login]', e);
    }

    let sessionUser;
    try {
      sessionUser = await buildSessionUser(user);
    } catch (e) {
      if ((e as { ownerInactive?: boolean }).ownerInactive) {
        return res
          .status(403)
          .json({ error: 'O titular desta conta não está mais ativo no sistema' });
      }
      throw e;
    }

    const token = makeJwt({
      id: user.id as string,
      email: user.email as string,
      role: user.role as 'admin' | 'monitor' | 'student',
      ciclo_type: (user.ciclo_type as 'aurum' | 'seminario' | null) ?? null,
      monitor_id: (user.monitor_id as string) ?? null,
    });

    return res.json({ token, user: sessionUser });
  } catch (err) {
    next(err);
  }
});
