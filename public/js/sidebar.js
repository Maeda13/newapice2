/* sidebar.js — Authenticated sidebar + topbar interactions */
(function () {
  'use strict';

  /* ── Elements ─────────────────────────────────────────────── */
  const appShell   = document.querySelector('.app-shell');
  const sidebar    = document.querySelector('.sidebar');
  const overlay    = document.getElementById('sidebar-overlay');
  const topbarToggle = document.getElementById('topbar-sidebar-toggle');

  // Detect which sidebar variant is active
  const collapseBtn = document.getElementById('sidebar-dev-toggle')
    || document.getElementById('sidebar-company-toggle');

  if (!sidebar) return;

  /* ── Collapse (desktop) ───────────────────────────────────── */
  const STORAGE_KEY = 'apice-sidebar-collapsed';

  function setCollapsed(collapsed) {
    if (collapsed) {
      appShell && appShell.classList.add('sidebar-collapsed');
      document.documentElement.classList.add('sidebar-collapsed');
      collapseBtn && collapseBtn.setAttribute('aria-expanded', 'false');
      collapseBtn && collapseBtn.setAttribute('aria-label', 'Expandir menu lateral');
    } else {
      appShell && appShell.classList.remove('sidebar-collapsed');
      document.documentElement.classList.remove('sidebar-collapsed');
      collapseBtn && collapseBtn.setAttribute('aria-expanded', 'true');
      collapseBtn && collapseBtn.setAttribute('aria-label', 'Recolher menu lateral');
    }
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  }

  // Restore persisted state
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === '1') setCollapsed(true);
  } catch (_) {}

  if (collapseBtn) {
    collapseBtn.addEventListener('click', function () {
      const isCollapsed = document.documentElement.classList.contains('sidebar-collapsed');
      setCollapsed(!isCollapsed);
    });
  }

  /* ── Mobile open/close ────────────────────────────────────── */
  function openMobileSidebar() {
    sidebar.classList.add('mobile-open');
    overlay && overlay.classList.add('active');
    overlay && overlay.removeAttribute('aria-hidden');
    topbarToggle && topbarToggle.setAttribute('aria-expanded', 'true');
    topbarToggle && topbarToggle.setAttribute('aria-label', 'Fechar menu lateral');
    // Focus first sidebar link
    const first = sidebar.querySelector('.sidebar-link');
    if (first) first.focus();
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay && overlay.classList.remove('active');
    overlay && overlay.setAttribute('aria-hidden', 'true');
    topbarToggle && topbarToggle.setAttribute('aria-expanded', 'false');
    topbarToggle && topbarToggle.setAttribute('aria-label', 'Abrir menu lateral');
  }

  topbarToggle && topbarToggle.addEventListener('click', function () {
    const isOpen = sidebar.classList.contains('mobile-open');
    if (isOpen) { closeMobileSidebar(); } else { openMobileSidebar(); }
  });

  overlay && overlay.addEventListener('click', closeMobileSidebar);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
      topbarToggle && topbarToggle.focus();
    }
  });

  // Close on resize to desktop
  window.addEventListener('resize', function () {
    if (window.innerWidth > 900 && sidebar.classList.contains('mobile-open')) {
      closeMobileSidebar();
    }
  }, { passive: true });

  /* ── Search shortcut ⌘K / Ctrl+K ─────────────────────────── */
  const searchInput = document.getElementById('topbar-search-input');

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput && searchInput.focus();
    }
  });

  /* ── Active link highlight (fallback via URL) ─────────────── */
  // Ensures aria-current is set even when not pre-rendered by the server
  const currentPath = window.location.pathname;
  sidebar.querySelectorAll('.sidebar-link').forEach(function (link) {
    const href = link.getAttribute('href');
    if (href && currentPath === href) {
      link.setAttribute('aria-current', 'page');
    }
  });
})();
