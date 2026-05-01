// ============================================
// validators/handle-validation.js
//
// Middleware que lê o resultado do express-validator
// e retorna uma resposta padronizada em caso de erro.
//
// Formato de resposta de erro:
// {
//   error:  "Mensagem do primeiro erro",   <- para exibição no front
//   fields: [                              <- todos os erros por campo
//     { field: "email", message: "..." },
//     { field: "password", message: "..." }
//   ]
// }
// ============================================

const { validationResult } = require("express-validator");

/**
 * Extrai os erros do express-validator e responde 400.
 * Deve ser o ÚLTIMO item de qualquer array de middlewares.
 *
 * @example
 * router.post("/rota", [regra1, regra2, handleValidation], handler)
 */
function handleValidation(req, res, next) {
  const result = validationResult(req);

  if (result.isEmpty()) return next();

  // onlyFirstError: evita múltiplas mensagens para o mesmo campo
  const errors = result.array({ onlyFirstError: true }).map(err => ({
    field:   err.path   ?? err.param ?? "unknown",
    message: err.msg,
  }));

  return res.status(400).json({
    error:  errors[0].message,  // primeiro erro — exibido no alert/toast do front
    fields: errors,             // todos — para destacar campos individuais
  });
}

module.exports = { handleValidation };