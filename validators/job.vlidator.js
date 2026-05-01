// ============================================
// validators/job.validator.js
//
// Regras de validação para vagas:
//   - POST  /api/empresa/jobs         (criar)
//   - PATCH /api/empresa/jobs/:id     (editar)
// ============================================

const { body, param } = require("express-validator");
const { handleValidation } = require("./handle-validation");

// ── Valores aceitos (espelham o schema.sql) ──────────────
const VALID_LEVELS = ["estagio", "junior", "pleno"];

// ── Limite de caracteres para HTML sanitizado ────────────
const MAX_DESC = 2000;

// ──────────────────────────────────────────────────────────
// Campos individuais reutilizáveis
// ──────────────────────────────────────────────────────────

const titleField = (required = true) => {
  const chain = body("title").trim();
  if (required) {
    return chain
      .notEmpty()
        .withMessage("O título da vaga é obrigatório.")
      .isLength({ min: 3 })
        .withMessage("O título deve ter no mínimo 3 caracteres.")
      .isLength({ max: 200 })
        .withMessage("O título deve ter no máximo 200 caracteres.");
  }
  return chain
    .optional()
    .notEmpty()
      .withMessage("O título não pode ser vazio.")
    .isLength({ min: 3 })
      .withMessage("O título deve ter no mínimo 3 caracteres.")
    .isLength({ max: 200 })
      .withMessage("O título deve ter no máximo 200 caracteres.");
};

const levelField = (required = true) => {
  const chain = body("level");
  if (required) {
    return chain
      .notEmpty()
        .withMessage("O nível da vaga é obrigatório.")
      .isIn(VALID_LEVELS)
        .withMessage(`Nível inválido. Use: ${VALID_LEVELS.join(", ")}.`);
  }
  return chain
    .optional()
    .isIn(VALID_LEVELS)
      .withMessage(`Nível inválido. Use: ${VALID_LEVELS.join(", ")}.`);
};

const descField = body("description")
  .optional({ nullable: true, checkFalsy: true })
  .trim()
  .isLength({ max: MAX_DESC })
    .withMessage(`A descrição deve ter no máximo ${MAX_DESC} caracteres.`);

const activeField = body("active")
  .optional()
  .isBoolean()
    .withMessage("O campo 'active' deve ser true ou false.")
  .toBoolean();

// ──────────────────────────────────────────────────────────
// Validador do parâmetro :id das rotas de vaga
// ──────────────────────────────────────────────────────────
const jobIdParam = param("id")
  .notEmpty()
    .withMessage("O ID da vaga é obrigatório.")
  .isInt({ min: 1 })
    .withMessage("O ID da vaga deve ser um número inteiro positivo.")
  .toInt();

// ──────────────────────────────────────────────────────────
// Validators exportados
// ──────────────────────────────────────────────────────────

/**
 * POST /api/empresa/jobs
 * Todos os campos obrigatórios (exceto description e active).
 */
const validateCreateJob = [
  titleField(true),
  levelField(true),
  descField,
  handleValidation,
];

/**
 * PATCH /api/empresa/jobs/:id
 * Todos os campos são opcionais — apenas os enviados são validados.
 */
const validateUpdateJob = [
  jobIdParam,
  titleField(false),
  levelField(false),
  descField,
  activeField,
  handleValidation,
];

module.exports = { validateCreateJob, validateUpdateJob, jobIdParam };