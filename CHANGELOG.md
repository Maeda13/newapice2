# Changelog — Ápice

Documentação das melhorias realizadas no projeto após auditoria técnica completa.

---

## Fase 1 — Correções Críticas

> Foco: segurança, estabilidade e limpeza da base de código.

### Segurança

**Cabeçalhos HTTP com Helmet**
- Instalado e configurado o pacote `helmet` em `server.js`
- Habilitados: Content Security Policy (CSP), X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy
- CSP definida com fontes explícitas: `self`, Google Fonts, avatars do GitHub
- `crossOriginEmbedderPolicy` desativado para compatibilidade com o GitHub OAuth

**Rate Limiting**
- Instalado e configurado o pacote `express-rate-limit`
- Limiter aplicado nas rotas `/api/auth`: 20 requisições por janela de 15 minutos
- Respostas de bloqueio padronizadas em JSON com mensagem amigável

**Cookie de Sessão Seguro**
- `httpOnly: true` — impede acesso via JavaScript ao cookie de sessão
- `secure: true` apenas em produção (`NODE_ENV === "production"`)
- `sameSite: "lax"` — proteção contra CSRF
- `maxAge: 24h` — expiração explícita

**Handler de JSON Malformado**
- Adicionado middleware de erro para `entity.parse.failed`
- Retorna HTTP 400 com mensagem padronizada em vez de crash 500

**Mensagens de erro genéricas**
- Removidas todas as exposições de `err.message` nas respostas HTTP de `empresaController.js` e `roadmapController.js`
- Logs internos mantidos via `console.error` com prefixo de rota
- Respostas ao cliente substituídas por `"Erro interno. Tente novamente."`

### Estabilidade

**`session.destroy()` com callback** — `authController.js`
- Corrigida chamada assíncrona sem callback que causava erro silencioso no logout
- Adicionado log de erro caso a destruição da sessão falhe

**`deleteJob` com try/catch completo** — `empresaController.js`
- A primeira query de verificação de ownership estava fora do bloco try/catch
- Envolvida em um único bloco que cobre todo o método

**Função `getUserId` duplicada removida** — `roadmapController.js`
- Função `getUserId` estava declarada duas vezes identicamente
- Mantida uma única declaração com comentário explicativo

**Filtro `WHERE active = 1`**
- Vagas inativas não aparecem mais no dashboard do desenvolvedor nem na listagem pública
- Aplicado em `server.js` (rota `/dashboard`) e `roadmapController.js` (`listJobs`, `listJobsWithDetails`)

### Validações

**Validators aplicados nas rotas de vagas** — `routes/empresa.js`
- `validateCreateJob` e `validateUpdateJob` existiam em `validators/job.vlidator.js` mas nunca eram importados
- Importados e aplicados nas rotas `POST /jobs`, `PATCH /jobs/:id`
- `jobIdParam` aplicado nas rotas que recebem `:id`

### UX e Identidade Visual

**Padronização da marca "Ápice"**
- Todas as ocorrências de "Dev Estágios" foram substituídas por "Ápice" em todos os arquivos `.ejs`
- Títulos de página (`<title>`), meta descriptions, Open Graph tags, footers e textos internos
- Arquivos afetados: `login.ejs`, `cadastro.ejs`, `roadmap.ejs`, `progresso.ejs`, `empresa-vagas.ejs`, `empresa-dashboard.ejs`, `vagas.ejs`, `empresa-vaga-form.ejs`, `vaga-publica.ejs`

**Páginas de erro customizadas**
- Criados `views/404.ejs` e `views/500.ejs` com design consistente com o sistema
- Substituem as respostas genéricas padrão do Express
- Incluem navegação de recuperação (voltar, ir para o início, ver vagas)
- Handler 404 diferencia requisições HTML de requisições de API (JSON vs render)

### Limpeza

