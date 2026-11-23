/**
 * theme.js - Controlador Universal de Modo Oscuro Completo (Melidan)
 * Persiste preferencias en localStorage (melidan_theme) y sincroniza data-theme + data-bs-theme.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'melidan_theme';

  // Limpiar cualquier estado residual de demo anterior para usar diseño 100% responsive nativo
  try {
    document.documentElement.removeAttribute('data-viewport');
    sessionStorage.removeItem('melidan_viewport_demo');
  } catch (_) {}

  function getPreferredTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (_) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme, animateIcon = false) {
    const cleanTheme = theme === 'dark' ? 'dark' : 'light';
    const root = document.documentElement;
    if (animateIcon) {
      root.classList.add('theme-switching');
    }
    root.setAttribute('data-theme', cleanTheme);
    root.setAttribute('data-bs-theme', cleanTheme);
    try {
      localStorage.setItem(STORAGE_KEY, cleanTheme);
    } catch (_) {}

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', cleanTheme === 'dark' ? '#0F172A' : '#FF5722');
    }

    document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
      if (cleanTheme === 'dark') {
        btn.innerHTML = '<i class="bi bi-sun-fill text-warning"></i><span class="d-none d-sm-inline ms-1 small">Claro</span>';
        btn.setAttribute('title', 'Cambiar a Modo Claro');
        btn.setAttribute('aria-label', 'Cambiar a Modo Claro');
      } else {
        btn.innerHTML = '<i class="bi bi-moon-stars-fill"></i><span class="d-none d-sm-inline ms-1 small">Oscuro</span>';
        btn.setAttribute('title', 'Cambiar a Modo Oscuro');
        btn.setAttribute('aria-label', 'Cambiar a Modo Oscuro');
      }
      if (animateIcon) {
        btn.classList.remove('theme-spin-active');
        void btn.offsetWidth;
        btn.classList.add('theme-spin-active');
      }
    });

    if (animateIcon) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => root.classList.remove('theme-switching'));
      });
    }
  }

  window.toggleDarkMode = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark', true);
  };

  // Aplicar inmediatamente antes del renderizado del body para evitar parpadeos (FOUC)
  applyTheme(getPreferredTheme(), false);

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.theme-toggle-btn').forEach((themeBtn) => {
      themeBtn.removeEventListener('click', window.toggleDarkMode);
      themeBtn.addEventListener('click', window.toggleDarkMode);
    });
    applyTheme(getPreferredTheme(), false);
  });
})();
