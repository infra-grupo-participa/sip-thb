// Cadastro/verificação PÚBLICOS (Fase auth-register) — porte fiel de
// sip-auth/index.ts (/register, /register/pre) + sip-api/index.ts (rotas
// públicas: /public/raiox-questions, /invite/:token, /invite/:token/accept,
// /verify-email-code, /resend-verification).
//
// IMPORTANTE: estas rotas são PÚBLICAS — o integrador deve montar este Router
// ANTES do requireAuth. Nenhum handler aqui depende de req.user.
import { Router } from 'express';
import type { Request } from 'express';
import { sip } from '../db.js';
import { bcryptHash, bcryptCompare } from '../auth/bcrypt.js';
import { makeJwt } from '../auth/jwt.js';
import { dispatchEmail } from '../services/email.js';
import { computeRaioxScore } from '../domain/raiox.js';
import {
  EMAIL_RE,
  NAME_RE,
  passwordStrengthError,
  sanitizeText,
} from '../auth/password.js';

export const registerRouter = Router();

// ── Validators locais (porte de _shared/validators.ts) ──────────────────────────
const TURMA_AURUM_RE = /^A[1-9]$/;
const TURMA_THB_RE = /^T(?:[1-9]|[12][0-9]|3[0-8])$/;
const CITY_RE = /^[\p{L}][\p{L}\s\-'.,()]{1,80}\/\s?[A-Z]{2}$/u;

// Projeção de usuário p/ login via convite (porte de _shared.ts:USER_AUTH_COLS).
const USER_AUTH_COLS =
  'id, name, email, role, ciclo_type, current_ciclo_id, monitor_id, password_hash, must_change_password, is_socio, socio_of, onboarding_done, approval_status';

// Gera código OTP de 6 dígitos numéricos (100000-999999) usando RNG criptográfico.
// Retorna o código em claro (vai pro email) — chamadores devem hashear antes de salvar.
function generateVerificationCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + ((buf[0] ?? 0) % 900000));
}

// IP do cliente (x-forwarded-for / fallbacks). Express já popula req.ip, mas
// preservamos a mesma lógica de extração do legado para paridade do rate-limit.
function clientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd.length) return fwd[0]!.split(',')[0]!.trim();
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real) return real;
  return req.ip ?? null;
}

type RegisterClean = {
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  password: string;
  interesse_ciclo: string;
  profissao: string | null;
  turma_aurum: string | null;
  turma_thb: string | null;
};

