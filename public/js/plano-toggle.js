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

// "Fazer upgrade" (a[data-checkout]) vai direto para o pagamento do PRO no
// período escolhido no próprio card — botões Mensal/Anual (.pd-toggle__btn) ou
// rádios (input[name="pd-periodo"]). Sem login, a página de pagamento manda
// para o login e volta para ela depois. Sem JavaScript, fica o mensal.
(function () {
  function periodoDo(card) {
    var radio = card && card.querySelector('input[name="pd-periodo"]:checked');
    if (radio) return radio.value;
    var botao = card && card.querySelector(".pd-toggle__btn.is-active");
    if (botao) return botao.dataset.period;
    var botaoDaPagina = document.querySelector(".pd-toggle__btn.is-active");
    return botaoDaPagina ? botaoDaPagina.dataset.period : "mensal";
  }
  function atualizar() {
    document.querySelectorAll("a[data-checkout]").forEach(function (a) {
      var anual = periodoDo(a.closest(".pd-plan")) === "anual";
      a.setAttribute("href", a.getAttribute("data-checkout") + (anual ? "?periodo=anual" : ""));
    });
  }
  document.addEventListener("click", function (e) { if (e.target.closest(".pd-toggle__btn")) setTimeout(atualizar, 0); });
  document.addEventListener("change", function (e) { if (e.target.matches('input[name="pd-periodo"]')) atualizar(); });
  atualizar();
})();
