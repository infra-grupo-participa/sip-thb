# Deploy na Hostinger — Web Apps Hosting (Git / autodetecção)

Modelo-alvo (doc `08-target-architecture.md` §6): **um único app Node**. O Express
serve o build do React (`dist/web`) **e** a API (`/api/*`) no mesmo host/porta. O
banco continua sendo o **mesmo Supabase de produção** (`mbvybujpkwuorhtdzcde`),
inalterado.

> Por que a estrutura é um app único na raiz (e não monorepo/workspaces): o
> Hostinger Web Apps **autodetecta o framework na raiz do repositório** e não
> suporta workspaces — um monorepo dá o erro *"Estrutura de projeto inválida ou
> framework não compatível"*. Aqui o `package.json` da raiz declara `express`
> como dependência → o preset detectado é **Express (Node.js)**.

## 1. Pré-requisito: repositório no GitHub

O deploy é por Git, então o código precisa estar no GitHub
(`infra-grupo-participa/sip-thb`). Faça o push da branch `main`.

## 2. Conectar no hPanel

hPanel → **Websites / Web Apps** → **Deploy / Criar aplicação** → **GitHub** →
autorizar a extensão Hostinger → selecionar o repositório `sip-thb` e a branch
`main`.

## 3. Configuração da aplicação

A autodetecção deve identificar **Express / Node.js**. Confira/ajuste:

| Campo | Valor |
|-------|-------|
| Framework preset | **Express** (Node.js). Se detectar "Vite/React", troque o preset para Express/Node.js. |
| Node.js version | 20.6+ (o ambiente usa Node 24 — ok) |
| Install command | `npm install` |
| Build command | `npm run build` |
| Start command | `npm start` |
| Entry File / Output Directory | **DEIXE EM BRANCO** |

> ⚠️ O preset **Express NÃO suporta "Entry File"** nem "Output Directory" — esses
> campos são ignorados e, se preenchidos, atrapalham o deploy. O start vem do
> `package.json` (`npm start` → `node dist/server/index.js`).
>
> `npm run build` gera `dist/web` (Vite) **e** `dist/server` (tsc). A porta vem de
> `process.env.PORT` (injetada pela Hostinger) — não fixe porta.
>
> As ferramentas de build (`vite`, `typescript`, React) ficam em **dependencies**
> (não devDependencies) de propósito: a Hostinger instala com `NODE_ENV=production`
> e pularia devDeps, quebrando o build com `vite: command not found`.

## 4. Variáveis de ambiente (painel do app)

Mínimo para subir:

| Variável | Valor |
|----------|-------|
| `NODE_ENV` | `production` |
| `SIP_JWT_SECRET` | **o mesmo** secret das Edge Functions atuais (≥32 chars) — mantém os JWTs compatíveis |
| `SUPABASE_URL` | `https://mbvybujpkwuorhtdzcde.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role do projeto Supabase |

Adicione conforme for ligando integrações (Fases 3+): `RESEND_API_KEY`,
`CLICKUP_TOKEN`, `CLICKUP_RETRY_SECRET`, `IG_COLLECT_SECRET`, `META_APP_ID`,
`META_APP_SECRET`, `META_REDIRECT_URI`, `SIP_APP_URL`.

> ⚠️ Em produção (`NODE_ENV=production`) o boot **falha** sem `SIP_JWT_SECRET`,
> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` — comportamento intencional
> (validado: o server recusa subir sem eles).

## 5. Deploy e validação

Deploy (a Hostinger faz install → build → start). Depois:

```sh
# servidor + banco vivos:
curl -s https://SEU-DOMINIO/api/health
#  → {"ok":true,"db_configured":true,"db":"ok", ...}

# SPA servida:
curl -s -o /dev/null -w "%{http_code}\n" https://SEU-DOMINIO/   # 200
```

Se `db` vier `erro`, confira `SUPABASE_*`. Se o app não sobe, veja os logs de
build/runtime no painel. Pushes futuros na `main` re-disparam o deploy.

## 6. Migrations / banco

**Nada muda aqui:** continuam via Supabase CLI (`npx supabase@latest db push`)
contra `mbvybujpkwuorhtdzcde`. Esta fundação só **lê** o banco (health-check);
cron (`node-cron`) e writes entram nas Fases 3+ — e devem rodar em **uma só** stack.

## 7. Coexistência com a stack atual (Strangler Fig)

Enquanto o frontend/Edge Functions antigos seguem em produção em
`sip.grupoparticipa.app.br`, suba **esta** stack num subdomínio de staging
(ex.: `novo.sip.grupoparticipa.app.br`) apontando para o mesmo banco, **sem cron
e em leitura**, até a paridade ficar verde (doc `09-migration-plan.md`). O cutover
de DNS é a Fase 6.
