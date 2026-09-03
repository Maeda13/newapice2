/* escape-html.js — escapa texto antes de virar innerHTML.
   Sem dependência de DOM: funciona tanto no navegador (via <script src>,
   define window.escapeHtml) quanto no Node (via require(), para testes). */
(function (root) {
  'use strict';

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml };
  } else {
    root.escapeHtml = escapeHtml;
  }
})(typeof window !== 'undefined' ? window : globalThis);
