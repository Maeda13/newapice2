// ============================================
// validators/roadmap.validator.js
//
// Regras de validação para o Roadmap:
//   - PATCH /api/roadmap/:jobId/skill/:skillId
// ============================================

const { body, param } = require("express-validator");
const { handleValidation } = require("./handle-validation");

// ── Status válidos (espelham o ENUM do schema.sql) ───────
const VALID_STATUS = ["nao_iniciado", "em_progresso", "concluido"];

// ──────────────────────────────────────────────────────────
// Parâmetros de rota — validados antes do handler
// ──────────────────────────────────────────────────────────

const jobIdParam = param("jobId")
  .notEmpty()
    .withMessage("O parâmetro jobId é obrigatório.")
  .isInt({ min: 1 })
    .withMessage("jobId deve ser um número inteiro positivo.")
  .toInt();

const skillIdParam = param("skillId")
  .notEmpty()
    .withMessage("O parâmetro skillId é obrigatório.")
  .isInt({ min: 1 })
    .withMessage("skillId deve ser um número inteiro positivo.")
  .toInt();

// ──────────────────────────────────────────────────────────
// Body — status do progresso
// ──────────────────────────────────────────────────────────

const statusField = body("status")
  .trim()
  .notEmpty()
    .withMessage("O campo 'status' é obrigatório.")
  .isIn(VALID_STATUS)
    .withMessage(`Status inválido. Use: ${VALID_STATUS.join(", ")}.`);

// ──────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────

/**
 * PATCH /api/roadmap/:jobId/skill/:skillId
 * Valida os dois parâmetros de rota e o body.
 */
const validateUpdateProgress = [
  jobIdParam,
  skillIdParam,
  statusField,
  handleValidation,
];

module.exports = { validateUpdateProgress, jobIdParam, skillIdParam };