/**
 * rbac.js - Controlador Estricto de Permisos por Rol (RBAC) para Melidan
 *
 * Matriz de Acceso:
 * - ADMIN (administrador)        -> Todo (admin, mozo, carta, cocina, cajero + Historial de Compras)
 * - CHEF (cocina)                -> Solo KDS (cocina)
 * - WAITER (mozo/recepcionista)  -> Mesas y Carta (mozo, carta)
 * - CASHIER (cajero)             -> Solo Caja y Facturación (cajero)
 * - CLIENT (cliente)             -> Solo Carta (carta)
 */
(function () {
  'use strict';

  const SESSION_KEY = 'melidan_auth_user';
  const NOTICE_KEY = 'melidan_rbac_notice';

  const ROLE_MATRIX = {
    ADMIN: {
      code: 'ADMIN',
      label: 'Administrador',
      icon: '👑',
      home: '/admin.html',
      allowed: ['admin', 'mozo', 'carta', 'cocina', 'cajero']
    },
    CHEF: {
      code: 'CHEF',
      label: 'Cocinero (KDS)',
      icon: '👨‍🍳',
      home: '/cocina.html',
      allowed: ['cocina']
    },
    WAITER: {
      code: 'WAITER',
      label: 'Mozo',
      icon: '🛎️',
      home: '/mozo.html',
      allowed: ['mozo', 'carta']
    },
    CASHIER: {
      code: 'CASHIER',
      label: 'Cajero',
      icon: '💵',
      home: '/cajero.html',
      allowed: ['cajero']
    },
    CLIENT: {
      code: 'CLIENT',
      label: 'Cliente',
      icon: '🍽️',
      home: '/carta.html',
      allowed: ['carta']
    }
  };

  function normalizeRole(rawRole) {
    const r = String(rawRole || '').trim().toUpperCase();
    if (r === 'ADMIN' || r === 'ADMINISTRADOR') return 'ADMIN';
    if (r === 'CHEF' || r === 'COCINA' || r === 'COCINERO') return 'CHEF';
    if (r === 'WAITER' || r === 'MOZO' || r === 'MESERO' || r === 'RECEPCIONISTA' || r === 'RECEPCION') return 'WAITER';
    if (r === 'CASHIER' || r === 'CAJERO' || r === 'CAJA') return 'CASHIER';
    if (r === 'CLIENT' || r === 'CLIENTE' || r === 'COMENSAL') return 'CLIENT';
    return '';
  }

  function getStoredUser() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function getRoleConfig(roleOrUser) {
    const roleVal = typeof roleOrUser === 'object' && roleOrUser !== null
      ? (roleOrUser.role || roleOrUser.raw_role || roleOrUser.rol)
      : roleOrUser;
    const norm = normalizeRole(roleVal);
    return ROLE_MATRIX[norm] || null;
  }

  function getHomeUrl(roleOrUser) {
    const cfg = getRoleConfig(roleOrUser);
    return cfg ? cfg.home : '/login';
  }

  function detectCurrentModule(pathname) {
    const clean = String(pathname || '').toLowerCase().replace(/\/+$/, '');
    if (clean === '/admin' || clean.endsWith('/admin.html')) return 'admin';
    if (clean === '/mozo' || clean.endsWith('/mozo.html')) return 'mozo';
    if (clean === '/carta' || clean.endsWith('/carta.html')) return 'carta';
    if (clean === '/cocina' || clean.endsWith('/cocina.html')) return 'cocina';
    if (clean === '/cajero' || clean.endsWith('/cajero.html')) return 'cajero';
    return null;
  }

  function isTokenExpired(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return true;
    try {
      const b64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const payload = JSON.parse(atob(padded));
      return !payload || !payload.exp || Number(payload.exp) < Date.now();
    } catch (_) {
      return false; // Si el entorno no tiene atob (ej. Node), dejar que el servidor valide
    }
  }

  function saveNotice(msg) {
    try {
      sessionStorage.setItem(NOTICE_KEY, msg);
    } catch (_) {}
  }

  function enforceCurrentPage() {
    if (typeof window === 'undefined' || !window.location) return true;
    const currentModule = detectCurrentModule(window.location.pathname);
    if (!currentModule) return true;

    const user = getStoredUser();
    const cfg = getRoleConfig(user);

    if (!user || !cfg || !user.token) {
      saveNotice('Debes iniciar sesión para ingresar al sistema.');
      window.location.replace('/login');
      return false;
    }

    if (typeof atob === 'function' && isTokenExpired(user.token)) {
      try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
      saveNotice('Tu sesión expiró. Por favor inicia sesión nuevamente.');
      window.location.replace('/login');
      return false;
    }

    if (!cfg.allowed.includes(currentModule)) {
      saveNotice(`Acceso restringido: el rol ${cfg.label} no tiene acceso a este módulo.`);
      window.location.replace(cfg.home);
      return false;
    }

    return true;
  }

  const MODULE_META = {
    admin:  { href: '/admin.html',  icon: 'bi-speedometer2',      label: 'Admin' },
    mozo:   { href: '/mozo.html',   icon: 'bi-grid-3x3-gap-fill', label: 'Mesas' },
    carta:  { href: '/carta.html',  icon: 'bi-journal-richtext',  label: 'Carta' },
    cocina: { href: '/cocina.html', icon: 'bi-fire',              label: 'KDS Cocina' },
    cajero: { href: '/cajero.html', icon: 'bi-cash-coin',         label: 'Caja' }
  };

  function injectRoleNavigationBar(cfg, currentModule) {
    if (!cfg || !currentModule || !Array.isArray(cfg.allowed) || cfg.allowed.length <= 1) return;
    if (document.getElementById('rbac-role-nav-bar')) return;

    const mainContainer = document.querySelector('main.app-container');
    if (!mainContainer) return;

    const nav = document.createElement('nav');
    nav.id = 'rbac-role-nav-bar';
    nav.className = 'role-omni-bar';
    nav.setAttribute('aria-label', `Navegación de ${cfg.label}`);

    const roleTag = document.createElement('span');
    roleTag.className = 'role-omni-tag';
    roleTag.textContent = `${cfg.icon} ${cfg.code === 'ADMIN' ? 'Acceso Total Admin' : cfg.label}`;
    nav.appendChild(roleTag);

    const linksWrap = document.createElement('div');
    linksWrap.className = 'role-omni-links';

    cfg.allowed.forEach((modKey) => {
      const meta = MODULE_META[modKey];
      if (!meta) return;
      const a = document.createElement('a');
      a.href = meta.href;
      a.className = `role-omni-link${modKey === currentModule ? ' active' : ''}`;
      a.setAttribute('data-module', modKey);
      a.innerHTML = `<i class="bi ${meta.icon}"></i><span>${meta.label}</span>`;
      linksWrap.appendChild(a);
    });

    nav.appendChild(linksWrap);

    const headerEl = mainContainer.querySelector('header.melidan-navbar, header.kds-header, header.carta-header, .tables-top-bar');
    if (headerEl && headerEl.parentNode) {
      headerEl.insertAdjacentElement('afterend', nav);
    } else {
      mainContainer.prepend(nav);
    }
  }

  function applyDomRestrictions() {
    const user = getStoredUser();
    const cfg = getRoleConfig(user);
    const currentModule = typeof window !== 'undefined' && window.location
      ? detectCurrentModule(window.location.pathname)
      : null;

    document.querySelectorAll('[data-allowed-roles]').forEach((el) => {
      const allowedList = String(el.getAttribute('data-allowed-roles') || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      if (!cfg || !allowedList.includes(cfg.code)) {
        el.remove();
      }
    });

    if (user && cfg) {
      document.querySelectorAll('.rbac-user-badge').forEach((badge) => {
        badge.textContent = `${cfg.icon} ${user.name} (${cfg.label})`;
      });
      injectRoleNavigationBar(cfg, currentModule);
    }

    document.querySelectorAll('.btn-logout-melidan').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          localStorage.removeItem(SESSION_KEY);
          localStorage.removeItem('melidan_session_user');
        } catch (_) {}
        window.location.replace('/login');
      });
    });

    try {
      const pendingNotice = sessionStorage.getItem(NOTICE_KEY);
      if (pendingNotice) {
        sessionStorage.removeItem(NOTICE_KEY);
        showRbacToast(pendingNotice);
      }
    } catch (_) {}
  }

  function showRbacToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container-melidan';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-melidan';
    toast.innerHTML = `<i class="bi bi-shield-lock-fill text-warning"></i> <span></span>`;
    toast.querySelector('span').textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  const RBAC = {
    ROLE_MATRIX,
    normalizeRole,
    getStoredUser,
    getRoleConfig,
    getHomeUrl,
    detectCurrentModule,
    enforceCurrentPage,
    applyDomRestrictions
  };

  if (typeof window !== 'undefined') {
    window.RBAC = RBAC;
    enforceCurrentPage();
    document.addEventListener('DOMContentLoaded', applyDomRestrictions);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RBAC;
  }
})();