**10 arquivos mortos removidos**
- `public/views/cadastro.html`
- `public/views/dashboard.html`
- `public/views/empresa-dashboard.html`
- `public/views/index.html`
- `public/views/login.html`
- `public/views/perfil.html`
- `public/views/progresso.html`
- `public/views/roadmap.html`
- `public/views/vagas.html`
- `public/css/teste.css`

**`.env.example` criado**
- Documenta todas as variáveis de ambiente necessárias sem valores reais
- Inclui instrução para gerar `SESSION_SECRET` seguro via `crypto.randomBytes`

---

## Fase 2 — Substituição de Dados Mock por API Real

> Foco: as duas páginas centrais do fluxo de empresa usavam arrays JavaScript hardcoded em vez de dados reais do banco.

### Problema

`empresa-matchs.ejs` e `empresa-desenvolvedores.ejs` carregavam dados de arrays `MOCK_MATCHS` e `MOCK_DEVS` definidos diretamente no JavaScript do frontend, tornando as páginas não funcionais com dados reais.

### Solução

**Migration SQL** — `config/migration_v2.sql`
- Adicionada coluna `github_id BIGINT` na tabela `user_dev_profiles` para vincular perfil de dev ao ID numérico do GitHub
- Criada tabela `company_match_actions` para persistir ações de aceitar/recusar match por empresa

**API de Matchs** — `GET /api/empresa/matchs`
- Novo método `getMatchs` em `empresaController.js`
- Busca todas as vagas ativas da empresa
- Busca todos os desenvolvedores com `github_id` vinculado
- Carrega skills de cada dev e de cada vaga
- Calcula score de compatibilidade usando `computeSkillScore` (ponderação por obrigatória/desejável)
- Aplica ações salvas (aceito/recusado) de `company_match_actions`
- Retorna lista ordenada por score decrescente

**API de Ação de Match** — `PATCH /api/empresa/matchs/:devGithubId/:jobId`
- Novo método `updateMatchAction` em `empresaController.js`
- Persiste ação (aceito/recusado) na tabela `company_match_actions` via `INSERT ... ON DUPLICATE KEY UPDATE`
- Valida ownership da vaga antes de salvar

**API de Desenvolvedores** — `GET /api/empresa/desenvolvedores`
- Novo método `getDesenvolvedores` em `empresaController.js`
- Retorna todos os devs com: nome, GitHub, nível, lista de skills (nomes), melhor score de match com vagas da empresa, progresso em roadmaps
- Calcula métricas de "em roadmap ativo" e "roadmap concluído"

**Frontend atualizado**
- `empresa-matchs.ejs`: removido `MOCK_MATCHS`, substituído por `fetch("/api/empresa/matchs")`
- `empresa-desenvolvedores.ejs`: removido `MOCK_DEVS`, substituído por `fetch("/api/empresa/desenvolvedores")`
- Botões "Aceitar" e "Recusar" agora fazem `PATCH` na API e persistem no banco
- Estado dos botões reflete a ação salva ao carregar a página

---

## Fase 3 — Melhorias de Qualidade e Perfil do Desenvolvedor

> Foco: fechar exposições de segurança residuais, corrigir bug de performance e implementar a funcionalidade "Ver Perfil".

### Segurança

**`err.message` residuais corrigidos** — `roadmapController.js`
- 5 métodos ainda expunham o erro interno na resposta HTTP
- Métodos corrigidos: `listJobsWithDetails`, `getRoadmap`, `updateSkillStatus`, `getPublicJob`, `getDashboard`
- Padrão aplicado: `console.error("[ROTA]", err.message)` + `res.status(500).json({ error: "Erro interno. Tente novamente." })`

**Bug de query no `getDashboard`** — `roadmapController.js`
- A versão do remoto tinha `WHERE urp.github_id = ?` em uma query com `LEFT JOIN`, transformando-o efetivamente em `INNER JOIN`
- Restaurada a cláusula `HAVING COUNT(urp.github_id) > 0` que filtra corretamente apenas roadmaps com progresso

### Performance

