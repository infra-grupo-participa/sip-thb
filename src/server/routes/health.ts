// Health-check da fundação. Serve para validar o deploy na Hostinger:
// confirma que o processo Node subiu, o boot-guard passou e (opcionalmente)
// que o banco responde.
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { hasDb, hasJwt, env, CONFIG_ERRORS } from '../env.js';
import { sip } from '../db.js';

export const healthRouter = Router();

// Marcador de build — confirma QUAL deploy está servindo. Bump a cada deploy
// de diagnóstico.
const BUILD = 'projref-1';

// Ref do projeto Supabase a partir da URL (https://<ref>.supabase.co).
function urlRef(): string {
  const m = env.SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1]! : env.SUPABASE_URL || 'none';
}
// Ref embutido na chave service_role (claim ref do JWT).
function keyRef(): string {
  const parts = env.SUPABASE_SERVICE_ROLE_KEY.split('.');
  if (parts.length === 3) {
    try {
      return String(JSON.parse(Buffer.from(parts[1]!, 'base64').toString('utf8')).ref ?? '?');
    } catch {
      return 'jwt-invalido';
    }
  }
  return 'n/a';
}

// Decodifica o "role" da chave Supabase (sem expor o segredo). Chaves legadas
// são JWT com claim role (anon|service_role); chaves novas começam com
// sb_publishable_ / sb_secret_. Serve para detectar se setaram a chave errada
// (anon/publishable não bypassa RLS → login não acha usuários → 401).
function supabaseKeyRole(): string {
  const k = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) return 'none';
  if (k.startsWith('sb_publishable_')) return 'publishable(ERRADA)';
  if (k.startsWith('sb_secret_')) return 'secret';
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64').toString('utf8'));
      return String(payload.role ?? 'jwt?');
    } catch {
      return 'jwt-invalido';
    }
  }
  return 'desconhecida';
}

// Impressão digital do segredo (8 hex do sha256). NÃO revela o segredo, mas
// permite detectar se duas instâncias estão com SIP_JWT_SECRET diferentes
// (fingerprints distintos entre acessos = secret divergente entre réplicas).
function jwtFingerprint(): string {
  if (!hasJwt) return 'none';
  return createHash('sha256').update(env.SIP_JWT_SECRET).digest('hex').slice(0, 8);
}

healthRouter.get('/health', async (_req, res) => {
  const out: Record<string, unknown> = {
    ok: true,
    service: 'sip-server',
    build: BUILD,
    env: env.NODE_ENV,
    db_configured: hasDb,
    jwt_configured: hasJwt,
    jwt_fingerprint: jwtFingerprint(),
    supabase_key_role: supabaseKeyRole(),
    url_ref: urlRef(),
    key_ref: keyRef(),
    pid: process.pid,
    config_errors: CONFIG_ERRORS,
  };

  if (hasDb) {
    try {
      const usersRes = await sip().from('users').select('id', { count: 'exact', head: true });
      const ciclosRes = await sip().from('ciclos').select('id', { count: 'exact', head: true });
      out.db = usersRes.error ? 'erro' : 'ok';
      out.db_users_visible = usersRes.count ?? 0;
      out.db_ciclos_visible = ciclosRes.count ?? 0;
      if (usersRes.error) out.db_error = usersRes.error.message;
      else if (ciclosRes.error) out.db_error = ciclosRes.error.message;
    } catch (e) {
      out.db = 'erro';
      out.db_error = (e as Error).message;
    }
  } else {
    out.db = 'nao-configurado';
  }

  res.json(out);
});
