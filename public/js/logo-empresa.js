// public/js/logo-empresa.js
// Foto (logo) da empresa no Perfil e nas Configurações. O próprio logo é o
// botão: abre o seletor de arquivo, reduz a imagem no navegador (até 512px no
// maior lado, para a vitrine de vagas não baixar fotos enormes) e envia para
// POST /api/empresa/logo. Depois troca a foto no logo e no cabeçalho.
// Os elementos são criados com createElement, sem montar HTML a partir de texto.
(function () {
  "use strict";

  const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const MAX_BYTES = 2 * 1024 * 1024; // o mesmo limite do servidor
  const LADO_MAX = 512;
  const LEVE = 300 * 1024; // imagem pequena e leve vai como está (GIF animado continua animado)

  // Erro com mensagem para mostrar ao usuário (as outras falhas, como a de rede, viram uma mensagem genérica).
  class ErroDoEnvio extends Error {}

  // Mostra a imagem (ou as iniciais, sem imagem) dentro do botão do logo.
  function mostrar(botao, src) {
    const iniciais = botao.querySelector("[data-logo-iniciais]");
    let img = botao.querySelector(".pe-logo-img");
    if (!src) {
      if (img) img.remove();
      if (iniciais) iniciais.hidden = false;
      return;
    }
    if (!img) {
      img = document.createElement("img");
      img.className = "pe-logo-img";
      img.alt = "";
      img.decoding = "async";
      // endereço quebrado (foto apagada, por exemplo): volta para as iniciais
      img.addEventListener("error", () => { img.remove(); if (iniciais) iniciais.hidden = false; });
      botao.prepend(img);
    }
    img.src = src;
    if (iniciais) iniciais.hidden = true;
  }

  // Foto salva da empresa (logo_url do perfil); também ajusta o nome acessível do botão.
  function definir(botao, url) {
    botao.dataset.logoUrl = url || "";
    mostrar(botao, url || "");
    const rotulo = url ? "Trocar a foto da empresa" : "Adicionar foto da empresa";
    botao.setAttribute("aria-label", rotulo);
    botao.title = url ? "Trocar foto" : "Adicionar foto";
  }

  async function reduzir(arquivo) {
    if (typeof createImageBitmap !== "function") return arquivo;
    let bitmap;
    try { bitmap = await createImageBitmap(arquivo); } catch (_) { return arquivo; } // o servidor confere o formato
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    if (escala === 1 && arquivo.size <= LEVE) { if (bitmap.close) bitmap.close(); return arquivo; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    // WebP mantém a transparência; o navegador que não gera WebP entrega PNG
    const blob = await new Promise(ok => canvas.toBlob(ok, "image/webp", 0.9));
    return blob && blob.size < arquivo.size ? blob : arquivo;
  }

  // Prévia enquanto envia. Data URL porque a CSP do site libera "data:" nas imagens (e não "blob:").
  function comoDataUrl(blob) {
    return new Promise((ok, erro) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(leitor.result);
      leitor.onerror = () => erro(leitor.error);
      leitor.readAsDataURL(blob);
    });
  }

  // Cabeçalho (partials/header-company.ejs): troca a foto ou as iniciais pela foto nova.
  function trocarNoCabecalho(url) {
    const lugares = [
      { img: ".header-avatar--company", iniciais: ".header-company-icon--initials", classe: "header-avatar header-avatar--company", lado: 26 },
      { img: ".drawer-avatar--company", iniciais: ".drawer-avatar-ph--company", classe: "drawer-avatar drawer-avatar--company", lado: 36 },
    ];
    for (const l of lugares) {
      document.querySelectorAll(l.img).forEach(img => { img.src = url; });
      document.querySelectorAll(l.iniciais).forEach(el => {
        const img = document.createElement("img");
        img.className = l.classe;
        img.alt = "";
        img.width = l.lado;
        img.height = l.lado;
        if (el.getAttribute("aria-hidden") === "true") img.setAttribute("aria-hidden", "true");
        img.src = url;
        el.replaceWith(img);
      });
    }
  }

  /** botao: o logo; input: o <input type="file">; aviso(mensagem, tipo): o toast da página. */
  function iniciar({ botao, input, aviso }) {
    let enviando = false;
    botao.addEventListener("click", () => { if (!enviando) input.click(); });

    input.addEventListener("change", async () => {
      const arquivo = input.files && input.files[0];
      input.value = ""; // escolher o mesmo arquivo de novo também dispara o change
      if (!arquivo || enviando) return;
      if (!TIPOS.includes(arquivo.type)) {
        aviso("Formato inválido. Use JPEG, PNG, WebP ou GIF.", "error");
        return;
      }
      enviando = true;
      // sem "disabled", para o foco do teclado continuar no botão
      botao.setAttribute("aria-busy", "true");
      botao.classList.add("is-enviando");
      try {
        const envio = await reduzir(arquivo);
        if (envio.size > MAX_BYTES) throw new ErroDoEnvio("Arquivo muito grande. Máximo 2 MB.");
        mostrar(botao, await comoDataUrl(envio));

        const dados = new FormData();
        dados.append("logo", envio, "logo");
        const res = await fetch("/api/empresa/logo", { method: "POST", body: dados });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.logo) throw new ErroDoEnvio(json.error || "Não foi possível enviar a foto. Tente de novo.");

        definir(botao, json.logo);
        trocarNoCabecalho(json.logo);
        aviso("Foto da empresa atualizada!", "success");
      } catch (err) {
        definir(botao, botao.dataset.logoUrl); // volta para a foto (ou as iniciais) de antes
        aviso(err instanceof ErroDoEnvio ? err.message : "Não foi possível enviar a foto. Verifique a conexão e tente de novo.", "error");
      } finally {
        enviando = false;
        botao.removeAttribute("aria-busy");
        botao.classList.remove("is-enviando");
      }
    });
  }

  window.LogoEmpresa = { iniciar, definir };
})();
