// Config + boot-guard (espelha os Deno.env.get do as-is, doc 08 §3A.2).
//
// Regra preservada: o server RECUSA subir se SIP_JWT_SECRET faltar ou tiver
// < 32 chars (as Edge Functions atuais fazem o mesmo). As vars de banco são
// obrigatórias em produção; em dev emitimos aviso e o cliente Supabase só
// falha se for efetivamente usado sem config (ver db.ts) — isso permite o
// primeiro smoke-test na Hostinger (servir o SPA + /api/health) antes de
// fiar todas as integrações.

const isProd = process.env.NODE_ENV === 'production';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} ausente — recuse boot.`);
  return v;
}

function prodReq(name: string): string {
  const v = process.env[name] ?? '';
  if (isProd && !v) throw new Error(`Env ${name} ausente em produção — recuse boot.`);
  if (!isProd && !v) console.warn(`[env] ${name} não definida (ok em dev; obrigatória em produção).`);
  return v;
}

const JWT_SECRET = req('SIP_JWT_SECRET');
if (JWT_SECRET.length < 32) {
  throw new Error('SIP_JWT_SECRET com menos de 32 caracteres — recuse boot.');
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PROD: isProd,
  PORT: Number(process.env.PORT ?? 3000),

  SIP_JWT_SECRET: JWT_SECRET,
  SUPABASE_URL: prodReq('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: prodReq('SUPABASE_SERVICE_ROLE_KEY'),

  // Integrações — necessárias só quando o respectivo serviço for ligado.
  CLICKUP_TOKEN: process.env.CLICKUP_TOKEN ?? '',
  CLICKUP_RETRY_SECRET: process.env.CLICKUP_RETRY_SECRET ?? '',
  IG_COLLECT_SECRET: process.env.IG_COLLECT_SECRET ?? '',
  META_APP_ID: process.env.META_APP_ID ?? '',
  META_APP_SECRET: process.env.META_APP_SECRET ?? '',
  META_REDIRECT_URI: process.env.META_REDIRECT_URI ?? '',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  SIP_APP_URL: process.env.SIP_APP_URL ?? '',
} as const;

export const hasDb = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
