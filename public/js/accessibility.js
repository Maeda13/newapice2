(function () {
  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark-mode");
  }
  if (localStorage.getItem("highContrast") === "true") {
    document.body.classList.add("high-contrast");
  }
})();
 

function toggleDarkMode() {
  const body = document.body;
  const isActive = body.classList.toggle("dark-mode");
 
  // Salva a preferência no navegador
  localStorage.setItem("darkMode", isActive);
 
  // Atualiza o atributo aria-pressed do botão (acessibilidade)
  const btn = document.getElementById("btn-dark-mode");
  btn.setAttribute("aria-pressed", isActive);
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
 
  // Atualiza o atributo aria-pressed do botão (acessibilidade)
  const btn = document.getElementById("btn-high-contrast");
  btn.setAttribute("aria-pressed", isActive);
}
 
// --------------------------------------------
// Sincroniza o estado visual dos botões
// quando a página termina de carregar
// --------------------------------------------
document.addEventListener("DOMContentLoaded", function () {
  const darkBtn     = document.getElementById("btn-dark-mode");
  const contrastBtn = document.getElementById("btn-high-contrast");
 
  if (darkBtn) {
    darkBtn.setAttribute(
      "aria-pressed",
      localStorage.getItem("darkMode") === "true"
    );
  }
 
  if (contrastBtn) {
    contrastBtn.setAttribute(
      "aria-pressed",
      localStorage.getItem("highContrast") === "true"
    );
  }
});