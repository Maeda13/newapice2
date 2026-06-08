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

## Arquivos modificados por fase

| Arquivo | Fase 1 | Fase 2 | Fase 3 |
|---|:---:|:---:|:---:|
| `server.js` | ✅ | — | ✅ |
| `database/db.js` | — | — | ✅ |
| `controllers/authController.js` | ✅ | — | — |
| `controllers/empresaController.js` | ✅ | ✅ | ✅ |
| `controllers/roadmapController.js` | ✅ | — | ✅ |
| `routes/empresa.js` | ✅ | ✅ | ✅ |
| `routes/roadmap.js` | — | — | — |
| `validators/job.vlidator.js` | ✅ | — | — |
| `config/migration_v2.sql` | — | ✅ | — |
| `.env.example` | ✅ | — | — |
| `views/login.ejs` | ✅ | — | ✅ |
| `views/cadastro.ejs` | ✅ | — | ✅ |
| `views/roadmap.ejs` | ✅ | — | ✅ |
| `views/progresso.ejs` | ✅ | — | ✅ |
| `views/vagas.ejs` | ✅ | — | ✅ |
| `views/vaga-publica.ejs` | ✅ | — | ✅ |
| `views/empresa-dashboard.ejs` | ✅ | — | ✅ |
| `views/empresa-vagas.ejs` | ✅ | — | ✅ |
| `views/empresa-vaga-form.ejs` | ✅ | — | ✅ |
| `views/empresa-matchs.ejs` | ✅ | ✅ | ✅ |
| `views/empresa-desenvolvedores.ejs` | ✅ | ✅ | ✅ |
| `views/404.ejs` | ✅ | — | — |
| `views/500.ejs` | ✅ | — | — |
| `views/perfil-dev-empresa.ejs` | — | — | ✅ |

---

## Ações manuais necessárias

As ações abaixo **não podem ser feitas automaticamente** e precisam ser executadas pelo responsável do projeto:

### 1. Rodar a migration no banco de dados

```sql
-- Arquivo: config/migration_v2.sql
-- Execute uma única vez no banco de produção (Clever Cloud)

ALTER TABLE user_dev_profiles
  ADD COLUMN IF NOT EXISTS github_id BIGINT DEFAULT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_dev_github_id (github_id);

CREATE TABLE IF NOT EXISTS company_match_actions (
  id            INT          NOT NULL AUTO_INCREMENT,
  company_id    INT          NOT NULL,
  dev_github_id BIGINT       NOT NULL,
  job_id        INT          NOT NULL,
  action        ENUM('aceito','recusado') NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_action (company_id, dev_github_id, job_id),
  KEY idx_company (company_id),
  CONSTRAINT fk_cma_company FOREIGN KEY (company_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_cma_job     FOREIGN KEY (job_id)     REFERENCES jobs  (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2. Rotacionar credenciais comprometidas

O `SESSION_SECRET` atual (`"devestagios123"`) é fraco e estava exposto. Gerar novos valores para:

| Variável | Como gerar |
|---|---|
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DB_PASS` | Painel Clever Cloud → banco → resetar senha |
| `GITHUB_CLIENT_SECRET` | GitHub → Settings → Developer Apps → regenerar secret |

Após gerar, atualizar as variáveis de ambiente no servidor de produção e localmente no arquivo `.env`.