**`connectionLimit` do pool MySQL** — `database/db.js`
- Valor anterior: `1` — causava serialização de todas as queries (uma por vez)
- Valor novo: `5` — permite até 5 conexões concorrentes
- `maxIdle` atualizado de `1` para `5` de forma consistente

### Funcionalidade

**Página de Perfil do Desenvolvedor (visão da empresa)**

*Backend* — `empresaController.js` + `routes/empresa.js`
- Novo método `getDevProfile` que recebe o `user_id` interno do dev
- Retorna: nome completo, GitHub, nível, lista de skills com confidence, melhor score de match com vagas da empresa, título da vaga com maior compatibilidade, progresso em roadmaps
- Rota adicionada: `GET /api/empresa/dev/:id`
- Validação de ID inválido (retorna 400) e dev não encontrado (retorna 404)

*Rota de página* — `server.js`
- Adicionada rota `GET /empresa/dev/:id` que renderiza `perfil-dev-empresa.ejs`
- Validação de ID antes de renderizar, com redirect para lista se inválido

*Nova view* — `views/perfil-dev-empresa.ejs`
- Página completa com sidebar da empresa
- Hero card com avatar colorido gerado por gradiente, nome, link GitHub, nível, badge da vaga mais compatível e score de match
- Seção de skills com barras de progresso animadas e percentual de confidence
- Seção de progresso em roadmaps (visível apenas se o dev tiver progresso)
- Estado de loading e estado de erro com mensagem e link de volta

*Frontend atualizado*
- `empresa-desenvolvedores.ejs`: `verPerfil(id)` navega para `/empresa/dev/:id`
- `empresa-matchs.ejs`: `verPerfil(devId)` navega para `/empresa/dev/:id`
- Substituídas as chamadas de toast "em breve" pelas navegações reais

### Favicon

**Adicionado em todos os views**
- `<link rel="icon" type="image/webp" href="/img/principal-gradiente.webp" />` inserido no `<head>` de todos os arquivos `.ejs`
- Unificado com a contribuição do colaborador remoto (Maeda13)

---

## Fase 4 — Auditoria pré-lançamento: segurança, consistência e recuperação de senha

> Foco: itens levantados numa auditoria completa do site (backend, banco, git, frontend) feita antes do lançamento. Cobre desde vulnerabilidades exploráveis até funcionalidade essencial que faltava.

### Segurança

**Upload de avatar permitia gravar HTML/script no domínio do site (XSS armazenado)** — `controllers/profileController.js`
- A extensão do arquivo salvo vinha de `path.extname(file.originalname)` — nome de arquivo enviado pelo cliente, totalmente falsificável — enquanto só o `mimetype` (também falsificável) era validado
- Um request malicioso com `Content-Type: image/jpeg` e `filename="x.html"` conseguia gravar um `.html` de verdade em `public/uploads/avatars/`, servido estaticamente no mesmo domínio; como o CSP libera `'unsafe-inline'` em `scriptSrc`, esse HTML executava script no mesmo domínio
- Corrigido: a extensão agora vem de uma tabela fixa `mimetype → extensão` (`MIME_TO_EXT`), nunca do nome enviado pelo cliente — mesmo que o mimetype seja falsificado, o arquivo salvo sempre tem extensão de imagem, e o `X-Content-Type-Options: nosniff` do Helmet impede o navegador de executar o conteúdo como HTML

