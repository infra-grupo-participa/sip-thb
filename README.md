# SIP — refactor Express + React

Refatoração de stack do **SIP — Sistema de Implementação Prática** (Grupo Participa).
A stack muda (Supabase Edge Functions + JS vanilla → **Express/Node + React/Vite**);
o **produto, as regras de negócio e o banco Supabase permanecem idênticos**.

> Plano completo nos docs `sip-docs/` (00–10). Esta é a **Fase 0 — Fundação**
> (doc `09-migration-plan.md`): app compilando, server servindo o SPA, oráculo de
> domínio verde. Os ~91 endpoints e as telas entram nas Fases 1–5.

## Arquitetura (host único)

**Um único app Express** serve o build do React (`dist/web`) **e** a API (`/api/*`)
no mesmo host/porta — sem CORS cross-origin (`VITE_API_URL = /api`). É também o que
permite o deploy via **Hostinger Web Apps** (autodetecção do preset Express). O
Express é o **gateway único** do banco (service_role), mantendo a mitigação de RLS.

```
src/
├── shared/   domínio puro + tipos (TS isomórfico: server + web)
├── server/   Express  → build em dist/server (tsc)
└── web/      React + Vite → build em dist/web (servido pelo Express)
vite.config.ts        build do front (root = src/web → dist/web)
tsconfig.server.json  build do server (NodeNext → dist/server)
vitest.config.ts      oráculo de domínio
```

## Pré-requisitos

- Node.js **>= 20.6** (usamos `node --env-file`); npm 10+.

## Setup local

```sh
npm install
cp .env.example .env       # Windows: copy .env.example .env
#   preencha SIP_JWT_SECRET (>=32 chars) e, p/ o banco, SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

# dev (2 terminais):
npm run dev:server         # Express em http://localhost:3000 (carrega .env)
npm run dev:web            # Vite  em http://localhost:5173 (proxy /api → :3000)
```

Abra http://localhost:5173 — a tela inicial mostra o status do servidor/banco
consumindo `GET /api/health`.

## Build, testes e produção

```sh
npm run build      # build:web (vite → dist/web) + build:server (tsc → dist/server)
npm test           # oráculo de domínio (Vitest)
npm start          # node dist/server/index.js — serve dist/web + /api (igual à Hostinger)
```

## Deploy na Hostinger

Ver [DEPLOY.md](./DEPLOY.md) (fluxo Git / Web Apps Hosting).

## Variáveis de ambiente

Ver [.env.example](./.env.example). `SIP_JWT_SECRET` é boot-guard (server recusa
subir sem ele, ou com < 32 chars). Em produção, `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
também são exigidos no boot. `SUPABASE_SERVICE_ROLE_KEY` **bypassa RLS** — só no
servidor, nunca no frontend.
