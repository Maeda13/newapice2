(function () {
  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
  }
  if (localStorage.getItem("highContrast") === "true") {
    document.body.classList.add("high-contrast");
  }
})();
 

// Cada toggle pode ter mais de um botão na página (menu do desktop +
// drawer mobile), por isso sincroniza por atributo data-a11y em vez
// de um único id fixo.
function toggleDarkMode() {
  const body = document.body;
  const isActive = body.classList.toggle("dark-mode");

  // Salva a preferência no navegador
  localStorage.setItem("darkMode", isActive);

  // Atualiza o aria-pressed de todos os botões desse toggle
  document.querySelectorAll('[data-a11y="dark-mode"]')
    .forEach(btn => btn.setAttribute("aria-pressed", isActive));
}

// --------------------------------------------
// ALTO CONTRASTE (para daltônicos)
// Alterna a classe "high-contrast" no <body>
// --------------------------------------------
function toggleHighContrast() {
  const body = document.body;
  const isActive = body.classList.toggle("high-contrast");

  // Salva a preferência no navegador
  localStorage.setItem("highContrast", isActive);

  // Atualiza o aria-pressed de todos os botões desse toggle
  document.querySelectorAll('[data-a11y="high-contrast"]')
    .forEach(btn => btn.setAttribute("aria-pressed", isActive));
}

// --------------------------------------------
// Sincroniza o estado visual dos botões
// quando a página termina de carregar
// --------------------------------------------
document.addEventListener("DOMContentLoaded", function () {
  const isDark     = localStorage.getItem("darkMode") === "true";
  const isContrast = localStorage.getItem("highContrast") === "true";

  document.querySelectorAll('[data-a11y="dark-mode"]')
    .forEach(btn => btn.setAttribute("aria-pressed", isDark));
  document.querySelectorAll('[data-a11y="high-contrast"]')
    .forEach(btn => btn.setAttribute("aria-pressed", isContrast));
});