**`.env.example` continha segredos reais, não placeholders**
- O arquivo estava com `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `DB_HOST/PORT/NAME/USER/PASS` preenchidos com valores reais (uma cópia antiga do `.env`), e ainda estava listado no `.gitignore` — ou seja, nunca tinha sido commitado, mas corria o risco de ser commitado a qualquer momento com segredos reais dentro
- Reescrito com placeholders vazios/de exemplo; removido do `.gitignore` e adicionado ao versionamento de fato

**O próprio `.gitignore` nunca tinha sido commitado**
- Ele listava a si mesmo (`.gitignore`) como um dos padrões ignorados — por isso `git add -A`/`git add .` nunca conseguia incluí-lo no repositório, mesmo já existindo no disco há tempo
- Na prática, qualquer outro clone do repositório (outra máquina, outro colaborador, CI) ficava **sem nenhuma proteção** contra commitar `.env`, `node_modules/` ou `package-lock.json` por engano
- Corrigido: removida a linha autorreferente e commitado (`git add -f .gitignore`) de fato pela primeira vez

**Login com GitHub podia sequestrar uma conta empresa para uma sessão "dev"** — `controllers/authController.js`
- O callback do OAuth buscava usuário existente só por e-mail, sem checar `type`, e sempre montava a sessão com `type: "dev"` fixo
- Se o e-mail de uma conta empresa colidisse com o e-mail de uma conta GitHub, a empresa virava uma sessão "dev" inconsistente com o banco
- Corrigido: se o e-mail já pertence a uma conta que não é `dev`, o login por GitHub é recusado com redirect para `/login?error=email_in_use_company` e mensagem explicativa

**Foto de usuário real commitada no git** — `public/uploads/avatars/1.jpeg`
- Removida do versionamento (`git rm --cached`); `public/uploads/` adicionado ao `.gitignore` (a pasta é recriada em runtime pelo próprio código)

### Consistência de dados

**O "% de match" era calculado de duas formas diferentes** — `controllers/empresaController.js` + `services/matchCalculator.js`
- A visão da empresa (`getMatchs`, `getDesenvolvedores`, `getDevProfile`) usava uma função local (`computeSkillScore`) considerando só skills
- A visão do dev (roadmap, vaga pública) usava `calculateJobMatch`, com skills 85% + senioridade 15% — a mesma vaga podia mostrar % diferente para a empresa e para o dev
- Corrigido: `matchCalculator.js` agora exporta `computeSkillsScore`, `computeSeniorityScore` e `computeMatch` como núcleo puro reutilizável; `empresaController.js` usa `computeMatch` para as três telas, garantindo o mesmo número dos dois lados. `calculateJobMatch` foi refatorado para usar o mesmo núcleo por dentro, então não há mais duas fórmulas para manter sincronizadas

### Funcionalidade

**Fluxo completo de "esqueci minha senha" implementado** (antes não existia — nem link funcional, nem rota, nem capacidade de e-mail no projeto)
- Nova dependência: `nodemailer` — `services/emailService.js` (falha com erro claro se `SMTP_*` não estiver configurado, sem derrubar a aplicação)
- Nova tabela `password_resets` (token com hash SHA-256, expiração de 1h, uso único) — criada automaticamente pela auto-migração de `database/db.js`, mesmo padrão já usado no projeto
- Novos endpoints em `routes/users.js` (sob `/api/auth`, já cobertos pelo rate limiter existente): `POST /api/auth/forgot-password` e `POST /api/auth/reset-password`, com validação em `validators/auth.validator.js` e lógica em `controllers/usersController.js`
- Resposta de `forgot-password` é sempre genérica — nunca revela se o e-mail existe ou se a conta é GitHub-only (sem senha)
- Novas páginas `views/esqueci-senha.ejs` e `views/redefinir-senha.ejs`, seguindo o mesmo layout/design system de `login.ejs`
- Novas rotas de página em `server.js`: `GET /esqueci-senha`, `GET /redefinir-senha`
- Link "Esqueci minha senha" em `login.ejs` (antes `href="#"` morto) agora aponta para `/esqueci-senha`

**Toggle de modo escuro / alto contraste agora é alcançável** — `views/partials/header-dev.ejs`, `header-company.ejs`, `public/js/accessibility.js`, `public/css/header.css`
- As funções já existiam e estavam carregadas em algumas páginas, mas os únicos botões que as chamavam ficavam em partials (`sidebar-dev.ejs`, `sidebar-company.ejs`) nunca incluídos em nenhuma página real
- `accessibility.js` agora é carregado uma vez, pelo próprio header (dev/empresa), em toda página autenticada — removidos os `<script>` duplicados que existiam em 5 páginas individuais
- Botões adicionados no dropdown do usuário e no drawer mobile de ambos os headers; `accessibility.js` ajustado para sincronizar múltiplos botões do mesmo toggle via `data-a11y` em vez de um `id` fixo

### Limpeza

- `validators/job.vlidator.js` (nome com erro de digitação) removido — era cópia idêntica não usada de `validators/job.validator.js`
- `validators/roadmap.validator.js` agora é de fato usado por `routes/roadmap.js` (antes a validação de `status` só existia manualmente dentro do controller)
- Modal morto de criar/editar vaga removido de `views/empresa-dashboard.ejs` (`openModal`/`openEditModal`, nunca chamados — o fluxo real usa as páginas `/empresa/vagas/nova` e `/editar`; o payload do modal também estava desatualizado, faltando os campos adicionados depois)
- `config/script_bd.sql` reconstruído do zero: o arquivo antigo tinha uma linha corrompida (`-- MySQL dump...` sem o prefixo `--`, quebrando a execução), nomes de banco inconsistentes entre si e com o `.env`, e nenhum dado. O novo é um schema único, idempotente (`CREATE TABLE IF NOT EXISTS`, nunca `DROP`) refletindo o estado atual (tabelas base + todas as migrations em `database/*.js`, incluindo `password_resets`)

### Não alterado (decisão consciente, não é bug)

- **Segredos antigos no histórico do git**: `.env` foi commitado e apagado duas vezes no passado; confirmei que os valores atuais (`DB_*`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`) já foram rotacionados e diferem dos que vazaram — mas o histórico do git ainda contém os valores antigos para quem tiver acesso ao repositório. Reescrever o histórico (`git filter-repo`/BFG + force-push) é destrutivo e afeta todo mundo com um clone do repo, então não fiz isso sem confirmação explícita.
- **`landing/index.html`**: protótipo estático órfão (não servido pelo Express, todos os links são `href="#"`). Não removi porque pode ser intencional para uma landing separada — confirmar antes de apagar.
- **`NODE_ENV` em produção**: o código já usa `NODE_ENV === "production"` para ativar cookie `secure`; isso depende de a variável estar configurada no painel do Clever Cloud, algo que não dá para verificar ou alterar a partir daqui.
- **Verificação de e-mail no cadastro e testes automatizados**: identificados na auditoria, mas fora do escopo desta rodada de correções — ver seção de ações manuais.

## Fase 5 — Área Administrador, Planos de Assinatura e base de Mensagens

> Foco: três áreas do produto que não existiam ainda, identificadas a partir do documento de priorização do time (Admin e Planos marcados como bloqueadores de lançamento; Mensagens como prioridade média, com protótipo a caminho).

### Área Administrador (bloqueador — concluído)

**Papel `admin` e infraestrutura de acesso**
- `users.type` ganhou o valor `'admin'` (`database/db.js`, auto-migração idempotente — não mexe nos valores existentes)
- Nova coluna `users.active` — suspensão de conta, usada tanto por devs quanto empresas
- Nova tabela `user_admin_profiles` (mesmo padrão de `user_dev_profiles`/`user_company_profiles`)
- Sem cadastro público de admin (`validateRegister` já restringe `type` a `dev`/`empresa`) — a única forma de criar a conta é `node database/seed-admin.js`, que lê `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NOME` do `.env`
- `middlewares/auth.js`: novos `requireAdmin`/`isAdmin`; `redirectIfAuth` agora manda admin logado pra `/admin/dashboard`
- Login (`usersController.login`) e login com GitHub (`authController.githubCallback`) passam a rejeitar contas com `active = 0`

**Backend** — `controllers/adminController.js` + `routes/admin.js` (`/api/admin`, atrás de `isAdmin`)
- Dashboard com métricas agregadas da plataforma
- Gestão de desenvolvedores e empresas (listar, suspender/reativar, definir plano manualmente)
- Gestão de vagas (visão de todas as vagas de todas as empresas, pausar/reativar)
- Monitoramento de matchs (ações aceito/recusado agregadas + top matchs ≥70%)
- Relatórios (skills mais comuns, vagas por nível, candidaturas por vaga, cadastros por semana)
- Configurações gerais → CRUD do catálogo de skills e seus recursos de aprendizado (antes só existia via script de seed, sem UI nenhuma)

**Frontend** — `views/partials/header-admin.ejs` (segue o padrão de `header-company.ejs`) + 7 páginas novas (`admin-dashboard`, `admin-usuarios`, `admin-empresas`, `admin-vagas`, `admin-matchs`, `admin-relatorios`, `admin-configuracoes`), reaproveitando `empresa-dashboard.css` (tabelas, cards de métrica, badges) em vez de criar CSS novo

### Planos de Assinatura (bloqueador — concluído, gateway de pagamento pendente)

- `config/plans.js`: os 5 planos do modelo Freemium (dev Gratuito/PRO, empresa Free/Básico/Premium), como objeto estático — sem UI de "criar plano", não precisa ser tabela
- Nova tabela `user_subscriptions` — ausência de linha = plano gratuito do tipo do usuário
- `services/subscriptionService.js` — única fonte de verdade sobre limites/features (`canCreateJob`, `hasFeature`, `getUserPlan`, `setUserPlan`)
- **Enforcement real:**
  - Empresa no plano Free/Básico não consegue publicar ou reativar vaga além do limite do plano (`empresaController.createJob`/`updateJob`) — responde `402` com mensagem de upgrade
  - Dev no plano gratuito continua vendo quais skills faltam no roadmap, mas sem os cursos/vídeos recomendados (exclusivo do PRO) — `services/roadmapGenerator.js` retorna `locked: true` em vez de simplesmente esconder a skill, e `views/roadmap.ejs` mostra um convite pra upgrade em vez de "sem recursos"
  - Dev PRO ganha selo "★ PRO" no perfil visto pela empresa (`empresa-desenvolvedores.ejs`, `perfil-dev-empresa.ejs`)
- **Como não há gateway de pagamento escolhido ainda**, o "checkout" por enquanto é manual: o admin define o plano de qualquer dev/empresa direto em `admin-usuarios.ejs`/`admin-empresas.ejs`. Isso já serve de válvula de escape até o pagamento real existir, e continua útil depois disso pra suporte/cortesias
- Seção "Meu plano" adicionada em `perfil-dev.ejs`/`perfil-empresa.ejs` (mostra plano atual e limites — sem botão de upgrade funcional ainda, de propósito: não faz sentido criar mais um CTA morto antes do checkout existir)
- **Não incluído nesta fase** (documentado, não esquecido): checkout/webhook real de pagamento (`services/billingService.js` não foi criado — aguarda decisão de gateway) e o motor de "alertas prioritários de vagas" do plano PRO (é uma funcionalidade nova de notificação, não só gating de algo que já existe)

### Base de Mensagens (prioridade média — schema + API prontos, UI aguardando protótipo)

- Novas tabelas `conversations` (dev × empresa × vaga opcional) e `messages`
- `controllers/messagesController.js` + `routes/messages.js` (`/api/messages`): listar conversas com prévia da última mensagem e contagem de não lidas, iniciar conversa, enviar mensagem, marcar como lida — com verificação de que só os dois lados da conversa conseguem acessá-la
- Sem view ainda — a UI (`views/mensagens.ejs` pro dev, view equivalente pra empresa) fica pra quando o protótipo chegar, pra não desenhar uma tela sem referência

### Testado de ponta a ponta contra o banco real (Clever Cloud)
- Login como admin redireciona certo; dev/empresa não acessam `/admin/*` (redirect na página, 403 na API)
- CRUD de skills + recursos de aprendizado no admin
- Empresa no plano Free bloqueada na 2ª vaga ativa (`402`); upgrade manual via admin libera; `GET /api/empresa/profile` reflete o plano novo
- Roadmap: mesmo dev/vaga real, comparação lado a lado — free sem `resources`, PRO com `resources` completos
- Mensagens: dev inicia conversa (idempotente — repetir a chamada reusa a mesma conversa em vez de duplicar), envia mensagem, empresa lê/marca como lida/responde, terceira empresa recebe `404` ao tentar acessar a conversa de outra
- Toda conta e vaga de teste criada durante os testes foi removida do banco depois

## Arquivos modificados por fase

| Arquivo | Fase 1 | Fase 2 | Fase 3 | Fase 4 |
|---|:---:|:---:|:---:|:---:|
| `server.js` | ✅ | — | ✅ | ✅ |
| `database/db.js` | — | — | ✅ | ✅ |
| `controllers/authController.js` | ✅ | — | — | ✅ |
| `controllers/empresaController.js` | ✅ | ✅ | ✅ | ✅ |
| `controllers/roadmapController.js` | ✅ | — | ✅ | — |
| `controllers/profileController.js` | — | — | — | ✅ |
| `controllers/usersController.js` | — | — | — | ✅ |
| `routes/empresa.js` | ✅ | ✅ | ✅ | — |
| `routes/roadmap.js` | — | — | — | ✅ |
| `routes/users.js` | — | — | — | ✅ |
| `validators/job.vlidator.js` | ✅ | — | — | 🗑️ removido |
| `validators/auth.validator.js` | — | — | — | ✅ |
| `services/matchCalculator.js` | — | — | — | ✅ |
| `services/emailService.js` | — | — | — | 🆕 novo |
| `config/migration_v2.sql` | — | ✅ | — | — |
| `config/script_bd.sql` | — | — | — | ✅ reconstruído |
| `.env.example` | ✅ | — | — | ✅ |
| `.gitignore` | — | — | — | ✅ |
| `package.json` | — | — | — | ✅ (+ nodemailer) |
| `views/login.ejs` | ✅ | — | ✅ | ✅ |
| `views/cadastro.ejs` | ✅ | — | ✅ | — |
| `views/esqueci-senha.ejs` | — | — | — | 🆕 novo |
| `views/redefinir-senha.ejs` | — | — | — | 🆕 novo |
| `views/dashboard.ejs` | — | — | — | ✅ |
| `views/roadmap.ejs` | ✅ | — | ✅ | ✅ |
| `views/progresso.ejs` | ✅ | — | ✅ | — |
| `views/repositorios.ejs` | — | — | — | ✅ |
| `views/perfil-dev.ejs` | — | — | — | ✅ |
| `views/perfil-empresa.ejs` | — | — | — | ✅ |
| `views/vagas.ejs` | ✅ | — | ✅ | — |
| `views/vaga-publica.ejs` | ✅ | — | ✅ | — |
| `views/empresa-dashboard.ejs` | ✅ | — | ✅ | ✅ |
| `views/empresa-vagas.ejs` | ✅ | — | ✅ | — |
| `views/empresa-vaga-form.ejs` | ✅ | — | ✅ | — |
| `views/empresa-matchs.ejs` | ✅ | ✅ | ✅ | — |
| `views/empresa-desenvolvedores.ejs` | ✅ | ✅ | ✅ | — |
| `views/404.ejs` | ✅ | — | — | — |
| `views/500.ejs` | ✅ | — | — | — |
| `views/perfil-dev-empresa.ejs` | — | — | ✅ | — |
| `views/partials/header-dev.ejs` | — | — | — | ✅ |
| `views/partials/header-company.ejs` | — | — | — | ✅ |
| `public/css/header.css` | — | — | — | ✅ |
| `public/js/accessibility.js` | — | — | — | ✅ |
| `public/uploads/avatars/1.jpeg` | — | — | — | 🗑️ removido do git |

---

## Ações manuais necessárias

As ações abaixo **não podem ser feitas automaticamente** e precisam ser executadas pelo responsável do projeto:

### ~~1. Rodar a migration no banco de dados~~ — ✅ obsoleto

`database/db.js` (`testarConexao()`) já roda essa e todas as migrations seguintes automaticamente, de forma idempotente, toda vez que o servidor sobe — inclusive a `password_resets` da Fase 4. Não precisa mais rodar `config/migration_v2.sql` manualmente.

### ~~2. Rotacionar credenciais comprometidas~~ — ✅ já feito

Confirmado comparando o `.env` atual com as duas versões antigas commitadas no histórico do git (`70d33a4^` e `2660173^`): `DB_HOST/NAME/USER/PASS`, `GITHUB_CLIENT_ID/SECRET` e `SESSION_SECRET` já são todos diferentes dos valores que vazaram. Nenhuma ação pendente aqui.

### 3. Configurar SMTP para o e-mail de redefinição de senha funcionar (Fase 4)

Sem isso, `POST /api/auth/forgot-password` continua respondendo com sucesso genérico (não quebra a UI, não vaza quais e-mails existem), mas nenhum e-mail é enviado de verdade — só um `console.error` no servidor.

| Variável | Descrição |
|---|---|
| `SMTP_HOST` | Host do provedor SMTP (ex: um serviço transacional como SendGrid, Mailgun, SES, etc.) |
| `SMTP_PORT` | Geralmente `587` (STARTTLS) ou `465` (TLS implícito) |
| `SMTP_USER` / `SMTP_PASS` | Credenciais do provedor |
| `SMTP_FROM` | Remetente, ex: `Ápice <no-reply@apice.app>` |

Configurar no `.env` local e nas variáveis de ambiente de produção (Clever Cloud).

### 4. Confirmar `NODE_ENV=production` no ambiente de produção (Clever Cloud)

`server.js` só ativa `cookie.secure: true` (cookie de sessão só por HTTPS) quando `NODE_ENV === "production"`. Isso não dá para confirmar a partir do repositório — precisa ser checado no painel do Clever Cloud.

### 5. (Opcional) Purgar segredos antigos do histórico do git

As credenciais já foram rotacionadas (item 2), então não é urgente, mas o histórico do git ainda expõe os valores antigos (`.env` foi commitado e apagado duas vezes: commits `70d33a4` e `2660173`). Se o repositório é ou vai ser público, ou tem colaboradores fora do time de confiança, considerar `git filter-repo` ou BFG Repo-Cleaner para remover essas duas versões do histórico — é uma operação destrutiva que reescreve hashes de commit e exige force-push coordenado com todo mundo que tem um clone, por isso não foi feita automaticamente.

### 6. Trocar a senha da conta admin criada para testes (Fase 5)

Rodei `node database/seed-admin.js` para poder testar a Área Administrador de ponta a ponta contra o banco de produção. Isso criou uma conta real:

- E-mail: `admin.teste@apice.app`
- Senha: `TesteAdmin123!`

**Troque essa senha (ou crie sua própria conta admin e desative/apague essa) antes do lançamento** — são credenciais que ficaram neste chat, não algo que só você conhece. Pra criar uma conta sua: defina `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NOME` no `.env` com seus próprios valores e rode o script de novo (ele não mexe em contas com e-mail diferente).

### 7. Escolher gateway de pagamento (Fase 5)

O sistema de planos já limita vagas por plano e libera/restringe recursos do dev (roadmap, destaque de perfil), mas o "pagar de verdade" ainda não existe — hoje o plano de qualquer usuário só muda manualmente pelo admin. Quando decidirem entre Mercado Pago, Stripe ou outro, dá pra plugar o checkout/webhook em cima do que já existe (`services/subscriptionService.js`) sem mexer no resto.

### 8. Revisar o protótipo de Mensagens quando estiver pronto (Fase 5)

O banco e a API (`/api/messages/*`) já funcionam ponta a ponta. Falta só a tela — me manda o protótipo que eu volto com o design certo em vez de inventar uma UI própria.
