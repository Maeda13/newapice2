// ============================================
// database/seed.js
// Cria as tabelas e popula com dados iniciais
//
// Como usar: node database/seed.js
// ============================================
require("dotenv").config();
const db = require("./db");

async function seed() {
  try {
    console.log("🌱 Iniciando criação do banco...\n");

    // ============================================
    // CRIAÇÃO DAS TABELAS
    // ============================================

    // Tabela de usuários (base para devs e empresas)
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255),
        type          ENUM('dev', 'empresa') NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Tabela users criada");

    // Perfil de desenvolvedor
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_dev_profiles (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        user_id      INT NOT NULL UNIQUE,
        nome         VARCHAR(100) NOT NULL,
        sobrenome    VARCHAR(100),
        github_login VARCHAR(100),
        nivel        ENUM('iniciante','intermediario','avancado') DEFAULT 'iniciante',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Tabela user_dev_profiles criada");

    // Perfil de empresa
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_company_profiles (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        user_id       INT NOT NULL UNIQUE,
        razao_social  VARCHAR(200) NOT NULL,
        nome_fantasia VARCHAR(200),
        cnpj          CHAR(14) NOT NULL UNIQUE,
        setor         VARCHAR(50),
        tamanho       ENUM('micro','pequena','media','grande'),
        site          VARCHAR(255),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Tabela user_company_profiles criada");

    // Tabela de habilidades (catálogo central)
    await db.query(`
      CREATE TABLE IF NOT EXISTS skills (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(100) NOT NULL,
        type            ENUM('hard', 'soft') NOT NULL,
        category        VARCHAR(50),
        github_signals  TEXT
        -- github_signals: palavras-chave separadas por vírgula
        -- Ex: "express,node,nodejs,fastify"
        -- Usadas para detectar a skill nos repositórios do GitHub
      )
    `);
    console.log("✅ Tabela skills criada");

    // Tabela de vagas
    await db.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        title       VARCHAR(200) NOT NULL,
        company     VARCHAR(100),
        description TEXT,
        level       ENUM('estagio', 'junior', 'pleno') DEFAULT 'estagio'
      )
    `);
    console.log("✅ Tabela jobs criada");

    // Relação vaga ↔ skill (com ordem de aprendizado)
    await db.query(`
      CREATE TABLE IF NOT EXISTS job_skills (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        job_id      INT NOT NULL,
        skill_id    INT NOT NULL,
        importance  ENUM('obrigatoria', 'desejavel') DEFAULT 'obrigatoria',
        learn_order INT DEFAULT 1,
        FOREIGN KEY (job_id)   REFERENCES jobs(id)   ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Tabela job_skills criada");

    // Recursos de aprendizado para cada skill
    await db.query(`
      CREATE TABLE IF NOT EXISTS skill_resources (
        id        INT AUTO_INCREMENT PRIMARY KEY,
        skill_id  INT NOT NULL,
        type      ENUM('curso', 'video', 'documentacao', 'projeto') NOT NULL,
        title     VARCHAR(200) NOT NULL,
        url       TEXT,
        is_free   BOOLEAN DEFAULT true,
        duration  VARCHAR(50),
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Tabela skill_resources criada");

    // O que o usuário já sabe (detectado pelo GitHub ou marcado manualmente)
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_skills (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        github_id   BIGINT NOT NULL,
        skill_id    INT NOT NULL,
        source      ENUM('github', 'manual') DEFAULT 'github',
        confidence  INT DEFAULT 0,
        -- confidence: de 0 a 100, o quanto o usuário domina a skill
        UNIQUE KEY unique_user_skill (github_id, skill_id),
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Tabela user_skills criada");

    // Progresso do usuário em cada roadmap
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_roadmap_progress (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        github_id    BIGINT NOT NULL,
        job_id       INT NOT NULL,
        skill_id     INT NOT NULL,
        status       ENUM('nao_iniciado', 'em_progresso', 'concluido') DEFAULT 'nao_iniciado',
        completed_at TIMESTAMP NULL,
        UNIQUE KEY unique_progress (github_id, job_id, skill_id),
        FOREIGN KEY (job_id)   REFERENCES jobs(id)   ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Tabela user_roadmap_progress criada");

    // ============================================
    // DADOS INICIAIS — SKILLS
    // ============================================
    await db.query(`
      INSERT IGNORE INTO skills (id, name, type, category, github_signals) VALUES
        -- Hard skills backend
        (1,  'JavaScript',     'hard', 'linguagem',    'javascript,js'),
        (2,  'Node.js',        'hard', 'backend',      'node,nodejs,express,fastify'),
        (3,  'Express',        'hard', 'backend',      'express,expressjs'),
        (4,  'APIs REST',      'hard', 'backend',      'rest,api,restful,endpoint'),
        (5,  'MySQL',          'hard', 'banco',        'mysql,sequelize'),
        (6,  'Git',            'hard', 'versionamento','git,github,gitlab'),
        (7,  'HTML',           'hard', 'frontend',     'html,html5'),
        (8,  'CSS',            'hard', 'frontend',     'css,css3,sass,scss'),
        (9,  'React',          'hard', 'frontend',     'react,reactjs,jsx'),
        (10, 'TypeScript',     'hard', 'linguagem',    'typescript,ts'),
        -- Soft skills
        (11, 'Comunicação',        'soft', 'comportamental', NULL),
        (12, 'Trabalho em equipe', 'soft', 'comportamental', NULL),
        (13, 'Proatividade',       'soft', 'comportamental', NULL),
        (14, 'Resolução de problemas', 'soft', 'comportamental', NULL)
    `);
    console.log("✅ Skills inseridas");

    // ============================================
    // DADOS INICIAIS — VAGAS
    // ============================================
    await db.query(`
      INSERT IGNORE INTO jobs (id, title, company, description, level) VALUES
        (1, 'Estágio Backend Node.js', 'TechCorp',    'Desenvolvimento de APIs REST com Node.js e MySQL', 'estagio'),
        (2, 'Estágio Frontend React',  'StartupXYZ',  'Desenvolvimento de interfaces com React',           'estagio'),
        (3, 'Estágio Fullstack',       'AgênciaDigital', 'Desenvolvimento web completo',                  'estagio')
    `);
    console.log("✅ Vagas inseridas");

    // ============================================
    // DADOS INICIAIS — RELAÇÃO VAGA ↔ SKILLS
    // ============================================

    // Vaga 1: Estágio Backend Node.js
    await db.query(`
      INSERT IGNORE INTO job_skills (job_id, skill_id, importance, learn_order) VALUES
        (1, 1,  'obrigatoria', 1),  -- JavaScript     (aprender primeiro)
        (1, 6,  'obrigatoria', 2),  -- Git
        (1, 2,  'obrigatoria', 3),  -- Node.js
        (1, 3,  'obrigatoria', 4),  -- Express
        (1, 4,  'obrigatoria', 5),  -- APIs REST
        (1, 5,  'obrigatoria', 6),  -- MySQL
        (1, 10, 'desejavel',   7),  -- TypeScript     (desejável, não obrigatório)
        (1, 11, 'obrigatoria', 8),  -- Comunicação
        (1, 12, 'obrigatoria', 9)   -- Trabalho em equipe
    `);

    // Vaga 2: Estágio Frontend React
    await db.query(`
      INSERT IGNORE INTO job_skills (job_id, skill_id, importance, learn_order) VALUES
        (2, 1,  'obrigatoria', 1),  -- JavaScript
        (2, 7,  'obrigatoria', 2),  -- HTML
        (2, 8,  'obrigatoria', 3),  -- CSS
        (2, 6,  'obrigatoria', 4),  -- Git
        (2, 9,  'obrigatoria', 5),  -- React
        (2, 10, 'desejavel',   6),  -- TypeScript
        (2, 11, 'obrigatoria', 7),  -- Comunicação
        (2, 13, 'desejavel',   8)   -- Proatividade
    `);

    // Vaga 3: Estágio Fullstack
    await db.query(`
      INSERT IGNORE INTO job_skills (job_id, skill_id, importance, learn_order) VALUES
        (3, 1,  'obrigatoria', 1),  -- JavaScript
        (3, 7,  'obrigatoria', 2),  -- HTML
        (3, 8,  'obrigatoria', 3),  -- CSS
        (3, 6,  'obrigatoria', 4),  -- Git
        (3, 2,  'obrigatoria', 5),  -- Node.js
        (3, 9,  'obrigatoria', 6),  -- React
        (3, 4,  'obrigatoria', 7),  -- APIs REST
        (3, 5,  'desejavel',   8),  -- MySQL
        (3, 12, 'obrigatoria', 9),  -- Trabalho em equipe
        (3, 14, 'desejavel',   10)  -- Resolução de problemas
    `);
    console.log("✅ Relações vaga ↔ skills inseridas");

    // ============================================
    // DADOS INICIAIS — RECURSOS DE APRENDIZADO
    // ============================================
    await db.query(`
      INSERT IGNORE INTO skill_resources (skill_id, type, title, url, is_free, duration) VALUES
        -- JavaScript
        (1, 'curso',        'JavaScript do Zero - Curso em Vídeo',         'https://www.cursoemvideo.com/curso/javascript/', true,  '40 horas'),
        (1, 'documentacao', 'MDN Web Docs — JavaScript',                    'https://developer.mozilla.org/pt-BR/docs/Web/JavaScript', true, NULL),
        (1, 'projeto',      'Crie uma calculadora simples',                  NULL, true, '3 horas'),

        -- Node.js
        (2, 'documentacao', 'Documentação oficial do Node.js',              'https://nodejs.org/pt-br/docs', true, NULL),
        (2, 'curso',        'Node.js do Zero - Rocketseat',                 'https://www.rocketseat.com.br', false, '6 horas'),
        (2, 'projeto',      'Crie uma API de lista de tarefas',             NULL, true, '5 horas'),

        -- Express
        (3, 'documentacao', 'Documentação oficial do Express',              'https://expressjs.com/pt-br/', true, NULL),
        (3, 'projeto',      'Crie rotas CRUD para um cadastro simples',     NULL, true, '4 horas'),

        -- APIs REST
        (4, 'video',        'O que é uma API REST? - Rocketseat',           'https://youtube.com', true, '15 min'),
        (4, 'projeto',      'Construa uma API de usuários com Express',     NULL, true, '6 horas'),

        -- MySQL
        (5, 'curso',        'MySQL do Zero - Curso em Vídeo',               'https://www.cursoemvideo.com/curso/mysql/', true, '40 horas'),
        (5, 'projeto',      'Crie um banco para o seu portfólio',           NULL, true, '4 horas'),

        -- Git
        (6, 'curso',        'Git e GitHub para iniciantes - Udemy',         'https://www.udemy.com', false, '5 horas'),
        (6, 'documentacao', 'Git - Guia Prático',                           'https://rogerdudler.github.io/git-guide/index.pt_BR.html', true, NULL),

        -- React
        (9, 'documentacao', 'Documentação oficial do React',                'https://react.dev', true, NULL),
        (9, 'curso',        'React do Zero - Rocketseat Discover',          'https://www.rocketseat.com.br/discover', true, '10 horas'),
        (9, 'projeto',      'Crie um app de busca de repositórios GitHub',  NULL, true, '8 horas')
    `);
    console.log("✅ Recursos de aprendizado inseridos");

    console.log("\n🎉 Banco de dados criado e populado com sucesso!");
    process.exit(0);

  } catch (err) {
    console.error("❌ Erro ao criar o banco:", err.message);
    process.exit(1);
  }
}

seed();