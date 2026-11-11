// ============================================
// public/js/plano-toggle.js
// Toggle Mensal/Anual dos cards de plano (/para-devs e /para-empresas).
// Espera:
//   - botões .pd-toggle__btn com data-period="mensal" | "anual"
//   - o preço em #pro-price, com os valores em data-mensal e data-anual
// A troca do valor é animada (o antigo sobe e some, o novo entra de baixo);
// com "reduzir movimento" no sistema, a troca é instantânea.
// ============================================
(function () {
  var priceEl = document.getElementById("pro-price");
  var botoes = document.querySelectorAll(".pd-toggle__btn");
  if (!priceEl || !botoes.length) return;

  var reduzir = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function trocarPreco(valor) {
    if (priceEl.textContent === valor) return;
    if (reduzir || !priceEl.animate) { priceEl.textContent = valor; return; }
    // Cliques seguidos: interrompe a animação anterior e parte do estado final.
    priceEl.getAnimations().forEach(function (a) { a.cancel(); });
    var saida = priceEl.animate(
      [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-35%)" }],
      { duration: 140, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" }
    );
    saida.onfinish = function () {
      priceEl.textContent = valor;
      saida.cancel();
      priceEl.animate(
        [{ opacity: 0, transform: "translateY(35%)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 240, easing: "cubic-bezier(.2, .8, .2, 1)" }
      );
    };
  }

  botoes.forEach(function (btn) {
    btn.addEventListener("click", function () {
      botoes.forEach(function (b) {
        var on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      trocarPreco(priceEl.getAttribute("data-" + btn.dataset.period));
    });
  });
})();
