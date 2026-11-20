-- Migração: limite de reenvio do projeto da fase (roadmap_fases).
-- Só ADD COLUMN, nullable — nenhum dado existente é alterado. MySQL 8 não
-- tem ADD COLUMN IF NOT EXISTS: o runner (run-projeto-ultimo-envio-migration.js)
-- confere o INFORMATION_SCHEMA antes de aplicar, então é seguro rodar de novo.

ALTER TABLE roadmap_fases
  ADD COLUMN projeto_ultimo_envio_em DATETIME NULL DEFAULT NULL AFTER verificado_em;
