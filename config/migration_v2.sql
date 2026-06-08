-- ================================================================
-- Migração v2 — Matchs reais + perfil GitHub
--
-- Execute uma vez no banco antes de usar as páginas de matchs.
-- Seguro para re-executar: usa IF NOT EXISTS / IF NOT COLUMN.
-- ================================================================

-- 1. Adiciona github_id (ID numérico do GitHub) ao perfil do dev
--    Usado para vincular user_skills e user_roadmap_progress ao perfil.
ALTER TABLE user_dev_profiles
  ADD COLUMN IF NOT EXISTS github_id BIGINT DEFAULT NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_dev_github_id (github_id);

-- 2. Tabela de ações de match (empresa aceita ou recusa um dev para uma vaga)
CREATE TABLE IF NOT EXISTS company_match_actions (
  id           INT         NOT NULL AUTO_INCREMENT,
  company_id   INT         NOT NULL,
  dev_github_id BIGINT     NOT NULL,
  job_id       INT         NOT NULL,
  action       ENUM('aceito','recusado') NOT NULL,
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_action (company_id, dev_github_id, job_id),
  KEY idx_company (company_id),
  CONSTRAINT fk_cma_company FOREIGN KEY (company_id)  REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_cma_job     FOREIGN KEY (job_id)       REFERENCES jobs  (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
