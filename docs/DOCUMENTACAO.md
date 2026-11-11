# Documentação do Projeto Ápice

> Documento de estudo para o grupo. Descreve **o que existe no código** (branch `chore/pequenas-correcoes`).
> Quando algo não está claro ou não pôde ser confirmado só lendo o código, aparece marcado com **⚠️ A confirmar**.
>
> **Como este documento foi feito:** leitura de `package.json`, `server.js`, `.env.example`, `routes/`, `controllers/`, `middlewares/`, `services/`, `config/`, `models/`, `validators/`, `database/`, `migrations/`, SQLs, parciais de `views/` e `public/js/`. Das telas (`views/*.ejs`) foram lidos títulos, rotas chamadas (`fetch`/`action`) e ações; **o HTML/JS interno de cada tela não foi lido linha a linha**, e a aplicação **não foi executada**. Os "passo a passo na tela" foram deduzidos do código, e por isso podem ter pequenas diferenças visuais. O arquivo `.env` **não foi lido**.

---

## Sumário

1. [Visão geral e arquitetura](#1-visão-geral-e-arquitetura)
2. [Estrutura de pastas](#2-estrutura-de-pastas)
3. [Como rodar localmente](#3-como-rodar-localmente)
4. [Variáveis de ambiente](#4-variáveis-de-ambiente)
5. [Modelo do banco de dados](#5-modelo-do-banco-de-dados)
6. [Conceitos que atravessam o sistema](#6-conceitos-que-atravessam-o-sistema) (sessão, tipos de conta, planos, IA, match)
7. [Funcionalidades](#7-funcionalidades)
8. [Lista de rotas (resumo)](#8-lista-de-rotas-resumo)
9. [Limitações e pontos de atenção gerais](#9-limitações-e-pontos-de-atenção-gerais)
10. [Glossário](#10-glossário)

---

## 1. Visão geral e arquitetura

**O que é o Ápice:** plataforma que conecta **desenvolvedores iniciantes** (principalmente estudantes buscando estágio) a **empresas**. O sistema lê o GitHub do dev, descobre as skills dele, calcula a **compatibilidade (match)** com as vagas, monta **roadmaps de estudo** e oferece um **mentor de carreira com IA**. Empresas publicam vagas e veem devs compatíveis. Existe um terceiro tipo de conta, o **administrador**.

**Tecnologias (de `package.json`):**

| Camada | Tecnologia |
|---|---|
| Servidor | Node.js + **Express 5** (`server.js`) |
| Páginas | **EJS** (renderização no servidor) + JavaScript puro no navegador (`fetch`) |
| Banco | **MySQL 8** via `mysql2` (pool de 5 conexões) |
| Sessão | `express-session` + `express-mysql-session` (sessão guardada no próprio MySQL) |
| Segurança | `helmet` (CSP), `express-rate-limit`, `bcrypt`, `express-validator` |
| Login social | GitHub OAuth (chamadas diretas com `axios`) |
| IA | **Google Gemini** (`@google/genai`) + provedores de fallback via SDK `openai` (Groq, Cerebras, Mistral, OpenRouter) |
| Pagamento | **Mercado Pago** (`mercadopago`, assinaturas recorrentes) |
| E-mail | `nodemailer` (SMTP) |
| Upload | `multer` (avatar em disco; anexo do mentor só em memória), `pdf-parse` |
| Testes | `jest`, `supertest`, Playwright/axe (scripts visuais e de acessibilidade) |

> ⚠️ **Atenção ao pedido original:** o enunciado menciona "Anthropic". **No código não existe nenhuma integração com a Anthropic.** A IA é o **Gemini** (com fallback para outros provedores). Também não há nenhuma variável `ANTHROPIC_*` em `.env.example`.

**Arquitetura em camadas (padrão MVC simplificado):**

```
Navegador
   │  (1) abre uma página  → GET /alguma-pagina
   ▼
server.js ──► views/*.ejs  (HTML montado no servidor)
   │
   │  (2) a página roda JS e chama a API  → fetch("/api/...")
   ▼
routes/*.js ──► middlewares (login, plano, validação)
   │
   ▼
controllers/*.js ──► services/*.js ──► database/db.js (MySQL)
                                  └──► APIs externas (GitHub, Gemini, Mercado Pago, SMTP)
```

- **`routes/`**: só liga *URL + método* a um controller e aos middlewares que protegem a rota.
- **`controllers/`**: recebem a requisição, validam, chamam serviços/banco e respondem (JSON ou página).
- **`services/`**: regra de negócio reutilizável (cálculo de match, análise do GitHub, IA, assinaturas).
- **`models/User.js`**: único "model"; funções de acesso às tabelas de usuário/perfis. Os demais controllers consultam o banco direto com `db.query`.
- **`middlewares/`**: `auth.js` (login e tipo de conta), `requirePlan.js`, `roadmapLimites.js`, `mpCheckoutCsp.js`.
- **`validators/`**: regras do `express-validator` (cadastro, login, vaga, progresso).

**Dois estilos de rota** (importante para não se confundir):
1. **Páginas** (`GET /dashboard`, `/vagas` …) — definidas em `server.js`; protegidas por `requireAuth/requireDev/requireCompany/requireAdmin`, que **redirecionam** para `/login` (ou para a home do tipo de conta).
2. **API JSON** (`/api/...`) — protegidas por `isAuth/isEmpresa/isAdmin`, que respondem **401/403 em JSON**.

---

## 2. Estrutura de pastas

```
newapice2/
├─ app.js                 # só faz require('./server')
├─ server.js              # coração: config do Express, CSP, sessão, páginas e montagem das rotas
├─ package.json           # dependências e scripts npm
├─ .env.example           # modelo das variáveis de ambiente (o .env real NÃO vai pro git)
├─ CLAUDE.md              # backlog da auditoria de QA (QA-001…QA-042)
├─ CHANGELOG.md           # histórico de mudanças
│
├─ routes/                # URL → controller (+ middlewares)
│   ├─ auth.js            # /auth (GitHub OAuth, logout)
│   ├─ users.js           # /api/auth (cadastro, login, recuperar senha)
│   ├─ profile.js         # /api/user (perfil do dev, avatar, skills)
│   ├─ repositorios.js    # /api/user/repos (portfólio) — tem lógica dentro da própria rota
│   ├─ roadmap.js         # /api (vagas, candidatura, roadmap antigo, dashboard de progresso)
│   ├─ trilha.js          # /trilha (roadmap novo: fases/etapas)
│   ├─ empresa.js         # /api/empresa (tudo da empresa)
│   ├─ company-public.js  # /api/empresas/:id (perfil resumido, qualquer logado)
│   ├─ messages.js        # /api/messages (chat dev ↔ empresa)
│   ├─ admin.js           # /api/admin
│   ├─ ai.js              # /api/ai (mentor, insights, explicação de match)
│   ├─ plans.js           # /api/plans
│   ├─ assinaturas.js     # /api/assinaturas
│   └─ webhooks.js        # /webhooks/mercadopago (público)
│
├─ controllers/           # (ver tabela das funcionalidades)
│   ├─ authController.js        # GitHub OAuth + logout
│   ├─ usersController.js       # cadastro/login por e-mail, esqueci/redefinir senha
│   ├─ profileController.js     # perfil do dev, avatar, reanálise, skills
│   ├─ roadmapController.js     # vagas públicas, candidatar, roadmap antigo, progresso
│   ├─ trilhaController.js      # roadmap novo
│   ├─ empresaController.js     # painel, vagas, matchs, devs, perfil e candidaturas
│   ├─ messagesController.js    # conversas e mensagens
│   ├─ adminController.js       # painel admin
│   ├─ plansController.js       # lista de planos
│   └─ assinaturasController.js # assinatura (API + páginas + webhook)
│
├─ services/              # regra de negócio
│   ├─ githubAnalyzer.js / dependencyParser.js / githubErrors.js / skillOrigem.js  # análise de perfil
│   ├─ matchCalculator.js         # % de compatibilidade
│   ├─ roadmapGenerator.js        # roadmap ANTIGO (gap de skills por vaga)
│   ├─ roadmapService.js          # roadmap NOVO (fases/etapas, IA + modelo)
│   ├─ geminiClient.js / aiFallback.js   # acesso à IA
│   ├─ mentorChat.js / aiTools.js / userContextService.js / fileTextExtractor.js  # mentor
│   ├─ marketInsights.js / candidateSummarizer.js / portfolioDescriber.js        # outros usos de IA
│   ├─ subscriptionService.js     # "quem tem qual plano" (fonte única)
│   ├─ mercadoPago.js / mpSubscriptions.js / mpPlanSync.js / mpMessages.js       # Mercado Pago
│   ├─ emailService.js            # SMTP
│   └─ niveis.js                  # ordem dos níveis (iniciante<intermediário<avançado etc.)
│
├─ middlewares/           # auth.js, requirePlan.js, roadmapLimites.js, mpCheckoutCsp.js
├─ validators/            # auth.validator.js, job.validator.js, roadmap.validator.js, handle-validation.js
├─ models/User.js
├─ config/
│   ├─ plans.js           # os 5 planos (preços, limites, features) — "tabela" estática
│   ├─ mercadopago.js     # credenciais/URLs do Mercado Pago
│   └─ script_bd.sql, migration_v2.sql, migration_repos.sql   # SQLs (ver aviso na seção 5)
├─ database/
│   ├─ db.js              # pool MySQL + **migrações automáticas** ao subir o servidor
│   ├─ seed.js, seed-skills.js, seed-admin.js              # dados iniciais
│   └─ migration*.js      # migrações antigas avulsas
├─ migrations/            # SQL + runners do roadmap novo e da análise de perfil
├─ seeds/                 # recursos.sql (links de estudo) + runner
├─ data/                  # habilidades-referencia.json e roadmaps-modelo/*.json (fallback da IA)
├─ views/                 # páginas EJS (+ partials/ com os cabeçalhos e roadmap/ com as telas do roadmap novo)
├─ public/                # arquivos estáticos: css/, js/, img/, robots.txt, sitemap.xml, uploads/ (avatares, gerado em runtime)
├─ scripts/               # ferramentas de desenvolvimento (testar IA, sync MP, comparar telas…)
├─ landing/               # página estática antiga (index.html + css) — ⚠️ A confirmar se ainda é usada (não é servida por server.js)
├─ docs/                  # documentos (ASSINATURAS.md, roadmap-spec.md, análise de perfil…)
└─ tests/                 # testes Jest (tests/qa/ = um teste por item do backlog QA)
```

---

## 3. Como rodar localmente

1. **Pré-requisitos:** Node.js e uma instância **MySQL 8** acessível (o projeto usa Clever Cloud; não há Docker Compose nem MySQL local documentado).
2. `npm install`
3. Copie `.env.example` para `.env` e preencha (seção 4). **`APP_URL` é obrigatória**: sem ela `server.js` imprime erro e encerra (`process.exit(1)`).
4. **Banco:** ao subir, `database/db.js` conecta (5 tentativas com espera) e roda **migrações automáticas** que criam várias tabelas/colunas. Mas as tabelas-base (`users`, `jobs`, `skills`…) vêm de `config/script_bd.sql`:
   ```
   mysql -h <host> -u <user> -p <banco> < config/script_bd.sql
   ```
5. **Dados iniciais:**
   - `node database/seed-skills.js` — catálogo de skills (ou `node database/seed.js`, que também cria 3 vagas de exemplo ⚠️ A confirmar o conteúdo exato).
   - `node database/seed-admin.js` — cria o administrador (usa `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NOME`).
   - Roadmap novo: `npm run migrate:roadmap` e `npm run seed:roadmap` (tabelas + links de estudo); `npm run migrate:analise-perfil` (tabelas de evidências/declarações).
6. `npm start` → `http://localhost:3000` (usa `PORT`, padrão 3000). Não existe script `dev`.
7. **Login com GitHub** exige criar um *OAuth App* no GitHub com callback `http://localhost:3000/auth/github/callback` (use um app diferente para produção).
8. **Mercado Pago** é opcional para desenvolver: sem `MP_ACCESS_TOKEN`/`MP_PUBLIC_KEY` o site funciona e a assinatura mostra "indisponível".

**Scripts npm** (`package.json`): `start`, `test` (jest), `mp:sync-plans`, `migrate:roadmap`, `seed:roadmap`, `migrate:analise-perfil`, `visual:base`, `visual:comparar`.

---

## 4. Variáveis de ambiente

(Só os nomes — valores nunca devem ir para o git.)

| Variável | Para quê | Obrigatória? |
|---|---|---|
| `PORT`, `NODE_ENV` | Porta e modo (`production` ativa cookie `secure` e `trust proxy`) | Não (porta padrão 3000) |
| `APP_URL` | URL base do site; monta `redirect_uri` do GitHub e links de e-mail | **Sim** (o app não sobe sem) |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS` | Conexão MySQL | Sim |
| `SESSION_SECRET` | Assina o cookie de sessão | Sim ⚠️ (o código não valida, mas a sessão depende dele) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Login com GitHub | Para login GitHub |
| `GITHUB_TOKEN_DEV` | Só para `scripts/avaliar-deteccao.js` | Não |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | E-mail de recuperação de senha | Não (sem isso o e-mail não é enviado) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NOME` | Usadas só pelo `seed-admin.js` | Só para criar o admin |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | IA principal (padrão `gemini-3.6-flash`) | Para IA |
| `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY` | Fallback de IA (opcionais; sem chave o provedor é pulado) | Não |
| `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, `APP_BASE_URL` | Mercado Pago (`APP_BASE_URL` cai para `APP_URL` se vazia) | Para cobrança |
| `MP_TEST_PAYER_EMAIL` | Só testes (ignorada em produção) | Não |
| `RENDER` | Detectada (existe sozinha no Render) só para decidir se avisa sobre webhook sem segredo | Automática |

---

## 5. Modelo do banco de dados

> ⚠️ **Aviso importante:** o schema está **espalhado em três lugares**, e `config/script_bd.sql` está **desatualizado** em relação ao código:
> 1. `config/script_bd.sql` — tabelas-base. **Não** inclui `'admin'` em `users.type`, `users.active`, `user_admin_profiles`, `conversations`, `messages`, `user_subscriptions`, `mp_plans`, `subscriptions`, `subscription_payments`, as colunas `descricao/cidade/estado` da empresa, nem `mentor_conversas.gemini_interaction_id`.
> 2. `database/db.js` — cria/ajusta tudo isso **automaticamente toda vez que o servidor sobe** (`CREATE TABLE IF NOT EXISTS`, `addColumn`, `addEnumValue`).
> 3. `migrations/*.sql` — tabelas do roadmap novo e da análise de perfil (rodadas por `npm run migrate:*`).
>
> Na prática, para ter o schema completo: rode `script_bd.sql`, suba o servidor uma vez (para `db.js` completar) e rode as migrações npm.

### 5.1 Tabelas por assunto

**Contas**

| Tabela | Campos principais | Observações |
|---|---|---|
| `users` | `id`, `email` (único), `password_hash` (nulo p/ login GitHub), `type` (`dev`/`empresa`/`admin`), `active`, `created_at` | `type='admin'` e `active` são adicionados por `db.js` |
| `user_dev_profiles` | `user_id` (único, FK users), `nome`, `sobrenome`, `github_login`, `github_id` (único), `nivel` (`iniciante/intermediario/avancado`), `avatar_url` | `github_id` só existe se o dev entrou com GitHub |
| `user_company_profiles` | `user_id`, `razao_social`, `nome_fantasia`, `cnpj` (único, só dígitos), `setor`, `tamanho`, `site`, `descricao`, `cidade`, `estado` | |
| `user_admin_profiles` | `user_id`, `nome` | |
| `password_resets` | `user_id`, `token_hash` (SHA-256), `expires_at`, `used_at` | Token real só vai por e-mail |

**Vagas e skills**

| Tabela | Campos principais |
|---|---|
| `skills` | `id`, `name`, `type` (`hard`/`soft`), `category`, `github_signals` (lista separada por vírgula usada na detecção) |
| `jobs` | `title`, `company` (**texto copiado** do nome da empresa na criação), `company_id`, `description`, `level` (`estagio/junior/pleno`), `active`, `modality`, `contract_type`, `salary_min/max`, `location`, `years_experience`, `english_level`, `responsibilities`, `benefits`, `max_candidates`, `tags` |
| `job_skills` | `job_id`, `skill_id`, `importance` (`obrigatoria`/`desejavel`), `learn_order` |
| `skill_resources` | `skill_id`, `type` (`curso/video/documentacao/projeto`), `title`, `url`, `is_free`, `duration` — usados no roadmap **antigo** |
| `job_applications` | `job_id`, `dev_github_id`, `resumo_ia` (cache do resumo IA) — único por (vaga, dev) |
| `company_match_actions` | `company_id`, `dev_github_id`, `job_id`, `action` (`aceito`/`recusado`) |

**Skills do dev**

| Tabela | Campos / função |
|---|---|
| `user_skills` | `github_id`, `skill_id`, `source` (`github`/`manual`), `confidence` 0–100 — resultado final combinado |
| `user_skill_evidencias` | `github_id`, `skill_id`, `repo_full_name`, `tipo` (`linguagem/dependencia/readme`), `pontos` — o "por quê?" de cada skill |
| `user_skill_declaracoes` | `github_id`, `skill_id`, `nivel`, `confidence` — autodiagnóstico do dev |
| `user_repositories` | `user_id`, `repo_name`, `repo_full_name`, `description`, `is_private`, `language`, `stars`, `updated_at_gh`, `is_public`, `ai_description` |
| `perfil_tecnico_ia` | `user_id`, `proficiencia_estimada`, `boas_praticas`, `pontos_melhoria` — ⚠️ A confirmar: só encontrei escrita em `registrarProjetoVerificadoNoPerfil` (roadmapService) |

**Roadmap antigo:** `user_roadmap_progress` (`github_id`, `job_id`, `skill_id`, `status` `nao_iniciado/em_progresso/concluido`, `completed_at`).

**Roadmap novo:** `roadmaps` (`usuario_id`, `tipo_objetivo` `vaga/area`, `vaga_id`, `area`, `horas_semana`, `status` `ativo/arquivado`, `versao`, `origem` `ia/modelo`, `gerado_em`) → `roadmap_fases` (`ordem`, `nome`, `objetivo`, `projeto_enunciado`, `projeto_repo_url`, `projeto_status` `pendente/verificado/nao_verificado/em_revisao`, `verificado_em`) → `roadmap_etapas` (`ordem`, `titulo`, `descricao`, `habilidade`, `horas_estimadas`, `recurso_id`, `status` `pendente/em_andamento/concluida`, `concluida_em`). Apoio: `recursos` (links curados) e `recursos_pendentes` (habilidades sem recurso cadastrado, com contador).

**Mensagens:** `conversations` (`dev_github_id`, `company_id`, `job_id` opcional) → `messages` (`conversation_id`, `sender_user_id`, `body`, `read_at`).

**IA:** `match_ia_cache` (explicação do match por dev+vaga), `mentor_conversas` (`user_id`, `role` `user/assistant`, `content`, `gemini_interaction_id`), `mercado_insights` (`resumo`, `tecnologias_top` em JSON, `gerado_em`).

**Planos/assinaturas:** `user_subscriptions` (plano **manual** dado pelo admin: `user_id` único, `plan_code`, `status`), `mp_plans` (id do plano no Mercado Pago por conta MP), `subscriptions` (assinatura paga: `plan_id`, `mp_preapproval_id`, `status`, `paid_until`, `payment_issue`…), `subscription_payments` (cada cobrança).

### 5.2 Relacionamentos (resumo)

```
users 1─1 user_dev_profiles | user_company_profiles | user_admin_profiles
users 1─N user_repositories, password_resets, mentor_conversas, roadmaps, subscriptions
users(empresa) 1─N jobs 1─N job_skills N─1 skills
jobs 1─N job_applications, company_match_actions
skills 1─N skill_resources, user_skills, user_skill_evidencias, user_skill_declaracoes
roadmaps 1─N roadmap_fases 1─N roadmap_etapas N─1 recursos
conversations 1─N messages ;  conversations N─1 users(empresa), N─1 jobs
subscriptions 1─N subscription_payments
```

### 5.3 Ponto que confunde: `github_id` x `user_id`

Muitas tabelas do dev (`user_skills`, `user_roadmap_progress`, `job_applications`, `conversations`, `match_ia_cache`) usam uma coluna chamada **`github_id`/`dev_github_id`**. O padrão do código (`getUserId(req)`) é: **usa o `github_id` real se existir, senão o `user_id` interno**. Consequências:
- Dev que cadastrou por e-mail **sem** vincular GitHub guarda dados com o `user_id` no lugar do `github_id`.
- Não há chave estrangeira nessas colunas para `users`.
- ⚠️ Pode haver colisão teórica entre um `user_id` pequeno e um `github_id` de outra pessoa; não vi tratamento disso no código.

---

## 6. Conceitos que atravessam o sistema

### 6.1 Sessão e tipos de conta
- Sessão no MySQL (`express-mysql-session`), cookie `httpOnly`, `sameSite=lax`, `secure` em produção, validade **24 h**.
- `req.session.user` guarda `{ id, email, type, name, … }`. No login GitHub também guarda `github_id`, `login`, `avatar`, `nivel`, `repos` e o **`accessToken` do GitHub**.
- `exposeUser` (em `middlewares/auth.js`) coloca o usuário nas views **sem o `accessToken`** (correção QA-004).
- Tipos: `dev`, `empresa`, `admin`. Cada guarda redireciona para a home do tipo (`homeFor`): `/dashboard`, `/empresa/dashboard`, `/admin/dashboard`.
- `?next=` do login só aceita caminho interno (começa com `/`, sem `//`, `://` ou `\`) — evita *open redirect*.
- **Suspensão** (`users.active = 0`) só é verificada **no login**. ⚠️ A confirmar: não vi checagem de `active` nas rotas depois do login, então uma sessão já aberta provavelmente continua válida até expirar.

### 6.2 Planos (`config/plans.js`)
| Código | Tipo | Preço | Principais regras |
|---|---|---|---|
| `dev_free` | dev | R$ 0 | sem mentor, sem roadmap personalizado do sistema antigo, sem verificação de projeto; roadmap novo: **1 ativo**, regenerar a cada **30 dias** |
| `dev_pro` | dev | R$ 19,90/mês | mentor com IA, roadmap personalizado (cursos + motivos IA), verificação de projetos, destaque; **até 5 ativos**, regenerar a cada **7 dias** |
| `empresa_free` | empresa | R$ 0 | 1 vaga ativa |
| `empresa_basico` | empresa | R$ 49,90/mês | até 3 vagas ativas |
| `empresa_premium` | empresa | R$ 99,90/mês | vagas ilimitadas + resumo IA de candidatos |

**Como o plano de alguém é decidido** (`services/subscriptionService.js`): vale o **melhor (mais caro)** entre (1) assinatura paga no Mercado Pago ainda válida (`subscriptions`), (2) plano **manual** do admin (`user_subscriptions`), (3) o gratuito. Assinatura cancelada/pausada dá acesso até `paid_until`; se a cobrança foi recusada há uma janela de **10 dias** (`PAYMENT_GRACE_DAYS`).

### 6.3 IA (como as chamadas funcionam)
- `services/geminiClient.js` → `askGeminiJSON()`: pede JSON ao Gemini (Interactions API, timeout 15 s). **Se falhar**, `services/aiFallback.js` tenta em ordem: Groq → Cerebras → Mistral → OpenRouter (12 s cada; provedor sem chave é pulado).
- O **mentor** usa `chatTurn`/`sendFunctionResults` (memória por `previous_interaction_id` + *function calling*) e **não tem fallback**.
- Privacidade (LGPD): os prompts enviam só skills/níveis/títulos — o código evita nome e e-mail.
- Limite de requisições: `/api/ai/*` → 30 por 15 min (por IP); `/api/auth/*` → 20 por 15 min.

### 6.4 Cálculo do match (`services/matchCalculator.js`)
`match = skills × 0,85 + senioridade × 0,15` (arredondado, máx. 100).
- **Skills:** cada skill da vaga tem peso 2 (obrigatória) ou 1 (desejável); soma `(confiança/100) × peso` ÷ soma dos pesos.
- **Senioridade:** nível do dev vs nível da vaga; igual/maior = 100, 1 degrau abaixo = 55, 2 degraus = 10; sem nível = 100.
- "Pronto para a vaga" (`readyFor`) = match ≥ 70.
- A mesma função alimenta as telas do dev e da empresa, para o número nunca divergir.

### 6.5 Detecção de skills pelo GitHub (`services/githubAnalyzer.js`)
Para cada repositório próprio (forks ignorados): lê **linguagens**, **README** e **arquivos de dependência da raiz** (`package.json`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `build.gradle`, `composer.json`, `Gemfile`, `go.mod`). Para cada skill com `github_signals`: **+40** se um sinal está nas linguagens *ou* nas dependências; **+20** se aparece no README (palavra inteira). Soma entre repositórios, **teto 100**. Se o dev importou repositórios em `/repositorios`, **só esses** são analisados; senão usa os mais recentes. Falhas do GitHub (limite de uso, token inválido, rede) **não viram "confiança 0"**: leitura parcial nunca reduz a confiança e leitura totalmente falha não grava nada.
**Autodiagnóstico:** o dev declara iniciante (30), intermediário (60) ou avançado (85); vale **a maior** entre detectada e declarada, e `source` indica a origem.

---

## 7. Funcionalidades

Legenda de acesso: 🌐 público · 🔑 qualquer logado · 👨‍💻 dev · 🏢 empresa · 🛡️ admin.

### 7.1 Páginas públicas institucionais (Início, Para Devs, Para Empresas, Sobre)

1. **O que é:** vitrine do produto. Início mostra estatísticas (nº de devs, vagas ativas e skills). *Para Devs* e *Para Empresas* apresentam planos com preços lidos de `config/plans.js`. *Sobre* é institucional.
2. **Como o usuário usa:** abre o site, navega pelo menu (Início, Para Devs, Para Empresas, Sobre) e clica em *Entrar* ou *Cadastrar-se*.
3. **Rotas:** `GET /` 🌐, `/para-devs` 🌐, `/para-empresas` 🌐, `/sobre` 🌐 (sempre renderiza como visitante), `GET /favicon.ico`, `/robots.txt` e `/sitemap.xml` (estáticos em `public/`).
4. **Fluxo técnico:** `server.js` (handlers inline) → `res.render("index"|"para-devs"|"para-empresas"|"sobre")`. Cabeçalho: `views/partials/header.ejs`. JS: `public/js/navbar.js`, `reveal.js`. Estatísticas: três `COUNT(*)` direto em `db.query`; se o banco falhar o `catch` vazio mantém zeros.
5. **Tabelas:** `users`, `jobs`, `skills` (leitura).
6. **Integrações:** nenhuma.
7. **Regras:** contagem de devs = `users.type='dev'`; vagas = `jobs.active=1`.
8. **Limitações:** erros do banco são engolidos silenciosamente (`catch (_) {}`), mostrando 0 sem avisar.

### 7.2 Cadastro e login por e-mail/senha

1. **O que é:** criar conta (dev ou empresa) e entrar com e-mail e senha.
2. **Passo a passo:** em `/cadastro` escolhe **dev** ou **empresa**. Dev informa nome (obrigatório), sobrenome, usuário GitHub, nível, e-mail e senha. Empresa informa razão social, nome fantasia, **CNPJ** (validado com dígitos verificadores), setor, tamanho, site, e-mail, senha. Após cadastrar já fica logado e vai ao painel. Em `/login` informa e-mail/senha.
3. **Rotas:** `GET /cadastro` 🌐, `GET /login` 🌐 (se já logado, `redirectIfAuth` manda para o painel), `POST /api/auth/register` 🌐, `POST /api/auth/login` 🌐 — ambas com limite de 20 tentativas/15 min.
4. **Fluxo técnico:** `views/cadastro.ejs`/`login.ejs` (`fetch`) → `routes/users.js` → `validators/auth.validator.js` (`validateRegister`/`validateLogin`) → `usersController.register`/`login` → `models/User.js` (`findByEmail`, `create`, `createDevProfile`, `createCompanyProfile`, `cnpjExists`) → MySQL. Senha com `bcrypt` (10 rounds). `public/js/form-validation.js` troca os balões nativos por mensagens próprias.
5. **Tabelas:** `users`, `user_dev_profiles`, `user_company_profiles`.
6. **Integrações:** nenhuma.
7. **Regras/validações:** e-mail válido, ≤255; senha 8–128 caracteres e sem espaço no início/fim; `confirm` (se enviado) deve igualar a senha; nome do dev só letras/espaços/`'.:-`; usuário GitHub só letras, números e hífen (≤39); setores e tamanhos de listas fixas; site precisa de `http(s)://`. Erros: **409** e-mail ou CNPJ já cadastrado; **401** credenciais ("E-mail ou senha incorretos." — mesma mensagem para e-mail inexistente ou senha errada); **403** conta suspensa; **500** genérico. Login de dev **limpa o histórico do mentor**. `next` seguro é aceito no login.
8. **Limitações:** cadastro de **admin** não existe (só `seed-admin.js`). Contas criadas só por GitHub não têm senha (`password_hash` nulo) e não conseguem logar por e-mail. ⚠️ O cadastro cria o `users` antes de checar o CNPJ; se o CNPJ já existir devolve 409 mas o registro `users` já foi inserido (não vi transação/rollback) — **⚠️ A confirmar** testando.

### 7.3 Login com GitHub (OAuth)

1. **O que é:** entrar com a conta do GitHub; cria a conta dev automaticamente e dispara a análise de skills.
2. **Passo a passo:** em `/login`, clica em "Continuar com GitHub" → autoriza no GitHub → volta ao Ápice já logado (no dashboard ou na página de `?next=`).
3. **Rotas:** `GET /auth/github` 🌐, `GET /auth/github/callback` 🌐, `POST /auth/logout` 🔑.
4. **Fluxo técnico:** `authController.githubLogin` gera `state` aleatório (até 5 pendentes por sessão, válidos 10 min, uso único) e redireciona ao GitHub com escopo `read:user,user:email,public_repo`. `githubCallback` valida o `state`, troca o `code` por token (`axios` → `github.com/login/oauth/access_token`), busca `/user` e `/user/repos` (30 mais recentes), acha/cria `users` por e-mail (ou `<login>@users.noreply.github.com`), faz *upsert* em `user_dev_profiles` e monta `req.session.user`. Em segundo plano roda `matchSkillsFromGitHub` e `clearMentorHistory`.
5. **Tabelas:** `users`, `user_dev_profiles`, `user_skills`, `user_skill_evidencias`, `mentor_conversas`.
6. **Integrações:** API do GitHub; variáveis `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `APP_URL`.
7. **Regras:** e-mail já usado por empresa → `?error=email_in_use_company`; conta suspensa → `error=account_suspended`; state inválido → `invalid_state`; token falhou → `token_failed`; erro geral → `server_error`. Em desenvolvimento, se o host da requisição difere de `APP_URL`, refaz o login no endereço certo. Logout: `POST` (não GET) destrói a sessão e vai para `/`.
8. **Limitações:** o token do GitHub fica na sessão (MySQL) — é sensível. Nome do dev vindo do GitHub só é gravado na criação (`ON DUPLICATE KEY` atualiza apenas `github_login` e `github_id`). Como o e-mail é a chave, um dev que cadastrou por e-mail e depois entra com GitHub **só é unificado se o e-mail do GitHub for o mesmo** (público no GitHub); caso contrário, surgem duas contas — o painel admin até avisa "outras contas" (ver 7.17).

### 7.4 Recuperação de senha

1. **O que é:** "Esqueci minha senha" por e-mail.
2. **Passo a passo:** `/esqueci-senha` → digita o e-mail → recebe link → `/redefinir-senha?token=…` → define nova senha → volta ao login.
3. **Rotas:** `GET /esqueci-senha`, `GET /redefinir-senha` 🌐; `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` 🌐.
4. **Fluxo:** views → `usersController.forgotPassword`/`resetPassword` → `services/emailService.js` (`sendPasswordResetEmail`, nodemailer) → `password_resets`.
5. **Tabelas:** `password_resets`, `users`.
6. **Integrações:** SMTP (`SMTP_*`), `APP_URL` (monta o link).
7. **Regras:** resposta **sempre genérica** (não revela se o e-mail existe nem se a conta é só-GitHub). Token de 32 bytes guardado como **SHA-256**; validade **1 h**; uso único (ao redefinir, todos os tokens pendentes do usuário são marcados como usados). Falha no SMTP é só logada.
8. **Limitações:** sem SMTP configurado o usuário não recebe nada e vê sucesso. No Render gratuito as portas 25/465/587 são bloqueadas — o serviço tenta a **2525** como alternativa. Redefinir a senha **não derruba sessões abertas** ⚠️ A confirmar (não vi essa ação).

### 7.5 Vagas públicas e candidatura

1. **O que é:** lista pública de vagas ativas e página de cada vaga, com match (para dev logado) e botão de candidatura.
2. **Passo a passo:** `/vagas` mostra cards (busca/filtros no cliente); clicar abre `/vagas/:id` com descrição, skills exigidas (obrigatórias/desejáveis), % de compatibilidade, explicação de IA, "match projetado" ao concluir o roadmap e botão **Candidatar-se** (deslogado vê "Entrar para se candidatar" com `?next=`). Empresa dona da vaga vê opções de gestão.
3. **Rotas:** `GET /vagas` 🌐, `GET /vagas/:id` 🌐; API: `GET /api/jobs` 🌐 (paginada), `GET /api/jobs/detalhes` 🌐 (com skills), `GET /api/vagas/:id` 🌐 (match só se logado como dev), `POST /api/vagas/:id/candidatar` 🔑 (somente dev), `GET /api/ai/jobs/:id/match-explicacao` 🔑.
4. **Fluxo:** `server.js` busca dados no servidor (SEO) e renderiza `vagas.ejs` / `vaga-publica.ejs`; a página depois chama a API → `routes/roadmap.js` → `roadmapController.listJobs/listJobsWithDetails/getPublicJob/applyToJob` → `matchCalculator.calculateJobMatch`. Explicação IA: `routes/ai.js` → `matchCalculator.getMatchExplanation` → `askGeminiJSON`, com cache em `match_ia_cache`.
5. **Tabelas:** `jobs`, `job_skills`, `skills`, `user_skills`, `job_applications`, `match_ia_cache`, `roadmaps`/`roadmap_etapas` (match projetado).
6. **Integrações:** Gemini (explicação do match).
7. **Regras:** só vagas `active=1` aparecem/aceitam candidatura; candidatura é **idempotente** (`INSERT IGNORE`, única por vaga+dev); só `type='dev'` pode se candidatar (403); paginação máx. 100 (`/jobs`) e 500 (`/jobs/detalhes`); listagem SSR limitada a 500. Explicação IA só é refeita se o % calculado mudou. Erro da IA → 502.
8. **Limitações:** `GET /vagas/:id` busca a vaga mesmo **inativa** no SSR (a rota de página não filtra `active`); a API `/api/vagas/:id` também retorna vagas inativas ⚠️ A confirmar o efeito na tela. `jobs.max_candidates` existe e é gravado, mas **não encontrei nenhum lugar que o aplique** ao limitar candidaturas.

### 7.6 Dashboard do desenvolvedor

1. **O que é:** painel inicial do dev: saudação, vagas em destaque com match, tarefas do roadmap ativo e badge de mensagens não lidas.
2. **Passo a passo:** após o login cai em `/dashboard`; marca etapas do roadmap direto no card; vê vagas e entra nelas.
3. **Rotas:** `GET /dashboard` 👨‍💻; `POST /trilha/:id/etapas/:etapaId` (marcar etapa); `GET /api/messages/unread-count`.
4. **Fluxo:** `server.js` (`/dashboard`) consulta `jobs` (com timeout de 8 s), skills das 2 primeiras vagas e o roadmap ativo (`roadmaps`, `roadmap_fases`, `roadmap_etapas`) → `dashboard.ejs`.
5. **Tabelas:** `jobs`, `job_skills`, `skills`, `roadmaps`, `roadmap_fases`, `roadmap_etapas`, `messages`.
6. **Integrações:** nenhuma direta.
7. **Regras:** falhas das consultas são engolidas (card vazio). Remove `accessToken` antes de renderizar.
8. **Limitações:** a rota de página carrega **todas** as vagas ativas sem paginação ⚠️ pode pesar com muitos dados.

### 7.7 Meu perfil (dev) e skills

1. **O que é:** perfil do dev: dados pessoais, foto, nível, lista de skills (com origem "detectada"/"declarada" e evidências por repositório), plano atual, reanálise do GitHub e **autodiagnóstico**.
2. **Passo a passo:** `/perfil` → edita nome/sobrenome/usuário GitHub/nível → salva; envia foto (JPEG/PNG/WebP/GIF até 2 MB); clica **Re-analisar** para refazer a leitura do GitHub; adiciona uma skill declarando o nível; remove uma skill declarada.
3. **Rotas** (todas 🔑 e sob `/api/user`): `GET /profile`, `PATCH /profile`, `POST /avatar`, `POST /reanalyze`, `POST /skills`, `DELETE /skills/:skillId`, `GET /skills/catalog`; página `GET /perfil` 🔑 (empresa é redirecionada a `/empresa/perfil`).
4. **Fluxo:** `perfil-dev.ejs` → `routes/profile.js` → `profileController` → `githubAnalyzer.analisarGitHub` / `skillOrigem` / `subscriptionService.getUserPlan`.
5. **Tabelas:** `users`, `user_dev_profiles`, `user_skills`, `user_skill_evidencias`, `user_skill_declaracoes`, `user_repositories`.
6. **Integrações:** API do GitHub (reanálise, usa o `accessToken` da sessão); upload salvo em `public/uploads/avatars/<userId>.<ext>`.
7. **Regras:** extensão do avatar vem do **mimetype validado** (nunca do nome enviado); avatar antigo é apagado; nível ∈ {iniciante, intermediario, avancado}; skill removível só se foi declarada pelo dev (ou manual antiga) — se o GitHub também a detectou, ela permanece com a confiança detectada; reanálise exige login GitHub (400 sem token) e retorna **503** com mensagem amigável quando o GitHub não responde. Conversões nível↔confiança: ≤40 iniciante, 41–70 intermediário, >70 avançado.
8. **Limitações:** `updateProfile` só altera `user_dev_profiles` — **não valida tamanho** de nome/sobrenome (o validador completo existe só no cadastro). Avatar: só dev (empresa não tem foto). Dev sem login GitHub não consegue "Re-analisar".

### 7.8 Repositórios e portfólio

1. **O que é:** o dev escolhe quais repositórios do GitHub entram no perfil/análise, edita título e descrição, define se cada um é público para empresas e pode **gerar descrição com IA** a partir do README.
2. **Passo a passo:** `/repositorios` → **Adicionar** abre modal com os repositórios do GitHub → seleciona → o repositório aparece na lista; lápis edita; chave público/privado; botão IA gera descrição; lixeira remove.
3. **Rotas** (🔑, sob `/api/user`): `GET /repos`, `GET /repos/github`, `POST /repos`, `PATCH /repos/:id`, `PATCH /repos/:id/visibility`, `POST /repos/:id/gerar-descricao`, `DELETE /repos/:id`; página `GET /repositorios` 👨‍💻 (empresa é redirecionada).
4. **Fluxo:** `repositorios.ejs` → `routes/repositorios.js` (a lógica está **na própria rota**, sem controller) → `db` / `axios` (GitHub) / `services/portfolioDescriber.generateRepoDescription` → `githubAnalyzer.fetchRepoReadme` → `askGeminiJSON`.
5. **Tabelas:** `user_repositories`.
6. **Integrações:** GitHub (`/user/repos`, README); Gemini.
7. **Regras:** `repo_name` não pode ficar vazio ao editar (≤255); `POST` é *upsert* (`ON DUPLICATE KEY UPDATE`); toda alteração filtra por `user_id` da sessão; só repositórios com `is_public=1` entram nos prompts e na visão da empresa; IA usa só nome, linguagem, descrição atual e 2000 caracteres do README. Códigos: 400 sem token GitHub, 404 repo inexistente, 502 falha da IA/GitHub.
8. **Limitações:** o escopo OAuth é `public_repo`, logo repositórios privados provavelmente não são lidos pela análise ⚠️ A confirmar; esta rota não usa `express-validator`.

### 7.9 Roadmap — sistema NOVO ("Trilha", `/trilha`)

1. **O que é:** trilha de estudos em **fases → etapas → projeto prático**, gerada por IA a partir do *gap* entre o perfil do dev e uma **área** (front-end, back-end, full-stack, dados) ou uma **vaga**. Se a IA falhar, usa um roadmap-modelo estático (`data/roadmaps-modelo/*.json`).
2. **Passo a passo:** menu **Roadmap** (`/trilha`) lista os roadmaps → **Novo** (`/trilha/novo`): escolhe área ou vaga e as horas por semana (padrão 10) → aguarda (overlay de carregamento) → abre o detalhe. No detalhe marca etapas (pendente/em andamento/concluída), vê o progresso por fase, envia o **link do repositório** do projeto da fase, pode **regenerar** ou **arquivar**.
3. **Rotas** (todas 👨‍💻, via `requireDev`, que redireciona): `GET /trilha`, `GET /trilha/novo`, `POST /trilha` (cria; checa limite de ativos), `GET /trilha/:id`, `POST /trilha/:id/etapas/:etapaId` (**JSON**), `POST /trilha/:id/fases/:faseId/projeto`, `POST /trilha/:id/regenerar` (checa limite), `POST /trilha/:id/arquivar`.
4. **Fluxo:** `views/roadmap/{index,novo,detalhe}.ejs` + `public/js/roadmap.js` → `routes/trilha.js` → `trilhaController` → `services/roadmapService.js` (`gerarRoadmap`, `regenerarRoadmap`, `verificarProjeto`, `fecharProjetoSemVerificar`) → `askGeminiJSON` e MySQL. Middlewares: `carregarRoadmap` (confere dono → 404 para qualquer outro), `limiteRoadmapsAtivos`, `limiteRegeneracao`.
5. **Tabelas:** `roadmaps`, `roadmap_fases`, `roadmap_etapas`, `recursos`, `recursos_pendentes`, `user_skills`, `user_skill_declaracoes`, `jobs`/`job_skills`, `perfil_tecnico_ia`.
6. **Integrações:** Gemini (+ fallback); GitHub (verificação, PRO).
7. **Regras:**
   - **Limites:** Free = 1 roadmap ativo e regeneração a cada 30 dias; PRO = 5 ativos e 7 dias. Roadmap cuja origem é `modelo` (IA caiu) **pode regenerar na hora**. Bloqueio devolve **402** com link para `/planos`.
   - **IA:** 3–5 fases, 3–6 etapas por fase, 1 projeto por fase; JSON validado manualmente; até 2 tentativas **só** se o JSON veio inválido; qualquer outro erro vai direto ao modelo estático. Recursos de estudo vêm **da tabela `recursos`** (a IA não inventa links); sem recurso, registra em `recursos_pendentes`.
   - **Regeneração:** preserva etapas já concluídas (por nome de habilidade) e incrementa `versao`.
   - **Projeto da fase:** **PRO** → verifica o repositório (existe, é público, as habilidades verificáveis aparecem) → `verificado` ou `em_revisao` (nunca "reprovado"); **Free** → fecha por autodeclaração com selo `nao_verificado`. Sem habilidade verificável, também fecha como não verificada. GitHub fora do ar → `indisponivel`, sem alterar nada.
   - Etapa: status ∈ {pendente, em_andamento, concluida}.
8. **Limitações:** o limite máximo de ativos é textual fixo ("até 5") na mensagem de `roadmapLimites.js`. `criar` aceita `horasSemana` sem limite superior ⚠️ A confirmar. Em `regenerar`, falha devolve texto simples (não a tela amigável). A lista de habilidades do projeto não é salva (usa as habilidades das etapas). Documentos de apoio: `docs/roadmap-spec.md`, `docs/roadmap-diagnostico.md`.

### 7.10 Roadmap — sistema ANTIGO por vaga (`/roadmap?job=ID`) e "Meu progresso"

1. **O que é:** sistema original: para uma vaga, mostra skills que o dev **já tem** e as que **faltam**, com recursos cadastrados e status por skill. "Meu progresso" (`/meu-progresso`) lista as vagas que o dev já começou a acompanhar.
2. **Passo a passo:** a partir de uma vaga (ou de `/meu-progresso`) abre `/roadmap?job=<id>`; marca cada skill como não iniciado/em progresso/concluído; vê a distribuição de linguagens dos repositórios.
3. **Rotas:** páginas `GET /roadmap` 👨‍💻 e `GET /meu-progresso` 👨‍💻; API `GET /api/roadmap/:jobId` 🔑, `PATCH /api/roadmap/:jobId/skill/:skillId` 🔑, `GET /api/dashboard` 🔑, `GET /api/user/languages` 🔑.
4. **Fluxo:** `roadmap.ejs`/`progresso.ejs` → `routes/roadmap.js` → `roadmapController` → `services/roadmapGenerator.generateRoadmap` + `matchCalculator.calculateJobMatch` (+ IA para motivos, só PRO).
5. **Tabelas:** `user_roadmap_progress`, `job_skills`, `skills`, `skill_resources`, `user_skills`, `user_repositories`.
6. **Integrações:** Gemini (enriquecimento, PRO).
7. **Regras:** **Free** vê as skills que faltam, mas **sem recursos** (`locked`); **PRO** vê recursos e motivo gerado por IA (falha da IA não quebra a tela). Exige `github_id` (400 "Conecte seu GitHub"). Status válido: `nao_iniciado/em_progresso/concluido`. Ao atualizar, responde o novo match.
8. **Limitações:** coexiste com o sistema novo (o menu "Roadmap" aponta para `/trilha`, enquanto `/meu-progresso` ainda aponta para `/roadmap?job=`). Dev **sem GitHub** não acessa o roadmap antigo. As rotas de API não checam se o `type` é dev (apenas logado) ⚠️ A confirmar impacto.

### 7.11 Mentor de carreira (e simulação de entrevista) — PRO

1. **O que é:** chat com IA que ajuda na carreira, portfólio e estudos, e **simula entrevistas técnicas**. Exclusivo do plano **PRO**.
2. **Passo a passo:** `/mentor` → escreve a mensagem (até 2000 caracteres) e, opcionalmente, anexa **PDF, .txt ou .md** (até 2 MB) → recebe a resposta. `/entrevista` apenas redireciona para `/mentor`.
3. **Rotas:** `GET /mentor` 👨‍💻 (empresa é redirecionada), `GET /api/ai/mentor/historico` 👨‍💻 PRO, `POST /api/ai/mentor/mensagem` 👨‍💻 PRO (multipart).
4. **Fluxo:** `mentor.ejs` → `routes/ai.js` (`isAuth` → `requireDevType` → `requireFeature("mentor_carreira")` → multer em memória → validação) → `fileTextExtractor.extractText` → `mentorChat.sendMessage` → `geminiClient.chatTurn` → ferramentas `aiTools.executeTool` → `sendFunctionResults` (até 4 rodadas) → grava em `mentor_conversas`.
5. **Tabelas:** `mentor_conversas`, `user_skills`, `user_dev_profiles`, `jobs`, `job_skills`, `user_repositories`, `roadmaps…`.
6. **Integrações:** Gemini (obrigatório; sem fallback). Ferramentas disponíveis à IA: `buscarVagas`, `buscarPerfilUsuario`, `buscarPortfolio`, `buscarRoadmap`, `analisarCompatibilidadeVaga`, `buscarRequisitosVaga`.
7. **Regras:** gate de plano → **402**; tipo de conta ≠ dev → **403**; arquivo > 2 MB ou formato inválido → 400; texto extraído limitado a **4000 caracteres**; a identidade do usuário **vem da sessão**, nunca dos argumentos que a IA gera; histórico **é apagado a cada login** (decisão de produto, explícita no código); falha da IA → 502.
8. **Limitações:** sem fallback de provedor; "Google Search" e "File Search/RAG" estão apenas como TODO comentado em `aiTools.js`; o PDF é lido inteiro em memória (limite 2 MB).

### 7.12 Insights de mercado (IA)

1. **O que é:** página pública com um resumo, gerado por IA, das tecnologias mais pedidas nas vagas ativas.
2. **Uso:** abrir `/insights-mercado` (link acessível a todos).
3. **Rotas:** `GET /insights-mercado` 🌐 (SSR com o último cache), `GET /api/ai/insights-mercado` 🌐.
4. **Fluxo:** `insights-mercado.ejs` → `routes/ai.js` → `marketInsights.getInsightsFreshOrCached` → `generateInsights` → `askGeminiJSON`.
5. **Tabelas:** `mercado_insights`, `job_skills`, `skills`, `jobs`.
6. **Integrações:** Gemini (+ fallback).
7. **Regras:** cache de **24 h**, regenerado sob demanda (sem cron); se a regeneração falhar serve o cache velho; um **lock em memória** impede N chamadas simultâneas pagas (QA-005); considera as 15 skills mais frequentes; sem vagas com skills → 404 com mensagem amigável.
8. **Limitações:** o lock é por processo (não funcionaria com várias instâncias); rota pública sem login, limitada só pelo rate limit de IA.

### 7.13 Painel da empresa, vagas e candidaturas

1. **O que é:** a empresa vê indicadores, **cria/edita/ativa/desativa/exclui vagas**, define as skills de cada uma e vê quem se candidatou (com **resumo por IA** no Premium).
2. **Passo a passo:** `/empresa/dashboard` (resumo) → `/empresa/vagas` (gerenciar) → **Nova vaga** (`/empresa/vagas/nova`: título, nível, descrição, modalidade, contrato, salário, local, experiência, inglês, responsabilidades, benefícios, tags e skills obrigatórias/desejáveis) → **Editar** (`/empresa/vagas/:id/editar`) → **Candidaturas** (`/empresa/vagas/:id/candidaturas`).
3. **Rotas:** páginas 🏢 `/empresa/dashboard`, `/empresa/vagas`, `/empresa/vagas/nova`, `/empresa/vagas/:id/editar`, `/empresa/vagas/:id/candidaturas`. API 🏢 (`isEmpresa`): `GET /api/empresa/dashboard`, `GET /api/empresa/skills`, `POST /api/empresa/jobs`, `PATCH /api/empresa/jobs/:id`, `DELETE /api/empresa/jobs/:id`, `GET`/`PUT /api/empresa/jobs/:id/skills`, `GET /api/empresa/jobs/:id/candidaturas`, `POST /api/empresa/candidaturas/:id/resumo-ia` (**Premium**).
4. **Fluxo:** views `empresa-*.ejs` → `routes/empresa.js` → `validators/job.validator.js` → `empresaController` → `subscriptionService.canCreateJob/getUserPlan`, `candidateSummarizer.getOrGenerateSummary` → MySQL / Gemini.
5. **Tabelas:** `jobs`, `job_skills`, `job_applications`, `user_company_profiles`, `user_roadmap_progress`, `user_dev_profiles`, `user_skills`, `user_repositories`.
6. **Integrações:** Gemini (resumo Premium).
7. **Regras:** título 3–200; nível ∈ {estagio, junior, pleno}; descrição ≤2000; `modality`, `contract_type`, `english_level` por lista; salários inteiros ≥0 e `salary_max ≥ salary_min`; `years_experience`, `max_candidates` inteiros ≥0 (QA-010). **Limite de vagas ativas pelo plano** (Free 1 / Básico 3 / Premium ilimitado) — criar ativa ou **reativar** acima do limite devolve **402**. Só a empresa dona edita/exclui (404 caso contrário). Excluir vaga remove em cascata `job_skills`, candidaturas, progresso etc. `jobs.company` guarda o **nome da empresa na hora da criação**. O resumo IA usa só skills (com confiança) e repositórios públicos — nunca nome/e-mail — e é **cacheado** em `job_applications.resumo_ia`. Plano de empresa não-Premium no resumo → 402 (`requirePlan`).
8. **Limitações:** `updateJobSkills` apaga e recria todas as skills **sem validar** o conteúdo do array (`skill_id`/`importance`); `jobs.company` não acompanha mudança posterior do nome fantasia; `max_candidates` não é aplicado (ver 7.5); `location`, `responsibilities`, `benefits`, `tags` não têm validação de tamanho no validador ⚠️ A confirmar contra o limite das colunas.

### 7.14 Devs compatíveis, matchs e perfil do dev (visão da empresa)

1. **O que é:** a empresa vê desenvolvedores, os **matchs** por vaga (aceitar/recusar) e o perfil detalhado de cada dev.
2. **Passo a passo:** `/empresa/desenvolvedores` (lista com skills, progresso, match, selo PRO) → clica no dev (`/empresa/dev/:id`) → pode **iniciar conversa**; `/empresa/matchs` lista pares dev×vaga ordenados por score, com **Aceitar/Recusar**.
3. **Rotas:** páginas 🏢 `/empresa/desenvolvedores`, `/empresa/matchs`, `/empresa/dev/:id`; API 🏢 `GET /api/empresa/matchs`, `PATCH /api/empresa/matchs/:devGithubId/:jobId` (body `{action}`), `GET /api/empresa/desenvolvedores`, `GET /api/empresa/dev/:id`.
4. **Fluxo:** views → `routes/empresa.js` → `empresaController.getMatchs/updateMatchAction/getDesenvolvedores/getDevProfile` → `matchCalculator.computeMatch` + `subscriptionService.getPlanCodesBulk`.
5. **Tabelas:** `user_dev_profiles`, `user_skills`, `skills`, `jobs`, `job_skills`, `company_match_actions`, `user_roadmap_progress`.
6. **Integrações:** nenhuma.
7. **Regras:** só entram devs com `github_id` não nulo; match só para vagas **ativas** da empresa e que tenham skills; pares com 0 skills em comum são omitidos; `action` ∈ {aceito, recusado}; ação só em vaga da própria empresa; `isPro` marca devs PRO.
8. **Limitações:** **devs que se cadastraram só por e-mail (sem GitHub) nunca aparecem** para a empresa. A lista calcula tudo em memória para **todos** os devs a cada chamada (sem paginação) — pode ficar lenta com muitos usuários. A ação aceito/recusado **não notifica o dev** ⚠️ A confirmar (não encontrei notificação).

### 7.15 Perfil da empresa

1. **O que é:** dados cadastrais e públicos da empresa e lista das últimas vagas, plano atual.
2. **Uso:** `/empresa/perfil` → edita nome fantasia, setor, tamanho, site, descrição (≤1000), cidade, estado (2 letras) → salva.
3. **Rotas:** `GET /empresa/perfil` 🏢; `GET`/`PATCH /api/empresa/profile` 🏢; `GET /api/empresas/:id` 🔑 (perfil resumido usado no chat do dev).
4. **Fluxo:** `perfil-empresa.ejs` → `empresaController.getProfile/updateProfile/getPublicProfile`.
5. **Tabelas:** `users`, `user_company_profiles`, `jobs`.
6. **Integrações:** nenhuma.
7. **Regras:** nome fantasia não pode ficar vazio; razão social e CNPJ **não são editáveis** por esta rota.
8. **Limitações:** `setor`/`tamanho` no `PATCH` não são validados contra as listas do cadastro; o `ENUM` de `tamanho` pode gerar 500 com valor inválido ⚠️ A confirmar.

### 7.16 Mensagens (chat dev ↔ empresa)

1. **O que é:** conversas entre dev e empresa, opcionalmente ligadas a uma vaga, com contador de não lidas.
2. **Passo a passo:** `/mensagens` (dev) ou `/empresa/mensagens` (empresa) → lista de conversas → **Nova conversa** (dev escolhe uma vaga; empresa parte do perfil de um dev) → troca mensagens; o painel lateral mostra dados da contraparte; o ícone no cabeçalho mostra o total não lido.
3. **Rotas** (todas 🔑): `GET /api/messages/unread-count`, `GET`/`POST /api/messages/conversations`, `GET /api/messages/conversations/:id`, `POST /api/messages/conversations/:id/messages`, `PATCH /api/messages/conversations/:id/read`; páginas `GET /mensagens` (dev) e `GET /empresa/mensagens` (empresa).
4. **Fluxo:** `mensagens.ejs`/`empresa-mensagens.ejs` → `routes/messages.js` (`router.use(isAuth)`) → `messagesController`.
5. **Tabelas:** `conversations`, `messages`, `jobs`, `user_dev_profiles`, `user_company_profiles`, `users`.
6. **Integrações:** nenhuma.
7. **Regras:** só os dois lados da conversa acessam (`ownsConversation` → senão 404); **mensagem ≤4000** caracteres e não vazia; conversa deduplicada por (dev, empresa, vaga) com `<=>` (NULL-safe); dev inicia por `company_id` ou `job_id`; empresa inicia com `dev_github_id` (dev precisa existir). Marcar como lida afeta só mensagens **da outra parte**. O front ignora respostas atrasadas ao trocar de conversa (QA-012).
8. **Limitações:** **não é tempo real**: sem WebSocket; ⚠️ A confirmar se há *polling* nas views. Sem exclusão/edição de mensagens e sem anexos. Admin não participa. Dev **sem GitHub** usa o `user_id` como `dev_github_id` — a empresa só consegue iniciar conversa com devs que têm `github_id` (ver 7.14).

### 7.17 Painel do administrador

1. **O que é:** gestão da plataforma: indicadores, usuários, empresas, vagas, matchs, relatórios e catálogo de skills/recursos.
2. **Passo a passo:** o admin entra em `/login` com a conta criada por `seed-admin.js` → `/admin/dashboard`. Menu: **Usuários**, **Empresas** (suspender/reativar e trocar plano), **Vagas** (ativar/desativar), **Matchs** (score ≥70), **Relatórios** (cadastros por semana, skills populares, vagas por nível, candidaturas por vaga), **Configurações** (CRUD de skills e de recursos de estudo).
3. **Rotas:** páginas 🛡️ `/admin/{dashboard,usuarios,empresas,vagas,matchs,relatorios,configuracoes}`; API 🛡️ (`router.use(isAdmin)`): `GET /api/admin/dashboard`, `GET /users`, `PATCH /users/:id`, `PATCH /users/:id/plan`, `GET /empresas`, `PATCH /empresas/:id`, `PATCH /empresas/:id/plan`, `GET /jobs`, `PATCH /jobs/:id`, `GET /matches`, `GET /reports`, `GET`/`POST /skills`, `PATCH`/`DELETE /skills/:id`, `GET`/`POST /skills/:id/resources`, `DELETE /skills/:id/resources/:resourceId`.
4. **Fluxo:** `admin-*.ejs` + `partials/header-admin.ejs` → `routes/admin.js` → `adminController` → `subscriptionService.setUserPlan`.
5. **Tabelas:** praticamente todas (leitura) + `users.active`, `jobs.active`, `user_subscriptions`, `skills`, `skill_resources`.
6. **Integrações:** nenhuma.
7. **Regras:** `type` da skill ∈ {hard, soft}; tipo de recurso ∈ {curso, video, documentacao, projeto}; plano validado contra os planos do tipo da conta; suspender só afeta contas do tipo certo. **Liberar PRO sem pagamento** é feito aqui (não há variável de ambiente para isso). A lista de usuários/empresas avisa sobre **"outras contas"** prováveis da mesma pessoa/empresa (mesmo login GitHub; mesmo CNPJ ou nome).
8. **Limitações:** o log do repositório (commit "troca de plano de empresa avisa e aplica nas outras contas da mesma empresa") sugere um comportamento que **não vi no controller** — pode estar no JS de `admin-empresas.ejs` ⚠️ A confirmar. Excluir skill apaga em cascata `job_skills`/`user_skills` (efeito amplo, sem confirmação no servidor). Painel não tem log de auditoria.

### 7.18 Planos e assinatura paga (Mercado Pago)

1. **O que é:** assinatura mensal recorrente (cartão de crédito) para PRO (dev) e Básico/Premium (empresa). O cartão é digitado num componente do Mercado Pago (Card Payment Brick) — **os dados do cartão nunca passam pelo servidor do Ápice**; o servidor só recebe um *token*.
2. **Passo a passo:** `/planos` mostra os planos do seu tipo → **Assinar** (`/planos/:id/assinar`) → preenche o cartão → resultado em `/assinatura/retorno` (ativa, pendente, pausada ou recusada com motivo e botão "tentar de novo"). Em `/minha-assinatura` vê status, próximas cobranças, histórico de pagamentos, **troca o cartão**, **troca de plano** ou **cancela**.
3. **Rotas:** páginas `GET /planos` 🔑 (admin é redirecionado), `GET /planos/:id/assinar` (faz o próprio redirect para login), `GET /assinatura/retorno`, `GET /minha-assinatura` 🔑; API 🔑 `GET /api/plans`, `POST /api/assinaturas`, `GET /api/assinaturas/minha[?sync=1]`, `PUT /api/assinaturas/cancelar`, `PUT /api/assinaturas/cartao`, `PUT /api/assinaturas/plano`; **webhook** `POST /webhooks/mercadopago` 🌐 (120 req/min).
4. **Fluxo:** `planos.ejs`/`assinar.ejs`/`minha-assinatura.ejs`/`assinatura-resultado.ejs` + `public/js/assinatura-checkout.js` (SDK MP) → `routes/assinaturas.js`/`plans.js` → `assinaturasController` → `services/mpSubscriptions.js` (regras) → `services/mercadoPago.js` (**único** arquivo que chama o SDK) → API do Mercado Pago. Webhook: valida `x-signature` (se `MP_WEBHOOK_SECRET` existir), responde 200 rápido e processa em segundo plano (`processNotification`: `subscription_preapproval`, `subscription_authorized_payment`, `payment`). Na subida do servidor, `mpPlanSync.syncPlansOnStartup()` cria/atualiza os planos no MP (idempotente). CSP específica das páginas de checkout: `middlewares/mpCheckoutCsp.js`.
5. **Tabelas:** `subscriptions`, `subscription_payments`, `mp_plans`, `user_subscriptions`.
6. **Integrações:** Mercado Pago (`MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, `APP_BASE_URL`/`APP_URL`, `MP_TEST_PAYER_EMAIL`); passo a passo completo em `docs/ASSINATURAS.md`.
7. **Regras:** **preço e plano vêm sempre de `config/plans.js`**, nunca do front; status e dados sempre **buscados na API do MP** (nunca confiados do corpo do webhook); escrita idempotente por ID do MP; **uma assinatura aberta por usuário** (lock `GET_LOCK` por usuário; duplicadas são canceladas no MP); plano precisa ser do tipo da conta; troca de plano = **cria nova** assinatura e cancela a atual (acesso continua até o fim do período pago — "melhor plano vale"); erros do MP traduzidos por `mpMessages.js`; sem credenciais → 503 "Assinaturas temporariamente indisponíveis"; timeout/5xx na criação procura a assinatura recém-criada antes de falhar (evita cobrança dupla).
8. **Limitações:** `localhost` não é aceito como `back_url` pelo MP (usa fallback `https://www.mercadopago.com.br`); sem `MP_WEBHOOK_SECRET` os webhooks são aceitos sem validar assinatura (só avisa em produção); só cartão de crédito, só mensal; `subscriptions.user_id` usa `ON DELETE RESTRICT` (não dá para apagar usuário com assinatura sem cancelar antes). O controle de reconciliação tem intervalo mínimo de 10 s por usuário.

### 7.19 Acessibilidade, SEO e segurança transversais

- **Acessibilidade:** `public/js/accessibility.js` (modo escuro e alto contraste via `localStorage`), skip-link, `<main>`, ARIA e foco tratados pelo backlog QA (`CLAUDE.md`).
- **SEO:** `robots.txt`, `sitemap.xml`, metatags/Open Graph, JSON-LD de vaga; `/vagas`, `/vagas/:id` e `/insights-mercado` já saem com conteúdo do servidor.
- **Segurança:** CSP via `helmet`; `escapeHtml()` (`public/js/escape-html.js`) em campos dinâmicos; rate limit; logout por POST; reset de senha com link montado por `APP_URL`; validações do `express-validator`; erro 404/500 renderizam `views/404.ejs`/`500.ejs` (JSON se a requisição não aceita HTML).
- **Observação:** a CSP libera `'unsafe-inline'` para scripts/estilos (as views usam JS e `onclick` inline).

---

## 8. Lista de rotas (resumo)

**Páginas (GET)** — 🌐 `/`, `/login`*, `/cadastro`, `/esqueci-senha`, `/redefinir-senha`, `/vagas`, `/vagas/:id`, `/para-devs`, `/para-empresas`, `/sobre`, `/insights-mercado`, `/assinatura/retorno`*, `/planos/:id/assinar`* · 👨‍💻 `/dashboard`, `/meu-progresso`, `/repositorios`, `/roadmap`, `/mensagens`, `/mentor`, `/trilha*`, `/perfil` · 🏢 `/empresa/{dashboard,vagas,vagas/nova,vagas/:id/editar,vagas/:id/candidaturas,desenvolvedores,matchs,mensagens,dev/:id,perfil}` · 🔑 `/planos`, `/minha-assinatura` · 🛡️ `/admin/*` · `/entrevista` → redireciona a `/mentor`. (*redirecionam conforme login.)

**API** — prefixos: `/api/auth` (cadastro/login/senha) · `/auth` (GitHub, logout) · `/api/user` (perfil + repositórios) · `/api` (vagas, candidatura, roadmap antigo, dashboard, languages) · `/api/empresa` · `/api/empresas/:id` · `/api/messages` · `/api/admin` · `/api/ai` · `/api/plans` · `/api/assinaturas` · `/webhooks/mercadopago` · `/api/user` (GET, sessão atual sem token, definido em `server.js`).

Sobre `/api/ai/health` 🔑: testa se a chave/modelo de IA funciona (para configurar o Render; não é um endpoint de monitoramento).

---

## 9. Limitações e pontos de atenção gerais

1. **Anthropic não é usada** — a IA é Gemini + provedores de fallback (ver topo).
2. **Schema fragmentado:** `script_bd.sql` desatualizado; parte vive em `db.js` e em `migrations/`. Quem montar o banco do zero precisa seguir a seção 3/5.
3. **Dois sistemas de roadmap** coexistem (`/roadmap` antigo e `/trilha` novo), com links misturados.
4. **`github_id` vs `user_id`** misturados na mesma coluna (seção 5.3); devs sem GitHub ficam fora de matchs e de conversas iniciadas pela empresa.
5. **Sem paginação** nas listas de matchs/devs da empresa e nas vagas do dashboard; cálculo em memória.
6. **Mensagens sem tempo real** ⚠️ A confirmar se há polling.
7. **`jobs.max_candidates` e `perfil_tecnico_ia`** têm uso incompleto/não confirmado.
8. **Suspensão e troca de senha não derrubam sessões** já abertas ⚠️ A confirmar.
9. **Cadastro de empresa:** ordem das operações pode deixar um `users` órfão quando o CNPJ já existe ⚠️ A confirmar.
10. **`landing/`** é uma página estática antiga fora do fluxo do `server.js` ⚠️ A confirmar se ainda é publicada.
11. **Credenciais:** consta na memória do projeto que **credenciais já apareceram no histórico do git** e a rotação ainda estava pendente — trate chaves do `.env` como comprometidas até serem trocadas.
12. Testes: `npm test` roda Jest; a pasta `tests/qa/` tem um teste por achado do backlog `CLAUDE.md`. `tests/visual/` e `tests/funcoes/` ficam fora do git (contêm dados reais).

---

## 10. Glossário

| Termo | Significado |
|---|---|
| **API / endpoint** | URL que devolve dados (JSON) em vez de uma página. |
| **EJS** | Linguagem de template: HTML com trechos `<% %>` preenchidos no servidor. |
| **Middleware** | Função que roda *antes* do controller (ex.: checar login). |
| **Controller** | Código que atende uma rota e monta a resposta. |
| **Service** | Código de regra de negócio reaproveitado por vários controllers. |
| **Sessão** | "Memória" do servidor sobre quem está logado, ligada a um cookie. |
| **OAuth** | Padrão para "entrar com GitHub" sem compartilhar a senha. |
| **CSP** | *Content Security Policy*: lista do que o navegador pode carregar/executar. |
| **XSS** | Ataque que injeta script via texto; combatido com `escapeHtml()`. |
| **Rate limit** | Limite de requisições por tempo. |
| **Skill** | Habilidade técnica (hard) ou comportamental (soft) do catálogo. |
| **Confiança (confidence)** | Nota 0–100 de quanto o dev domina uma skill. |
| **Match** | % de compatibilidade dev × vaga (85% skills + 15% senioridade). |
| **Gap** | Diferença entre o que o dev sabe e o que o objetivo exige. |
| **Roadmap / Trilha** | Plano de estudos; novo = fases/etapas/projeto. |
| **Fase / Etapa** | Fase agrupa etapas de estudo e termina num projeto prático. |
| **Gemini** | IA do Google usada como provedor principal. |
| **Fallback** | Plano B: se o Gemini falha, tenta outros provedores. |
| **Function calling** | A IA pede ao servidor para executar uma função (ex.: buscar vagas). |
| **PRO / Premium / Básico / Free** | Planos pagos e gratuitos (seção 6.2). |
| **Preapproval (MP)** | "Assinatura recorrente" no Mercado Pago. |
| **Webhook** | Aviso que o Mercado Pago envia ao servidor quando algo muda. |
| **Brick** | Componente pronto do Mercado Pago para digitar o cartão. |
| **Token do cartão** | Código de uso único que representa o cartão, sem expor os dados. |
| **LGPD** | Lei de proteção de dados; por isso os prompts evitam dados pessoais. |
| **SSR** | Página montada no servidor (bom para SEO). |
| **Seed** | Script que insere dados iniciais no banco. |
| **Migração** | Script que cria/altera tabelas do banco. |
| **QA-0XX** | Identificador de um achado da auditoria de qualidade (`CLAUDE.md`). |
