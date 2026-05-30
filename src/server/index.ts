// Bootstrap do servidor SIP (doc 08 §3A.8).
// Em produção o Express serve o build do React (packages/web/dist) e a API
// no MESMO host/porta — sem CORS cross-origin e com VITE_API_URL = /api.
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { env, hasDb } from './env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { publicRouter } from './routes/public.js';

const app = express();

// CORS — mesma config do as-is (origin *, headers/métodos idênticos).
app.use(
  cors({
    origin: '*',
    allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(express.json({ limit: '256kb' }));

// ── Rotas públicas da fundação (sem Bearer) ─────────────────────────────────
// Os routers autenticados (auth, student, content, chamados, ig, admin/*,
// monitor) entram nas Fases 1-4 do plano de migração.
app.use('/api', healthRouter);
app.use('/api', publicRouter);

// 404 de API (antes do fallback do SPA, para /api/* nunca cair no index.html).
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ── SPA estática (build do Vite) ────────────────────────────────────────────
// Build do front fica em dist/web; este arquivo roda de dist/server → ../web.
const webDist = path.resolve(import.meta.dirname, '../web');
const indexHtml = path.join(webDist, 'index.html');

if (fs.existsSync(indexHtml)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => res.sendFile(indexHtml));
} else {
  // Build do front ainda não gerado — útil durante o dev só do server.
  app.get('*', (_req, res) =>
    res
      .status(200)
      .type('text/plain')
      .send('SIP server no ar. Build do front ausente (rode: npm run build:web).'),
  );
}

// Error handler global (500 padronizado).
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`[sip] server on :${env.PORT} (${env.NODE_ENV}) — db: ${hasDb ? 'configurado' : 'NÃO configurado'}`);
});

export { app };
