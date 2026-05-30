// Config + diagnóstico de boot.
//
// IMPORTANTE (decisão de operação): o boot NÃO derruba mais o processo quando
// falta env. Antes lançávamos exceção (o que, na Hostinger/Passenger, causa
// 503 e o site some). Agora o servidor SEMPRE sobe e serve o SPA; problemas de
// configuração ficam em `CONFIG_ERRORS` e são expostos em /api/health.
// Operações que dependem de um segredo ausente falham de forma controlada
// (ex.: login → 503 JSON), sem matar a aplicação inteira.

const isProd = process.env.NODE_ENV === 'production';

const configErrors: string[] = [];

const SIP_JWT_SECRET = process.env.SIP_JWT_SECRET ?? '';
if (!SIP_JWT_SECRET) {
  configErrors.push('SIP_JWT_SECRET ausente (login/JWT indisponíveis).');
} else if (SIP_JWT_SECRET.length < 32) {
  configErrors.push('SIP_JWT_SECRET com menos de 32 caracteres.');
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL) configErrors.push('SUPABASE_URL ausente (banco indisponível).');
if (!SUPABASE_SERVICE_ROLE_KEY) configErrors.push('SUPABASE_SERVICE_ROLE_KEY ausente (banco indisponível).');

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PROD: isProd,
  PORT: Number(process.env.PORT ?? 3000),

  SIP_JWT_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,

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
export const hasJwt = Boolean(env.SIP_JWT_SECRET && env.SIP_JWT_SECRET.length >= 32);
export const CONFIG_ERRORS = configErrors;
