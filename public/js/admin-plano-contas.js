// Mudança de plano (admin): quando a pessoa/empresa tem outras contas parecidas,
// abre uma janela do próprio site para escolher em quais delas aplicar o plano.
// Antes era o confirm() do navegador, que só aceitava "tudo ou nada".
//
//   AdminPlanoContas.escolher({ titulo, intro, plano, contas: [{ id, rotulo }] })
//     → Promise<number[]>  ids das OUTRAS contas marcadas (vazio = só a conta alterada).
//
// Fechar pelo "Esc" ou por "Só nesta conta" aplica apenas na conta alterada, como o
// "Cancelar" de antes. Tudo é montado com textContent (nenhum HTML de dados).
window.AdminPlanoContas = (() => {
  function no(tag, props = {}, ...filhos) {
    const el = document.createElement(tag);
    Object.assign(el, props);
    el.append(...filhos);
    return el;
  }

  function escolher({ titulo, intro, plano, contas }) {
    return new Promise((resolve) => {
      const foco = document.activeElement;
      const dlg = no("dialog", { className: "adv-dialog adp-dialog" });
      dlg.setAttribute("aria-labelledby", "adp-titulo");
      dlg.setAttribute("aria-describedby", "adp-texto");

      const lista = no("fieldset", { className: "adp-lista" }, no("legend", { className: "visually-hidden", textContent: "Contas que receberão o plano" }));
      contas.forEach((c, i) => {
        const caixa = no("input", { type: "checkbox", id: `adp-conta-${i}`, value: String(c.id), checked: true });
        lista.append(no("label", { className: "adp-conta", htmlFor: caixa.id }, caixa, no("span", { textContent: c.rotulo })));
      });

      const aviso = no("p", { className: "adv-dialog-text", id: "adp-texto", textContent: `${intro} Marque as contas que também devem ficar no plano ${plano}. As desmarcadas continuam no plano antigo quando entrarem.` });
      const cancelar = no("button", { type: "button", className: "adv-btn", textContent: "Só nesta conta" });
      const aplicar = no("button", { type: "button", className: "adv-btn adv-btn--primary", textContent: "Aplicar nas marcadas" });

      const atualizar = () => {
        const n = lista.querySelectorAll("input:checked").length;
        aplicar.disabled = n === 0;
        aplicar.textContent = n === 1 ? "Aplicar na marcada" : "Aplicar nas marcadas";
      };
      lista.addEventListener("change", atualizar);

      dlg.append(
        no("header", { className: "adv-dialog-head" }, no("h2", { className: "adv-dialog-title", id: "adp-titulo", textContent: titulo })),
        aviso,
        lista,
        no("footer", { className: "adv-dialog-foot" }, cancelar, aplicar),
      );

      let escolhidas = [];
      const fechar = () => dlg.close();
      cancelar.addEventListener("click", fechar);
      aplicar.addEventListener("click", () => {
        escolhidas = [...lista.querySelectorAll("input:checked")].map((i) => Number(i.value));
        fechar();
      });
      dlg.addEventListener("click", (e) => { if (e.target === dlg) fechar(); });
      dlg.addEventListener("close", () => {
        dlg.remove();
        if (foco && document.contains(foco)) foco.focus();
        resolve(escolhidas);
      });

      document.body.append(dlg);
      atualizar();
      dlg.showModal();
      aplicar.focus();
    });
  }

  return { escolher };
})();
