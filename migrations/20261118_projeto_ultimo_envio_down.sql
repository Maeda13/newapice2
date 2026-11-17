-- Reverte 20261118_projeto_ultimo_envio_up.sql — remove só esta coluna.

ALTER TABLE roadmap_fases DROP COLUMN projeto_ultimo_envio_em;
