# SIP — Estado da migração (sip-system → Express + React)

Replicação do sistema legado **SIP / Time Holding Brasil** para a nova stack, **reusando o mesmo banco Supabase** (`mbvybujpkwuorhtdzcde`). Mesmo visual (CSS legado verbatim), mesma lógica (contratos reconciliados com o legado como fonte da verdade).

## ✅ Operante (validado em produção, nos 3 níveis)

- **Aluno** — trilha/checklist com gating, conclusão de tarefa → progresso/gamificação, visão geral (ciclo/fase/datas), gamificação (XP/nível/streak/badges), calendário, histórico, perfil, **posts**, **tráfego** (form/KPIs/distribuição/WhatsApp), **SuperDebriefing**, sócio, chamados (thread por polling).
- **Admin** — 13 abas (Dashboard, Alunos, Aprovações, Monitores, Raio‑X, Templates, Conteúdo, Mensagens, Postagens, Tráfego, Instagram, Histórico, ClickUp, Chamados) + **modal do aluno editável** (planejamento/atribuição, cronograma+preview, aprovação de comprovações).
- **Monitor** — alunos acompanhados, ficha read‑only, resumo, chamados, mudança de data.
- **Auth** — login, recuperação de senha (3 passos), cadastro + Raio‑X (multi‑etapa), convite de sócio, trocar senha; **gate de fluxo** (must_change_password, e‑mail não verificado, Raio‑X pendente).
- **Integrações** — ClickUp (handoff + retry), e‑mail (Resend), Instagram (OAuth + métricas + coorte), **cron** (`node-cron`: ig‑collect, clickup‑retry, limpeza de login_attempts).

## ⚙️ Configuração necessária no app (Hostinger — Environment Variables)

Obrigatórias (login/banco):
```
NODE_ENV=production
SIP_JWT_SECRET=<≥32 chars>
SUPABASE_URL=https://mbvybujpkwuorhtdzcde.supabase.co   # URL da API, NÃO a do dashboard
SUPABASE_SERVICE_ROLE_KEY=<service_role do projeto>
```
Por integração (cada uma só ativa quando setada):
```
RESEND_API_KEY=...              # e-mails (verificação/reset/acesso liberado)
CLICKUP_TOKEN=...               # handoff ClickUp
CLICKUP_RETRY_SECRET=...        # cron de retry de handoff
META_APP_ID=...  META_APP_SECRET=...  META_REDIRECT_URI=...   # OAuth Instagram
IG_COLLECT_SECRET=...           # cron de coleta IG
SIP_APP_URL=https://SEU-DOMINIO # base usada em links de e-mail/IG callback
```
> Diagnóstico: `GET /api/health` (acrescente `?debug=1` para ver refs/contagens).

## 🚀 Deploy (Hostinger Web Apps)
- Framework: **Express**. Build: `npm run build`. Start: `npm start`. **Entry File / Output Directory: em branco.**
- Ferramentas de build estão em `dependencies` (Hostinger instala em produção).
- Detalhes em [DEPLOY.md](./DEPLOY.md).

## 🧪 Credenciais de teste (senha `SipTeste@2026`)
- Admin: `admin@grupoparticipa.app.br`
- Aluno (Aurum, com trilha): `coordenadoraaurum@gmail.com`
- Monitor: `mentor@grupoparticipa.app.br`
> ⚠️ Rotacione a `service_role` no Supabase (apareceu em chat durante o setup) e troque estas senhas de teste.

## 🔭 Decisões de escopo / melhorias futuras (não bloqueiam o produto)
- **Chamados**: thread com mensagens/responder/reabrir/status via **polling (15s)** — funcional. Upgrade para Supabase **Realtime** é opcional.
- **Anexos em chamados**: aceita metadados; **upload de arquivo requer Supabase Storage** (não configurado) — pendente de decisão de infra.
- **Instagram**: front/back completos; só funciona de ponta a ponta com as envs `META_*` (sem elas mostra "configuração pendente", fiel ao legado).
- **Resume de cadastro por querystring** (`?verificar=email`/`?completar=raiox`): substituído por **gate in‑app** equivalente no `RequireAuth` (verificação de e‑mail / Raio‑X pendente).