function validateRegisterInput(
  b: Record<string, unknown>,
): { error?: string; clean?: RegisterClean } {
  // Tipos básicos
  if (
    typeof b.name !== 'string' ||
    typeof b.email !== 'string' ||
    typeof b.password !== 'string' ||
    typeof b.interesse_ciclo !== 'string'
  ) {
    return { error: 'Campos obrigatórios faltando ou inválidos.' };
  }

  const name = sanitizeText(b.name, 100);
  const email = sanitizeText(b.email, 120).toLowerCase();
  const phoneRaw = sanitizeText(b.phone ?? '', 24);
  const cityRaw = sanitizeText(b.city ?? '', 80);
  const profissaoRaw = sanitizeText(b.profissao ?? '', 80);
  const turmaRaw = sanitizeText(b.turma_aurum ?? '', 8).toUpperCase();
  const turmaThbRaw = sanitizeText(b.turma_thb ?? '', 8).toUpperCase();
  const password = b.password;

  // Nome
  if (name.length < 3) return { error: 'Nome muito curto.' };
  if (!name.includes(' ')) return { error: 'Informe nome e sobrenome.' };
  if (!NAME_RE.test(name)) return { error: 'Nome contém caracteres inválidos.' };

  // Email
  if (!EMAIL_RE.test(email)) return { error: 'E-mail inválido.' };

  // Phone (opcional)
  let phone: string | null = null;
  if (phoneRaw) {
    const digits = phoneRaw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11)
      return { error: 'Telefone deve ter 10 ou 11 dígitos.' };
    phone =
      digits.length === 11
        ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
        : `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  // City (opcional)
  let city: string | null = null;
  if (cityRaw) {
    if (!CITY_RE.test(cityRaw)) return { error: 'Cidade deve estar no formato: Cidade / UF' };
    city = cityRaw.replace(/\/\s*([a-zA-Z]{2})\s*$/, (_m, uf: string) => '/ ' + uf.toUpperCase());
  }

  // Senha
  const pwdErr = passwordStrengthError(password);
  if (pwdErr) return { error: pwdErr };

  // Modelo de interesse (palestra=Aurum, seminario=Diamante) — admin confirma depois
  if (!['palestra', 'seminario'].includes(b.interesse_ciclo)) {
    return { error: 'Modelo de interesse inválido.' };
  }

  // Profissão (opcional, livre)
  let profissao: string | null = null;
  if (profissaoRaw) {
    if (profissaoRaw.length > 80) return { error: 'Profissão muito longa.' };
    if (!/^[\p{L}][\p{L}\s.'\-/()]{0,79}$/u.test(profissaoRaw)) {
      return { error: 'Profissão contém caracteres inválidos.' };
    }
    profissao = profissaoRaw;
  }

  let turma_thb: string | null = null;
  if (!turmaThbRaw) return { error: 'Selecione sua turma THB.' };
  if (!TURMA_THB_RE.test(turmaThbRaw)) {
    return { error: 'Turma THB inválida (use T1 a T38).' };
  }
  turma_thb = turmaThbRaw;

  let turma_aurum: string | null = null;
  if (turmaRaw) {
    if (!TURMA_AURUM_RE.test(turmaRaw)) {
      return { error: 'Turma Aurum inválida (use A1 a A9).' };
    }
    turma_aurum = turmaRaw;
  }

  return {
    clean: {
      name,
      email,
      phone,
      city,
      password,
      interesse_ciclo: b.interesse_ciclo,
      profissao,
      turma_aurum,
      turma_thb,
    },
  };
}

// ── POST /register ───────────────────────────────────────────────────────────
registerRouter.post('/register', async (req, res, next) => {
  try {
    // Rate limit no /register: reaproveita check_login_rate_limit por IP.
    // Limita criação em massa a partir de um mesmo IP.
    const ip = clientIp(req);
    if (ip) {
      const { data: canTry } = await sip().rpc('check_login_rate_limit', {
        p_email: `__register__@${ip}`,
        p_ip: ip,
      });
      if (canTry === false) {
        return res.status(429).json({ error: 'Muitas tentativas de cadastro. Aguarde 15 minutos.' });
      }
    }

    // Limita tamanho do body (proteção DoS)
    const raw = JSON.stringify(req.body ?? {});
    if (raw.length > 64 * 1024) return res.status(413).json({ error: 'Payload muito grande.' });
    const body: Record<string, unknown> =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const result = validateRegisterInput(body);
    if (result.error) {
      if (ip)
        await sip().rpc('record_login_attempt', {
          p_email: `__register__@${ip}`,
          p_ip: ip,
          p_success: false,
        });
      return res.status(400).json({ error: result.error });
    }
    const { name, email, phone, city, password, interesse_ciclo, profissao, turma_aurum, turma_thb } =
      result.clean!;
    const raiox_answers = body.raiox_answers;

    const { data: existing } = await sip()
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      // Se já existe e está verificado, aceitar o Raio-X (fluxo novo: pré-cadastro → verificação → raio-x)
      const existingFull = await sip()
        .from('users')
        .select('id, email_verified, password_hash, approval_status')
        .eq('email', email)
        .maybeSingle();
      if (existingFull.data?.email_verified) {
        // Verificar senha bate com o pré-cadastro
        const pwOk = await bcryptCompare(password, existingFull.data.password_hash);
        if (!pwOk) {
          if (ip)
            await sip().rpc('record_login_attempt', {
              p_email: `__register__@${ip}`,
              p_ip: ip,
              p_success: false,
            });
          return res.status(409).json({ error: 'Este e-mail já está cadastrado. Faça login.' });
        }
        // Só aceitar Raio-X se ainda pending (não foi aprovado)
        if (existingFull.data.approval_status !== 'pending') {
          return res.status(409).json({ error: 'Este e-mail já possui cadastro completo.' });
        }
        // Atualizar com Raio-X — reutilizar userId existente
        const userId = existingFull.data.id;
        let raiox_score: number | null = null;
        let raiox_max_score: number | null = null;
        let raiox_answers_clean: Record<string, unknown> | null = null;
        let raiox_submitted_at: string | null = null;
        if (raiox_answers && typeof raiox_answers === 'object' && !Array.isArray(raiox_answers)) {
          const answersObj = raiox_answers as Record<string, unknown>;
          if (Object.keys(answersObj).length <= 100) {
            const { data: questions } = await sip()
              .from('raiox_questions')
              .select('id, tipo, peso')
              .eq('active', true);
            const r = computeRaioxScore(answersObj, questions || [], sanitizeText);
            raiox_score = r.total;
            raiox_max_score = r.max;
            raiox_answers_clean = r.cleaned;
            raiox_submitted_at = new Date().toISOString();
          }
        }
        await sip()
          .from('users')
          .update({ raiox_answers: raiox_answers_clean, raiox_score, raiox_max_score, raiox_submitted_at })
          .eq('id', userId);
        const { data: updatedUser } = await sip()
          .from('users')
          .select('id, name, email, role, interesse_ciclo')
          .eq('id', userId)
          .maybeSingle();
        if (!updatedUser) return res.status(500).json({ error: 'Erro ao completar cadastro.' });
        const token = makeJwt({
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role,
          ciclo_type: null,
          monitor_id: null,
        });
        if (ip)
          await sip().rpc('record_login_attempt', {
            p_email: `__register__@${ip}`,
            p_ip: ip,
            p_success: true,
          });
        return res.status(201).json({
          token,
          user: {
            id: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email,
            role: updatedUser.role,
            ciclo_type: null,
            interesse_ciclo: updatedUser.interesse_ciclo,
            onboarding_done: false,
            monitor_id: null,
            monitor_name: null,
            is_socio: false,
            socio_of: null,
            owner_name: null,
            approval_status: 'pending',
          },
        });
      }
      if (ip)
        await sip().rpc('record_login_attempt', {
          p_email: `__register__@${ip}`,
          p_ip: ip,
          p_success: false,
        });
      return res
        .status(409)
        .json({ error: 'Este e-mail já está em uso. Verifique seu e-mail antes de continuar.' });
    }

    const password_hash = await bcryptHash(password);

    // Não atribuímos ciclo nem ciclo_id aqui — admin define na aprovação
    // (interesse_ciclo é só pista; ciclo_type fica null até aprovação)

    // Calcular Raio-X (se enviado) — com limite anti-DoS
    let raiox_score: number | null = null;
    let raiox_max_score: number | null = null;
    let raiox_answers_clean: Record<string, unknown> | null = null;
    let raiox_submitted_at: string | null = null;

    if (raiox_answers && typeof raiox_answers === 'object' && !Array.isArray(raiox_answers)) {
      const answersObj = raiox_answers as Record<string, unknown>;
      const keys = Object.keys(answersObj);
      if (keys.length > 100) return res.status(400).json({ error: 'Raio-X com payload acima do permitido.' });

      const { data: questions } = await sip()
        .from('raiox_questions')
        .select('id, tipo, peso')
        .eq('active', true);

      const r = computeRaioxScore(answersObj, questions || [], sanitizeText);
      raiox_score = r.total;
      raiox_max_score = r.max;
      raiox_answers_clean = r.cleaned;
      raiox_submitted_at = new Date().toISOString();
    }

    const { data: newUser, error: insertError } = await sip()
      .from('users')
      .insert({
        name,
        email,
        password_hash,
        role: 'student',
        ciclo_type: null, // admin define na aprovação
        current_ciclo_id: null,
        interesse_ciclo, // pista do aluno
        monitor_id: null,
        onboarding_done: false,
        phone,
        city,
        profissao,
        turma_aurum,
        turma_thb,
        self_registered: true,
        approval_status: 'pending',
        raiox_answers: raiox_answers_clean,
        raiox_score,
        raiox_max_score,
        raiox_submitted_at,
      })
      .select()
      .single();

    if (insertError || !newUser) return res.status(500).json({ error: 'Erro ao criar conta.' });

    // Gerar código OTP de 6 dígitos, salvar hash bcrypt, mandar código em claro por email
    const verificationCode = generateVerificationCode();
    const verificationCodeHash = await bcryptHash(verificationCode);
    const nowIso = new Date().toISOString();
    await sip()
      .from('users')
      .update({
        email_verification_code_hash: verificationCodeHash,
        email_verification_sent_at: nowIso,
        email_verification_attempts: 0,
        email_verified: false,
      })
      .eq('id', newUser.id);

    // Disparar email de verificação fire-and-forget
    void dispatchEmail('verificacao_email', {
      to: newUser.email,
      nome: newUser.name,
      code: verificationCode,
    });

    // Registra sucesso para auditoria do rate limit
    if (ip)
      await sip().rpc('record_login_attempt', {
        p_email: `__register__@${ip}`,
        p_ip: ip,
        p_success: true,
      });

    const token = makeJwt({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
      ciclo_type: null,
      monitor_id: null,
    });

    return res.status(201).json({
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        ciclo_type: null,
        interesse_ciclo: newUser.interesse_ciclo,
        onboarding_done: false,
        monitor_id: null,
        monitor_name: null,
        is_socio: false,
        socio_of: null,
        owner_name: null,
        approval_status: 'pending',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /register/pre — pré-cadastro (dados básicos, sem Raio-X) ──────────────
// Cria conta com email_verified=false e envia email de confirmação.
// Idempotente: se email já existe e não verificado, reenvia o token.
registerRouter.post('/register/pre', async (req, res, next) => {
  try {
    const ip = clientIp(req);
    if (ip) {
      const { data: canTry } = await sip().rpc('check_login_rate_limit', {
        p_email: `__register__@${ip}`,
        p_ip: ip,
      });
      if (canTry === false) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
    }
    const raw = JSON.stringify(req.body ?? {});
    if (raw.length > 64 * 1024) return res.status(413).json({ error: 'Payload muito grande.' });
    const body: Record<string, unknown> =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const result = validateRegisterInput(body);
    if (result.error) return res.status(400).json({ error: result.error });
    const { name, email, password, phone, city, interesse_ciclo, profissao, turma_aurum, turma_thb } =
      result.clean!;

    // Verificar se email já existe
    const { data: existing } = await sip()
      .from('users')
      .select('id, email_verified, email_verification_sent_at')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      if (existing.email_verified) {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado e verificado. Faça login.' });
      }
      // Já existe mas não verificado: reenviar código (cooldown 60s)
      const sentAt = existing.email_verification_sent_at
        ? new Date(existing.email_verification_sent_at)
        : null;
      if (!sentAt || Date.now() - sentAt.getTime() > 60 * 1000) {
        const code = generateVerificationCode();
        const codeHash = await bcryptHash(code);
        await sip()
          .from('users')
          .update({
            email_verification_code_hash: codeHash,
            email_verification_sent_at: new Date().toISOString(),
            email_verification_attempts: 0,
          })
          .eq('id', existing.id);
        void dispatchEmail('verificacao_email', { to: email, nome: name, code });
      }
      return res.status(200).json({ success: true, resent: true });
    }

    const password_hash = await bcryptHash(password);
    const { data: newUser, error: insertError } = await sip()
      .from('users')
      .insert({
        name,
        email,
        password_hash,
        role: 'student',
        ciclo_type: null,
        current_ciclo_id: null,
        interesse_ciclo,
        monitor_id: null,
        onboarding_done: false,
        phone,
        city,
        profissao,
        turma_aurum,
        turma_thb,
        self_registered: true,
        approval_status: 'pending',
        email_verified: false,
      })
      .select('id, name, email')
      .single();
    if (insertError || !newUser) return res.status(500).json({ error: 'Erro ao criar conta.' });

    const code = generateVerificationCode();
    const codeHash = await bcryptHash(code);
    await sip()
      .from('users')
      .update({
        email_verification_code_hash: codeHash,
        email_verification_sent_at: new Date().toISOString(),
        email_verification_attempts: 0,
      })
      .eq('id', newUser.id);
    void dispatchEmail('verificacao_email', { to: newUser.email, nome: newUser.name, code });

    if (ip)
      await sip().rpc('record_login_attempt', {
        p_email: `__register__@${ip}`,
        p_ip: ip,
        p_success: true,
      });
    return res.status(201).json({ success: true, user: { id: newUser.id } });
  } catch (err) {
    next(err);
  }
});

// ── GET /public/raiox-questions ───────────────────────────────────────────────
registerRouter.get('/public/raiox-questions', async (req, res, next) => {
  try {
    const ciclo = typeof req.query.ciclo === 'string' ? req.query.ciclo : null; // 'palestra' | 'seminario' | null
    let q = sip()
      .from('raiox_questions')
      .select('id, ordem, categoria, pergunta, tipo, opcoes, peso, depends_on, depends_value, input_kind, hint')
      .eq('active', true)
      .order('ordem', { ascending: true });
    if (ciclo === 'palestra' || ciclo === 'seminario') {
      q = q.or(`ciclo_filter.is.null,ciclo_filter.eq.${ciclo}`);
    }
    const { data: questions } = await q;
    return res.json(questions || []);
  } catch (err) {
    next(err);
  }
});

// ── GET /invite/:token ────────────────────────────────────────────────────────
registerRouter.get('/invite/:token', async (req, res, next) => {
  try {
    const { data: invite } = await sip()
      .from('invites')
      .select('*')
      .eq('token', req.params.token)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: 'Convite não encontrado' });
    if (invite.used) return res.status(410).json({ error: 'Este convite já foi utilizado' });
    if (new Date(invite.expires_at) < new Date())
      return res.status(410).json({ error: 'Este convite expirou' });
    return res.json({
      valid: true,
      owner_name: invite.owner_name,
      ciclo_type: invite.ciclo_type,
      expires_at: invite.expires_at,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /invite/:token/accept ────────────────────────────────────────────────
registerRouter.post('/invite/:token/accept', async (req, res, next) => {
  try {
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const mode = typeof body.mode === 'string' ? body.mode : undefined;
    const name = typeof body.name === 'string' ? body.name : undefined;
    const email = typeof body.email === 'string' ? body.email : undefined;
    const password = typeof body.password === 'string' ? body.password : undefined;
    const invToken = req.params.token;

    const { data: invite } = await sip()
      .from('invites')
      .select('*')
      .eq('token', invToken)
      .maybeSingle();
    if (!invite || invite.used || new Date(invite.expires_at) < new Date())
      return res.status(410).json({ error: 'Convite inválido ou expirado' });
    if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

    let finalUser: Record<string, unknown>;
    if (mode === 'login') {
      const { data: u } = await sip()
        .from('users')
        .select(USER_AUTH_COLS)
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();
      if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
      const ok = await bcryptCompare(password, u.password_hash);
      if (!ok) return res.status(401).json({ error: 'Senha incorreta' });
      finalUser = u;
    } else {
      if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
      const { data: existing } = await sip()
        .from('users')
        .select('id')
        .eq('email', email.toLowerCase().trim())
        .maybeSingle();
      if (existing) return res.status(409).json({ error: 'Este e-mail já está em uso' });
      const password_hash = await bcryptHash(password);
      const { data: owner } = await sip()
        .from('users')
        .select('current_ciclo_id, monitor_id')
        .eq('id', invite.owner_id)
        .maybeSingle();
      const { data: newUser } = await sip()
        .from('users')
        .insert({
          name: String(name).trim(),
          email: email.toLowerCase().trim(),
          password_hash,
          role: 'student',
          ciclo_type: invite.ciclo_type,
          current_ciclo_id: owner?.current_ciclo_id ?? null,
          monitor_id: owner?.monitor_id ?? null,
          onboarding_done: false,
          is_socio: true,
          socio_of: invite.owner_id,
        })
        .select()
        .single();
      finalUser = newUser as Record<string, unknown>;
    }

    await sip()
      .from('invites')
      .update({ used: true, used_by: finalUser.id, used_at: new Date().toISOString() })
      .eq('token', invToken);
    const jwtToken = makeJwt({
      id: finalUser.id as string,
      email: finalUser.email as string,
      role: finalUser.role as 'admin' | 'monitor' | 'student',
      ciclo_type: (finalUser.ciclo_type as 'aurum' | 'seminario' | null) ?? null,
      monitor_id: (finalUser.monitor_id as string | null) ?? null,
    });
    return res.json({
      token: jwtToken,
      user: {
        id: finalUser.id,
        name: finalUser.name,
        email: finalUser.email,
        role: finalUser.role,
        ciclo_type: finalUser.ciclo_type,
        onboarding_done: finalUser.onboarding_done ?? false,
        monitor_id: finalUser.monitor_id ?? null,
        is_socio: finalUser.is_socio ?? false,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /verify-email-code ───────────────────────────────────────────────────
// Verifica código OTP de 6 dígitos enviado por email.
// - Expira em 10 min, máximo 5 tentativas erradas por código emitido.
// - bcrypt.compare em todos os casos (mesmo email inexistente) para evitar timing
//   attack que vaze enumeração de usuários.
registerRouter.post('/verify-email-code', async (req, res, next) => {
  try {
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const email = (typeof body.email === 'string' ? body.email : '').toLowerCase().trim();
    const code = (typeof body.code === 'string' ? body.code : '').trim();
    if (!email || !/^\d{6}$/.test(code))
      return res.status(400).json({ error: 'E-mail e código de 6 dígitos são obrigatórios.' });

    const { data: u } = await sip()
      .from('users')
      .select(
        'id, email_verified, email_verification_sent_at, email_verification_code_hash, email_verification_attempts',
      )
      .eq('email', email)
      .maybeSingle();

    // Hash dummy para gastar tempo equivalente quando user não existe ou não tem código pendente
    const DUMMY_HASH = '$2a$10$abcdefghijklmnopqrstuuS.dGxN1V2y7HA3uKZcM4zR4zL7PbI7Ce';
    if (!u || !u.email_verification_code_hash) {
      await bcryptCompare(code, DUMMY_HASH);
      return res.status(400).json({ error: 'Código inválido ou expirado.' });
    }
    if (u.email_verified) return res.json({ success: true, already: true });

    const sentAt = u.email_verification_sent_at ? new Date(u.email_verification_sent_at) : null;
    if (!sentAt || Date.now() - sentAt.getTime() > 10 * 60 * 1000) {
      await bcryptCompare(code, DUMMY_HASH);
      await sip()
        .from('users')
        .update({ email_verification_code_hash: null, email_verification_attempts: 0 })
        .eq('id', u.id);
      return res.status(410).json({ error: 'Código expirado. Solicite um novo.' });
    }

    if ((u.email_verification_attempts ?? 0) >= 5) {
      await sip()
        .from('users')
        .update({ email_verification_code_hash: null, email_verification_attempts: 0 })
        .eq('id', u.id);
      return res.status(429).json({ error: 'Muitas tentativas erradas. Solicite um novo código.' });
    }

    const ok = await bcryptCompare(code, u.email_verification_code_hash);
    if (!ok) {
      await sip()
        .from('users')
        .update({ email_verification_attempts: (u.email_verification_attempts ?? 0) + 1 })
        .eq('id', u.id);
      return res.status(400).json({ error: 'Código inválido.' });
    }

    await sip()
      .from('users')
      .update({
        email_verified: true,
        email_verified_at: new Date().toISOString(),
        email_verification_code_hash: null,
        email_verification_attempts: 0,
      })
      .eq('id', u.id);
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── POST /resend-verification ─────────────────────────────────────────────────
// Reenvia código OTP. Cooldown de 60s. Resposta uniforme {success:true} para não
// vazar se o email existe ou não.
registerRouter.post('/resend-verification', async (req, res, next) => {
  try {
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const email = typeof body.email === 'string' ? body.email : undefined;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório.' });
    const { data: u } = await sip()
      .from('users')
      .select('id, name, email, email_verified, email_verification_sent_at')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();
    if (!u || u.email_verified) return res.json({ success: true });
    const sentAt = u.email_verification_sent_at ? new Date(u.email_verification_sent_at) : null;
    if (sentAt && Date.now() - sentAt.getTime() < 60 * 1000) return res.json({ success: true });
    const code = generateVerificationCode();
    const codeHash = await bcryptHash(code);
    await sip()
      .from('users')
      .update({
        email_verification_code_hash: codeHash,
        email_verification_sent_at: new Date().toISOString(),
        email_verification_attempts: 0,
      })
      .eq('id', u.id);
    void dispatchEmail('verificacao_email', { to: u.email, nome: u.name, code });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
