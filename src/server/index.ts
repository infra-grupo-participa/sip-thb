// Bootstrap do servidor SIP (doc 08 §3A.8).
// Em produção o Express serve o build do React (dist/web) e a API no MESMO
// host/porta — sem CORS cross-origin e com VITE_API_URL = /api.
//
// Carrega .env (se existir no app root) ANTES de qualquer leitura de env.
// Útil na Hostinger: basta colocar um .env no servidor (Gerenciador de
// Arquivos/SSH) sem precisar do painel de variáveis. process.env do painel
// continua tendo prioridade (dotenv não sobrescreve var já definida).
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { env, hasDb, CONFIG_ERRORS } from './env.js';
import { requireAuth } from './middleware/requireAuth.js';
import { adminGate, monitorGate } from './middleware/roleGate.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.js';
import { publicRouter } from './routes/public.js';
import { authRouter } from './routes/auth.js';
import { registerRouter } from './routes/register.js';
import { sessionRouter } from './routes/session.js';
import { studentRouter } from './routes/student.js';
import { studentWriteRouter } from './routes/studentWrite.js';
import { contentRouter } from './routes/content.js';
import { studentExtraRouter } from './routes/studentExtra.js';
import { chamadosRouter } from './routes/chamados.js';
import { monitorRouter } from './routes/monitor.js';
import { adminRaioxRouter } from './routes/adminRaiox.js';
import { adminStudentsRouter } from './routes/adminStudents.js';
import { adminScheduleRouter } from './routes/adminSchedule.js';
import { adminConfigRouter } from './routes/adminConfig.js';
import { adminRouter } from './routes/admin.js';
import { igPublicRouter, igRouter, igAdminRouter } from './routes/ig.js';
import { registerCron } from './cron/index.js';

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
app.use('/api', authRouter); // POST /api/login
app.use('/api', registerRouter); // PÚBLICO: /register, /register/pre, /verify-email-code, /resend-verification, /public/raiox-questions, /invite/:token (GET/accept)
app.use('/api', igPublicRouter); // PÚBLICO: GET /ig/callback (state=JWT validado no handler)

// ── 2) A partir daqui exige Bearer válido ───────────────────────────────────
app.use('/api', requireAuth);
app.use('/api', sessionRouter); // GET /api/me
app.use('/api', studentRouter); // /api/my-progress, /api/me/* (leitura — Fase 2)
app.use('/api', studentWriteRouter); // escritas do aluno (Fase 3)
app.use('/api', contentRouter); // posts/tráfego (Fase 3b)
app.use('/api', studentExtraRouter); // sessão, SDB, onboarding, raiox, convite (Fase 3c)
app.use('/api', chamadosRouter); // inbox/threads (visibilidade por papel validada nos handlers)
app.use('/api', igRouter); // /me/ig/connect|status|metrics|collect (autenticado)

// Portal do monitor (role monitor|admin) — gate de prefixo em /api/monitor.
app.use('/api/monitor', monitorGate);
app.use('/api', monitorRouter); // GET /monitor/students, /monitor/students/:id/full, /monitor/reports

// Gate de role admin antes dos routers admin (auditoria 2026-05-19).
app.use('/api/admin', adminGate);
// PRECEDÊNCIA: routers admin específicos ANTES do router genérico (admin.ts),
// para que /admin/students/:id/* e a versão enriquecida de /admin/ciclos vençam.
app.use('/api', igAdminRouter); // /admin/ig/collect-all|cohort, /admin/students/:id/ig-metrics (vence o roster genérico)
app.use('/api', adminRaioxRouter); // /admin/raiox-*, /admin/students/:id/raiox
app.use('/api', adminStudentsRouter); // /admin/students/:id/full|posts|traffic|proofs|schedule|assignment|monitor|:id
app.use('/api', adminScheduleRouter); // /admin/ciclo-templates, /admin/schedule-preview, /admin/students/:id/schedule
app.use('/api', adminConfigRouter); // /admin/stages|tasks|ciclos(enriquecido)|posts|traffic|reports|clickup
app.use('/api', adminRouter); // admin genérico: dashboard, aprovações, monitores, settings, ciclos(simples), roster (Fase 4)

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
    // Agendador interno (node-cron): ig-collect, clickup-retry, cleanup. Uma vez.
    try {
      registerCron();
    } catch (err) {
      console.error('[sip] falha ao registrar cron', err);
    }
  })
  .on('error', (err) => {
    console.error('[sip] falha ao escutar na porta', env.PORT, err);
    process.exit(1);
  });

export { app };
