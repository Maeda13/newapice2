-- Migração: habilidades-alvo do projeto de cada fase (roadmap_fases).
-- TEXT NULL guardando um array JSON de nomes de skills (ex.: ["JavaScript","React"]):
-- o projeto não usa colunas do tipo JSON (as listas já são guardadas como JSON em TEXT,
-- ex.: perfil_tecnico_ia.boas_praticas). NULL/vazio = roadmap antigo → a verificação
-- cai nas habilidades das etapas. MySQL 8 não tem ADD COLUMN IF NOT EXISTS: o runner
-- (run-projeto-habilidades-migration.js) confere o INFORMATION_SCHEMA antes de aplicar.

ALTER TABLE roadmap_fases
  ADD COLUMN projeto_habilidades TEXT NULL DEFAULT NULL AFTER projeto_enunciado;
