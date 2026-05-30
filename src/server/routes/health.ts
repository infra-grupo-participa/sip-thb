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
const BUILD = 'jwtfp-1';

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
    pid: process.pid,
    config_errors: CONFIG_ERRORS,
  };

  if (hasDb) {
    try {
      // Ping leve no schema sip — não depende de dado específico.
      const { error } = await sip().from('users').select('id', { count: 'exact', head: true }).limit(1);
      out.db = error ? 'erro' : 'ok';
      if (error) out.db_error = error.message;
    } catch (e) {
      out.db = 'erro';
      out.db_error = (e as Error).message;
    }
  } else {
    out.db = 'nao-configurado';
  }

  res.json(out);
});
