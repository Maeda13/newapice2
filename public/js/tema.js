// ============================================
// public/js/tema.js — Seletor de tema de acessibilidade (Padrão, Claro,
// Alto contraste). O tema inicial já foi aplicado no <head> por
// partials/tema-head.ejs (sem piscar); aqui ficam o seletor
// (partials/seletor-tema.ejs), a gravação da escolha e o aviso para
// leitores de tela.
//
// Sem escolha salva, o tema segue o sistema (prefers-contrast: more e
// prefers-color-scheme: light), inclusive se ele mudar com a página aberta.
// Quem escolhe no seletor fica com a própria escolha.
// Outros scripts podem ouvir o evento "temachange" no document.
// ============================================
(function () {
  var AVISOS = {
    "padrao": "Tema padrão ativado.",
    "claro": "Tema claro ativado.",
    "alto-contraste": "Alto contraste ativado.",
  };
  var raiz = document.documentElement;

  function salvo() {
    try {
      var t = localStorage.getItem("tema");
      if (AVISOS[t]) return t;
      return localStorage.getItem("highContrast") === "true" ? "alto-contraste" : null; // botão antigo
    } catch (e) { return null; }
  }
  function doSistema() {
    var m = window.matchMedia;
    if (m && m("(prefers-contrast: more)").matches) return "alto-contraste";
    if (m && m("(prefers-color-scheme: light)").matches) return "claro";
    return "padrao";
  }
  function atual() {
    var t = raiz.getAttribute("data-tema");
    return AVISOS[t] ? t : "padrao";
  }
  function marcar(t) {
    document.querySelectorAll("[data-tema-opcao]").forEach(function (r) { r.checked = r.value === t; });
  }
  function definir(t) {
    raiz.setAttribute("data-tema", t);
    marcar(t);
    document.dispatchEvent(new CustomEvent("temachange", { detail: { tema: t } }));
  }
  function escolher(t, aviso) {
    try {
      localStorage.setItem("tema", t);
      localStorage.removeItem("darkMode");      // chaves dos botões antigos
      localStorage.removeItem("highContrast");
    } catch (e) {}
    definir(t);
    if (aviso) {
      // limpa antes, para o leitor de tela anunciar mesmo se o texto se repetir
      aviso.textContent = "";
      setTimeout(function () { aviso.textContent = AVISOS[t]; }, 60);
    }
  }
  function fechar(bloco, devolverFoco) {
    var botao = bloco.querySelector("[data-tema-botao]");
    var painel = bloco.querySelector(".tema__painel");
    if (!botao || !painel || painel.hidden) return;
    painel.hidden = true;
    botao.setAttribute("aria-expanded", "false");
    if (devolverFoco) botao.focus();
  }

  function iniciar() {
    marcar(atual());
    var blocos = document.querySelectorAll(".tema");
    blocos.forEach(function (bloco) {
      var botao = bloco.querySelector("[data-tema-botao]");
      var painel = bloco.querySelector(".tema__painel");
      var aviso = bloco.querySelector("[data-tema-aviso]");
      if (!botao || !painel) return;

      botao.addEventListener("click", function () {
        var abrir = painel.hidden;
        blocos.forEach(function (outro) { if (outro !== bloco) fechar(outro); });
        painel.hidden = !abrir;
        botao.setAttribute("aria-expanded", String(abrir));
        if (abrir) {
          var marcado = painel.querySelector("[data-tema-opcao]:checked") || painel.querySelector("[data-tema-opcao]");
          if (marcado) marcado.focus();
        }
      });
      bloco.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !painel.hidden) { e.preventDefault(); fechar(bloco, true); }
      });
      painel.querySelectorAll("[data-tema-opcao]").forEach(function (radio) {
        radio.addEventListener("change", function () { if (radio.checked) escolher(radio.value, aviso); });
      });
    });

    // clique fora fecha o painel
    document.addEventListener("click", function (e) {
      blocos.forEach(function (bloco) { if (!bloco.contains(e.target)) fechar(bloco); });
    });

    // sem escolha salva, acompanha o sistema
    var m = window.matchMedia;
    if (m) {
      ["(prefers-contrast: more)", "(prefers-color-scheme: light)"].forEach(function (q) {
        var mq = m(q);
        var seguir = function () { if (!salvo()) definir(doSistema()); };
        if (mq.addEventListener) mq.addEventListener("change", seguir);
        else if (mq.addListener) mq.addListener(seguir);
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
