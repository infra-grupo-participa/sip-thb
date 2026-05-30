// Bootstrap do servidor SIP (doc 08 §3A.8).
// Em produção o Express serve o build do React (packages/web/dist) e a API
// no MESMO host/porta — sem CORS cross-origin e com VITE_API_URL = /api.
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { env, hasDb, CONFIG_ERRORS } from './env.js';
import { requireAuth } from './middleware/requireAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { sessionRouter } from './routes/session.js';
import { studentRouter } from './routes/student.js';
import { studentWriteRouter } from './routes/studentWrite.js';

const app = express();

// Atrás do proxy da Hostinger — habilita req.ip / x-forwarded-for corretos.
app.set('trust proxy', true);

// CORS — mesma config do as-is (origin *, headers/métodos idênticos).
app.use(
  cors({
    origin: '*',
    allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(express.json({ limit: '256kb' }));

// ── 1) Rotas públicas (sem Bearer) ──────────────────────────────────────────
app.use('/api', healthRouter);
app.use('/api', publicRouter);
app.use('/api', authRouter); // POST /api/login (register/reset entram a seguir)

// ── 2) A partir daqui exige Bearer válido ───────────────────────────────────
app.use('/api', requireAuth);
app.use('/api', sessionRouter); // GET /api/me
app.use('/api', studentRouter); // /api/my-progress, /api/me/* (leitura — Fase 2)
app.use('/api', studentWriteRouter); // escritas do aluno (Fase 3)

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

if (CONFIG_ERRORS.length > 0) {
  console.error('[sip] AVISO de configuração (app sobe mesmo assim):');
  for (const e of CONFIG_ERRORS) console.error('  - ' + e);
}

app
  .listen(env.PORT, () => {
    console.log(
      `[sip] server on :${env.PORT} (${env.NODE_ENV}) — db: ${hasDb ? 'ok' : 'NÃO configurado'}, config: ${
        CONFIG_ERRORS.length === 0 ? 'ok' : CONFIG_ERRORS.length + ' problema(s)'
      }`,
    );
  })
  .on('error', (err) => {
    console.error('[sip] falha ao escutar na porta', env.PORT, err);
    process.exit(1);
  });

export { app };
