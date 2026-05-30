// Health-check da fundação. Serve para validar o deploy na Hostinger:
// confirma que o processo Node subiu, o boot-guard passou e (opcionalmente)
// que o banco responde.
import { Router } from 'express';
import { hasDb, env } from '../env.js';
import { sip } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const out: Record<string, unknown> = {
    ok: true,
    service: 'sip-server',
    env: env.NODE_ENV,
    db_configured: hasDb,
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
