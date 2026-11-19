// public/js/foto-perfil.js
// Foto de perfil no lugar das iniciais: <span class="dev-avatar" data-foto="URL">AB</span>
// ganha um <img> dentro quando a foto carrega. Sem URL, ou se a imagem falhar
// (foto apagada, endereço antigo), as iniciais continuam. Só createElement.
(function () {
  "use strict";

  function aplicarEm(el) {
    const url = el.getAttribute("data-foto");
    if (!url || el.dataset.fotoAplicada) return;
    el.dataset.fotoAplicada = "1";
    const img = document.createElement("img");
    img.className = "foto-perfil-img";
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer"; // foto do GitHub (avatars.githubusercontent.com)
    img.addEventListener("load", () => {
      el.textContent = "";
      el.append(img);
      el.classList.add("tem-foto");
    });
    img.src = url;
  }

  /** Aplica a foto em todos os [data-foto] dentro de raiz (padrão: a página inteira). */
  function aplicar(raiz) {
    (raiz || document).querySelectorAll("[data-foto]").forEach(aplicarEm);
  }

  window.FotoPerfil = { aplicar };

  // As listas são montadas depois de carregar os dados: o que aparecer na página com
  // data-foto ganha a foto sozinho, sem cada tela ter de chamar aplicar().
  function observar() {
    aplicar();
    new MutationObserver(mudancas => {
      for (const m of mudancas) for (const no of m.addedNodes) {
        if (no.nodeType !== 1) continue;
        if (no.hasAttribute("data-foto")) aplicarEm(no);
        aplicar(no);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observar);
  else observar();
})();
