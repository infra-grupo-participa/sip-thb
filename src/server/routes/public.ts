// Rotas públicas (sem Bearer). Stub inicial da fundação — os endpoints reais
// (/public/settings, /public/raiox-questions, /invite/*, /verify-email-code…)
// serão portados na Fase 1 do plano de migração (doc 09 §Fase 1).
import { Router } from 'express';

export const publicRouter = Router();

publicRouter.get('/public/ping', (_req, res) => {
  res.json({ pong: true });
});
