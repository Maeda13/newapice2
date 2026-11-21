// Para onde o "Voltar" de uma página de detalhe do admin leva, a partir de ?voltar=
// (ex.: o relatório de onde a vaga foi aberta). Só aceita caminhos internos do
// admin, sem barra dupla nem caracteres fora de [a-z0-9-/], para não virar um
// redirecionamento aberto nem quebrar o atributo href; senão cai no padrão.
function voltarAdmin(valor, padrao) {
  if (typeof valor !== "string") return padrao;
  return /^\/admin(\/[a-z0-9-]+)+$/i.test(valor) ? valor : padrao;
}

module.exports = { voltarAdmin };
