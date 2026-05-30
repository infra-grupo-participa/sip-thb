// Auth — porte de sip-auth/index.ts (Fase 1). Esta entrega inicial cobre o
// /login (paridade 1:1). register/forgot/reset/change-password entram a seguir.
import { Router } from 'express';
import type { Request } from 'express';
import { randomInt } from 'node:crypto';
import { sip } from '../db.js';
import { bcryptCompare, bcryptHash } from '../auth/bcrypt.js';
import { makeJwt } from '../auth/jwt.js';
import { passwordStrengthError, EMAIL_RE } from '../auth/password.js';
import { buildSessionUser } from '../domain/sessionUser.js';
import { dispatchEmail } from '../services/email.js';

export const authRouter = Router();

function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd.length) return fwd[0]!.split(',')[0]!.trim();
  const real = req.headers['x-real-ip'] ?? req.headers['cf-connecting-ip'];
  return typeof real === 'string' ? real : (req.ip ?? null);
}

// Código OTP de 6 dígitos (RNG criptográfico).
function generateVerificationCode(): string {
  return String(randomInt(100000, 1000000));
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

// ── POST /forgot-password (público, anti-enumeração) ───────────────────────────
authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    if (ip) {
      const { data: canTry } = await sip().rpc('check_login_rate_limit', { p_email: `__reset__@${ip}`, p_ip: ip });
      if (canTry === false) return res.json({ ok: true });
    }
    const body = (req.body ?? {}) as { email?: string };
    const rawEmail = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    if (!rawEmail || !EMAIL_RE.test(rawEmail)) return res.json({ ok: true });

    const { data: user } = await sip()
      .from('users')
      .select('id, name, email, password_reset_sent_at')
      .eq('email', rawEmail)
      .maybeSingle();
    if (!user) {
      if (ip) await sip().rpc('record_login_attempt', { p_email: `__reset__@${ip}`, p_ip: ip, p_success: false });
      return res.json({ ok: true });
    }
    const sentAt = user.password_reset_sent_at ? new Date(user.password_reset_sent_at) : null;
    if (sentAt && Date.now() - sentAt.getTime() < 60_000) return res.json({ ok: true, cooldown: true });

    const code = generateVerificationCode();
    const codeHash = await bcryptHash(code);
    await sip()
      .from('users')
      .update({ password_reset_code_hash: codeHash, password_reset_sent_at: new Date().toISOString(), password_reset_attempts: 0 })
      .eq('id', user.id);
    void dispatchEmail('reset_senha', { to: user.email, nome: user.name, code });
    if (ip) await sip().rpc('record_login_attempt', { p_email: `__reset__@${ip}`, p_ip: ip, p_success: true });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /reset-password (público) ─────────────────────────────────────────────
authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { email?: string; code?: string; new_password?: string };
    const rawEmail = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const new_password = typeof body.new_password === 'string' ? body.new_password : '';
    if (!rawEmail || !code || !new_password) return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Código inválido.' });
    const pwdErr = passwordStrengthError(new_password);
    if (pwdErr) return res.status(400).json({ error: pwdErr });

    const { data: user } = await sip()
      .from('users')
      .select('id, password_hash, password_reset_code_hash, password_reset_sent_at, password_reset_attempts')
      .eq('email', rawEmail)
      .maybeSingle();
    if (!user || !user.password_reset_code_hash) return res.status(400).json({ error: 'Código inválido ou expirado.' });

    const sentAt = user.password_reset_sent_at ? new Date(user.password_reset_sent_at) : null;
    if (!sentAt || Date.now() - sentAt.getTime() > 10 * 60_000) {
      await sip().from('users').update({ password_reset_code_hash: null, password_reset_sent_at: null, password_reset_attempts: 0 }).eq('id', user.id);
      return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
    }
    const attempts = user.password_reset_attempts ?? 0;
    if (attempts >= 3) {
      await sip().from('users').update({ password_reset_code_hash: null, password_reset_sent_at: null, password_reset_attempts: 0 }).eq('id', user.id);
      return res.status(400).json({ error: 'Muitas tentativas. Solicite um novo código.' });
    }
    const valid = await bcryptCompare(code, user.password_reset_code_hash);
    if (!valid) {
      await sip().from('users').update({ password_reset_attempts: attempts + 1 }).eq('id', user.id);
      const remaining = 2 - attempts;
      return res.status(400).json({
        error: remaining > 0 ? `Código incorreto. ${remaining} tentativa(s) restante(s).` : 'Código incorreto. Solicite um novo.',
      });
    }
    if (user.password_hash && (await bcryptCompare(new_password, user.password_hash))) {
      return res.status(400).json({ error: 'A nova senha deve ser diferente da senha atual.' });
    }
    const new_hash = await bcryptHash(new_password);
    await sip()
      .from('users')
      .update({
        password_hash: new_hash,
        must_change_password: false,
        password_changed_at: new Date().toISOString(),
        password_reset_code_hash: null,
        password_reset_sent_at: null,
        password_reset_attempts: 0,
      })
      .eq('id', user.id);
    try {
      await sip().rpc('log_audit_event', { p_actor: user.id, p_action: 'PASSWORD_RESET', p_table: 'users', p_target_id: user.id, p_diff: null });
    } catch (e) {
      console.error('[audit password_reset]', e);
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
