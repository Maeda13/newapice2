// ============================================
// database/seed-skills.js
// Popula o catálogo de skills
// Como usar: node database/seed-skills.js
// ============================================
require("dotenv").config();
const db = require("./db");

const skills = [
  // ── Hard Skills: Backend ──────────────────
  { name: "Node.js",      type: "hard", category: "Backend",  github_signals: "javascript,nodejs,node" },
  { name: "Express.js",   type: "hard", category: "Backend",  github_signals: "express,expressjs" },
  { name: "Python",       type: "hard", category: "Backend",  github_signals: "python,py" },
  { name: "Django",       type: "hard", category: "Backend",  github_signals: "django,python" },
  { name: "FastAPI",      type: "hard", category: "Backend",  github_signals: "fastapi,python" },
  { name: "Java",         type: "hard", category: "Backend",  github_signals: "java,spring" },
  { name: "Spring Boot",  type: "hard", category: "Backend",  github_signals: "spring,springboot,java" },
  { name: "C#",           type: "hard", category: "Backend",  github_signals: "csharp,dotnet,.net" },
  { name: ".NET",         type: "hard", category: "Backend",  github_signals: "dotnet,.net,aspnet" },
  { name: "PHP",          type: "hard", category: "Backend",  github_signals: "php,laravel" },
  { name: "Laravel",      type: "hard", category: "Backend",  github_signals: "laravel,php" },
  { name: "Go",           type: "hard", category: "Backend",  github_signals: "golang,go" },
  { name: "Rust",         type: "hard", category: "Backend",  github_signals: "rust,cargo" },
  { name: "Ruby on Rails",type: "hard", category: "Backend",  github_signals: "ruby,rails,ror" },
  { name: "GraphQL",      type: "hard", category: "Backend",  github_signals: "graphql,apollo" },
  { name: "REST API",     type: "hard", category: "Backend",  github_signals: "rest,restapi,api" },

  // ── Hard Skills: Frontend ─────────────────
  { name: "HTML",         type: "hard", category: "Frontend", github_signals: "html,html5" },
  { name: "CSS",          type: "hard", category: "Frontend", github_signals: "css,css3,scss,sass" },
  { name: "JavaScript",   type: "hard", category: "Frontend", github_signals: "javascript,js,typescript" },
  { name: "TypeScript",   type: "hard", category: "Frontend", github_signals: "typescript,ts" },
  { name: "React",        type: "hard", category: "Frontend", github_signals: "react,reactjs,jsx,tsx" },
  { name: "Next.js",      type: "hard", category: "Frontend", github_signals: "nextjs,next,react" },
  { name: "Vue.js",       type: "hard", category: "Frontend", github_signals: "vue,vuejs,nuxt" },
  { name: "Angular",      type: "hard", category: "Frontend", github_signals: "angular,angularjs" },
  { name: "Svelte",       type: "hard", category: "Frontend", github_signals: "svelte,sveltekit" },
  { name: "Tailwind CSS", type: "hard", category: "Frontend", github_signals: "tailwind,tailwindcss" },

  // ── Hard Skills: Banco de Dados ───────────
  { name: "MySQL",        type: "hard", category: "Banco de Dados", github_signals: "mysql,sql" },
  { name: "PostgreSQL",   type: "hard", category: "Banco de Dados", github_signals: "postgresql,postgres,psql" },
  { name: "MongoDB",      type: "hard", category: "Banco de Dados", github_signals: "mongodb,mongo,mongoose" },
  { name: "Redis",        type: "hard", category: "Banco de Dados", github_signals: "redis,cache" },
  { name: "SQLite",       type: "hard", category: "Banco de Dados", github_signals: "sqlite,sql" },
  { name: "SQL",          type: "hard", category: "Banco de Dados", github_signals: "sql,query,database" },

  // ── Hard Skills: DevOps / Cloud ───────────
  { name: "Docker",       type: "hard", category: "DevOps",   github_signals: "docker,dockerfile,container" },
  { name: "Kubernetes",   type: "hard", category: "DevOps",   github_signals: "kubernetes,k8s,helm" },
  { name: "AWS",          type: "hard", category: "DevOps",   github_signals: "aws,amazon,s3,ec2,lambda" },
  { name: "GCP",          type: "hard", category: "DevOps",   github_signals: "gcp,google cloud,firebase" },
  { name: "Azure",        type: "hard", category: "DevOps",   github_signals: "azure,microsoft,azuredevops" },
  { name: "CI/CD",        type: "hard", category: "DevOps",   github_signals: "ci,cd,github actions,gitlab ci,jenkins" },
  { name: "Linux",        type: "hard", category: "DevOps",   github_signals: "linux,ubuntu,bash,shell" },
  { name: "Git",          type: "hard", category: "DevOps",   github_signals: "git,github,gitlab,bitbucket" },
  { name: "Terraform",    type: "hard", category: "DevOps",   github_signals: "terraform,iac,infra" },

  // ── Hard Skills: Mobile ───────────────────
  { name: "React Native", type: "hard", category: "Mobile",   github_signals: "react native,reactnative,expo" },
  { name: "Flutter",      type: "hard", category: "Mobile",   github_signals: "flutter,dart" },
  { name: "Swift",        type: "hard", category: "Mobile",   github_signals: "swift,ios,xcode" },
  { name: "Kotlin",       type: "hard", category: "Mobile",   github_signals: "kotlin,android" },

  // ── Hard Skills: Testes ───────────────────
  { name: "Jest",         type: "hard", category: "Testes",   github_signals: "jest,testing,vitest" },
  { name: "Cypress",      type: "hard", category: "Testes",   github_signals: "cypress,e2e,playwright" },
  { name: "TDD",          type: "hard", category: "Testes",   github_signals: "tdd,test driven,unit test" },

  // ── Hard Skills: Dados & IA ───────────────
  { name: "Machine Learning", type: "hard", category: "Dados & IA", github_signals: "machine learning,ml,sklearn,tensorflow" },
  { name: "Python Data",   type: "hard", category: "Dados & IA", github_signals: "pandas,numpy,jupyter,data science" },
  { name: "SQL Avançado",  type: "hard", category: "Dados & IA", github_signals: "sql,analytics,warehouse,bigquery" },

  // ── Soft Skills ───────────────────────────
  { name: "Comunicação",            type: "soft", category: null, github_signals: null },
  { name: "Trabalho em equipe",     type: "soft", category: null, github_signals: null },
  { name: "Resolução de problemas", type: "soft", category: null, github_signals: null },
  { name: "Organização",            type: "soft", category: null, github_signals: null },
  { name: "Proatividade",           type: "soft", category: null, github_signals: null },
  { name: "Autonomia",              type: "soft", category: null, github_signals: null },
  { name: "Aprendizado rápido",     type: "soft", category: null, github_signals: null },
  { name: "Pensamento crítico",     type: "soft", category: null, github_signals: null },
  { name: "Adaptabilidade",         type: "soft", category: null, github_signals: null },
  { name: "Gestão de tempo",        type: "soft", category: null, github_signals: null },
];

async function seed() {
  try {
    console.log("🔄 Populando skills...\n");

    // Verifica se já existem
    const [existing] = await db.query("SELECT COUNT(*) AS total FROM skills");
    if (existing[0].total > 0) {
      console.log(`⏭  Já existem ${existing[0].total} skills — pulando`);
      process.exit(0);
    }

    for (const skill of skills) {
      await db.query(
        "INSERT INTO skills (name, type, category, github_signals) VALUES (?, ?, ?, ?)",
        [skill.name, skill.type, skill.category ?? null, skill.github_signals ?? null]
      );
      console.log(`  ✅ ${skill.name} (${skill.type})`);
    }

    console.log(`\n🎉 ${skills.length} skills inseridas com sucesso!`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro:", err.message);
    process.exit(1);
  }
}

seed();
