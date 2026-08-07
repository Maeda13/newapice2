-- ============================================================
-- Migração: tabela de repositórios do perfil do desenvolvedor
-- Executar uma vez no banco Clever Cloud
-- ============================================================

CREATE TABLE IF NOT EXISTS user_repositories (
  id             INT          NOT NULL AUTO_INCREMENT,
  user_id        INT          NOT NULL,
  repo_name      VARCHAR(255) NOT NULL,
  repo_full_name VARCHAR(255) NOT NULL,
  description    TEXT,
  is_private     TINYINT(1)   NOT NULL DEFAULT 0,
  language       VARCHAR(100),
  stars          INT                   DEFAULT 0,
  updated_at_gh  DATETIME,
  added_at       DATETIME              DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE  KEY uq_user_repo (user_id, repo_full_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
