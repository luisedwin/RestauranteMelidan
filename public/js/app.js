/**
 * app.js - Controlador Principal de Melidan (Portal Web + SPA Responsive)
 * Conexión completa entre vistas, AuthService y PostgreSQL 18 (melidan_db).
 */

const ROLE_PERMISSIONS = {
  ADMIN: {
    label: 'Administrador',
    badgeClass: 'bg-primary-subtle text-primary border-primary-subtle',
    icon: '👑',
    allowedScreens: ['admin', 'staff', 'kds', 'menu', 'tracker'],
    defaultScreen: 'admin',
    description: 'Acceso total al sistema de gestión y monitoreo'
  },
  CHEF: {
    label: 'Cocinero / Chef',
    badgeClass: 'bg-warning text-dark',
    icon: '👨‍🍳',
    allowedScreens: ['kds'],
    defaultScreen: 'kds',
    description: 'Acceso exclusivo al Sistema de Cocina (KDS)'
  },
  WAITER: {
    label: 'Mozo / Salón',
    badgeClass: 'bg-success-subtle text-success border-success-subtle',
    icon: '🛎️',
    allowedScreens: ['menu', 'tracker'],
    defaultScreen: 'menu',
    description: 'Acceso a Carta QR y Monitoreo de Mesas'
  },
  CASHIER: {
    label: 'Cajero / Facturación',
    badgeClass: 'bg-info-subtle text-info border-info-subtle',
    icon: '💵',
    allowedScreens: ['tracker', 'menu'],
    defaultScreen: 'tracker',
    description: 'Acceso a Facturación / Comprobantes y Carta'
  },
  RECEPCIONISTA: {
    label: 'Recepcionista / Aforo',
    badgeClass: 'bg-info-subtle text-info border-info-subtle',
    icon: '🛎️',
    allowedScreens: ['menu', 'tracker'],
    defaultScreen: 'tracker',
    description: 'Recepción de comensales y control de aforo'
  },
  CLIENT: {
    label: 'Cliente / Comensal',
    badgeClass: 'bg-info-subtle text-info border-info-subtle',
    icon: '🍽️',
    allowedScreens: ['menu', 'tracker'],
    defaultScreen: 'menu',
    description: 'Acceso a Carta Digital QR y Tracker de Pedidos'
  }
};

class AppController {
  constructor() {
    this.currentRecoveryEmail = '';
    this.currentRecoveryCode = '';
    this.pendingDeleteUserId = null;
    this.productsCache = null;

    this.staffFilterRole = 'Todos';
    this.staffFilterSearch = '';
    this.staffIncludeDeleted = false;

    this.cart = [
      { id: 1, id_producto: 1, name: 'Lechón a Fuego Lento', price: 48.00, precio: 48.00, qty: 1, cantidad: 1 },
      { id: 5, id_producto: 5, name: 'Chicha Morada Artesanal (1L)', price: 14.00, precio: 14.00, qty: 1, cantidad: 1 }
    ];
    this.activeKdsTab = 'cocinando';
    this.activeCategory = 'Todos';
    this.searchTerm = '';

    this.init();
  }

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  normalizeRole(role) {
    if (!role) return 'WAITER';
    const r = String(role).trim().toUpperCase();
    if (r === 'ADMIN' || r === 'ADMINISTRADOR') return 'ADMIN';
    if (r === 'CHEF' || r === 'COCINA' || r === 'COCINERO') return 'CHEF';
    if (r === 'WAITER' || r === 'MOZO' || r === 'MESERO') return 'WAITER';
    if (r === 'CASHIER' || r === 'CAJERO' || r === 'CAJA') return 'CASHIER';
    if (r === 'RECEPCIONISTA' || r === 'RECEPCION') return 'RECEPCIONISTA';
    if (r === 'CLIENT' || r === 'CLIENTE' || r === 'COMENSAL') return 'CLIENT';
    return 'WAITER';
  }

  getRoleConfig(role) {
    const norm = this.normalizeRole(role);
    return ROLE_PERMISSIONS[norm] || ROLE_PERMISSIONS.WAITER;
  }

  applyRolePermissions(user) {
    const bottomBar = document.getElementById('app-bottom-bar');
    if (!bottomBar) return;

    if (!user) {
      bottomBar.style.display = 'none';
      return;
    }

    const roleConfig = this.getRoleConfig(user.role);
    const buttons = bottomBar.querySelectorAll('.bottom-bar-btn[data-screen]');

    buttons.forEach(btn => {
      const screen = btn.dataset.screen;
      const isAllowed = roleConfig.allowedScreens.includes(screen);
      btn.classList.toggle('d-none', !isAllowed);
    });
  }

  updateUserHeaders(user) {
    if (!user) return;
    const roleConfig = this.getRoleConfig(user.role);

    const nameEl = document.getElementById('admin-user-name') || document.querySelector('.user-name');
    const avatarEl = document.getElementById('admin-user-avatar');
    const adminRoleBadge = document.getElementById('admin-role-badge');
    if (nameEl) nameEl.textContent = user.name;
    if (avatarEl && user.avatar) avatarEl.src = user.avatar;
    if (adminRoleBadge) {
      adminRoleBadge.textContent = `${roleConfig.icon} ${roleConfig.label}`;
      adminRoleBadge.className = `badge ${roleConfig.badgeClass} border`;
    }

    const staffUserName = document.getElementById('staff-header-user-name');
    const staffUserAvatar = document.getElementById('staff-user-avatar');
    if (staffUserName) staffUserName.textContent = user.name;
    if (staffUserAvatar && user.avatar) staffUserAvatar.src = user.avatar;

    const kdsBadge = document.getElementById('kds-user-badge');
    if (kdsBadge) kdsBadge.textContent = `${roleConfig.icon} ${user.name}`;

    const menuBadge = document.getElementById('menu-user-badge');
    if (menuBadge) menuBadge.textContent = `${roleConfig.icon} ${user.name}`;

    const trackerBadge = document.getElementById('tracker-user-badge');
    if (trackerBadge) trackerBadge.textContent = `${roleConfig.icon} ${user.name} (${roleConfig.label})`;
  }

  async init() {
    this.bindEvents();
    this.bindRegisterValidation();
    this.initLiveClock();
    this.updateCartBar();

    // Si se ingresa por /login (ej. desde abrir_sistema.bat), mostrar siempre Login directo sin saltar
    const params = new URLSearchParams(window.location.search);
    const forceLogin = window.location.pathname === '/login' || params.has('login');
    if (forceLogin) {
      window.AuthService.logout();
      this.showScreen('login');
    } else {
      const existingUser = window.AuthService.getCurrentUser();
      if (existingUser && existingUser.token) {
        const homeUrl = window.RBAC ? window.RBAC.getHomeUrl(existingUser) : '/carta.html';
        window.location.replace(homeUrl);
        return;
      }
      this.showScreen('login');
    }

    // Sincronización con PostgreSQL en segundo plano sin bloquear el Login
    try {
      await window.db.init();
    } catch (err) {
      console.warn('[AppController] Advertencia en carga inicial:', err);
    }
  }

  // ==========================================
  // NAVEGACIÓN ENTRE PANTALLAS
  // ==========================================

  showScreen(screenId) {
    const isAuth = screenId.startsWith('login') || screenId.startsWith('forgot') || screenId === 'register';
    const user = window.AuthService.getCurrentUser();

    if (!isAuth && !user) {
      this.showScreen('login');
      return;
    }

    if (!isAuth && user) {
      const roleConfig = this.getRoleConfig(user.role);
      if (!roleConfig.allowedScreens.includes(screenId)) {
        this.showToast(`Acceso restringido: Como ${roleConfig.label}, no tienes permiso a esta vista.`);
        this.showScreen(roleConfig.defaultScreen);
        return;
      }
    }

    // Ajustar layout responsive del contenedor (centrado en Auth, expandido en vistas SPA de PC)
    const container = document.querySelector('.app-container');
    if (container) {
      container.classList.toggle('spa-expanded', !isAuth);
      container.classList.toggle('auth-register-active', screenId === 'register');
    }

    document.querySelectorAll('.view-screen').forEach(s => s.classList.remove('active-screen'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) {
      target.classList.add('active-screen');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const bottomBar = document.getElementById('app-bottom-bar');
    if (bottomBar) {
      bottomBar.style.display = isAuth ? 'none' : 'flex';
      this.applyRolePermissions(user);
      document.querySelectorAll('.bottom-bar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.screen === screenId);
      });
    }

    if (screenId === 'admin') this.renderAdminMetrics();
    if (screenId === 'staff') this.renderStaffList();
    if (screenId === 'kds') this.renderKdsOrders();
    if (screenId === 'menu') this.renderMenuDishes();
    if (screenId === 'tracker') this.renderTrackerOrder();
  }

  // ==========================================
  // VALIDACIÓN DE REGISTRO (NACIONAL / EXTRANJERO)
  // ==========================================

  handleOriginChange(origin) {
    const isForeign = (origin === 'extranjero');
    const countryContainer = document.getElementById('reg-country-container');
    const docTypeSelect = document.getElementById('reg-doc-type');
    const phonePrefix = document.getElementById('reg-phone-prefix');
    const phoneLabel = document.getElementById('reg-phone-label');
    const phoneInput = document.getElementById('reg-phone');

    if (countryContainer) countryContainer.classList.toggle('d-none', !isForeign);

    if (docTypeSelect) {
      docTypeSelect.querySelectorAll('.option-foreign').forEach(opt => {
        opt.classList.toggle('d-none', !isForeign);
      });
      docTypeSelect.value = isForeign ? 'PASAPORTE' : 'DNI';
      this.handleDocTypeChange(docTypeSelect.value);
    }

    if (phonePrefix && phoneLabel && phoneInput) {
      if (isForeign) {
        phonePrefix.textContent = '🌐';
        phoneLabel.textContent = 'Teléfono Internacional (con código) *';
        phoneInput.placeholder = '+1 4155552671';
      } else {
        phonePrefix.textContent = '+51';
        phoneLabel.textContent = 'Teléfono Móvil (Perú: 9 dígitos) *';
        phoneInput.placeholder = '987654321';
      }
    }

    this.validateRegisterForm();
  }

  handleDocTypeChange(docType) {
    const docNumberInput = document.getElementById('reg-doc-number');
    const docLabel = document.getElementById('reg-doc-label');
    const docFeedback = document.getElementById('reg-doc-feedback');
    if (!docNumberInput || !docLabel) return;

    if (docType === 'DNI') {
      docLabel.textContent = 'N° DNI (8 dígitos) *';
      docNumberInput.placeholder = 'Ej. 72849102';
      docNumberInput.maxLength = 8;
      if (docFeedback) docFeedback.textContent = 'El DNI debe contener exactamente 8 dígitos numéricos.';
    } else if (docType === 'PASAPORTE') {
      docLabel.textContent = 'N° de Pasaporte (6 a 12 caracteres) *';
      docNumberInput.placeholder = 'Ej. PAS9845123A';
      docNumberInput.maxLength = 12;
      if (docFeedback) docFeedback.textContent = 'El pasaporte debe tener entre 6 y 12 caracteres alfanuméricos.';
    } else if (docType === 'CARNET_EXTRANJERIA') {
      docLabel.textContent = 'N° Carné de Extranjería (9 a 12 caracteres) *';
      docNumberInput.placeholder = 'Ej. CE009874123';
      docNumberInput.maxLength = 12;
      if (docFeedback) docFeedback.textContent = 'El Carné de Extranjería debe tener entre 9 y 12 caracteres alfanuméricos.';
    }

    this.validateRegisterForm();
  }

  bindRegisterValidation() {
    const form = document.getElementById('form-register');
    if (!form) return;

    const fields = [
      'reg-name', 'reg-nationality', 'reg-doc-number',
      'reg-phone', 'reg-email', 'reg-password',
      'reg-password-confirm', 'reg-terms'
    ];

    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.validateRegisterForm());
        el.addEventListener('change', () => this.validateRegisterForm());
      }
    });

    form.addEventListener('submit', (e) => this.submitRegister(e));
  }

  validateRegisterForm() {
    const form = document.getElementById('form-register');
    const submitBtn = document.getElementById('btn-register-submit');
    if (!form || !submitBtn) return false;

    const isForeign = document.getElementById('reg-origin-foreign')?.checked || false;
    const nameEl = document.getElementById('reg-name');
    const countryEl = document.getElementById('reg-nationality');
    const docType = document.getElementById('reg-doc-type')?.value || 'DNI';
    const docNumEl = document.getElementById('reg-doc-number');
    const phoneEl = document.getElementById('reg-phone');
    const emailEl = document.getElementById('reg-email');
    const passEl = document.getElementById('reg-password');
    const confirmEl = document.getElementById('reg-password-confirm');
    const termsEl = document.getElementById('reg-terms');

    let isValid = true;

    const nameVal = (nameEl?.value || '').trim();
    const nameOk = nameVal.length >= 3;
    this.setFieldStatus(nameEl, nameOk);
    if (!nameOk) isValid = false;

    if (isForeign) {
      const countryOk = (countryEl?.value || '').trim().length >= 2;
      this.setFieldStatus(countryEl, countryOk);
      if (!countryOk) isValid = false;
    }

    const docVal = (docNumEl?.value || '').trim();
    let docOk = false;
    if (docType === 'DNI') {
      docOk = /^[0-9]{8}$/.test(docVal);
    } else if (docType === 'PASAPORTE') {
      docOk = /^[A-Za-z0-9]{6,12}$/.test(docVal);
    } else if (docType === 'CARNET_EXTRANJERIA') {
      docOk = /^[A-Za-z0-9]{9,12}$/.test(docVal);
    }
    this.setFieldStatus(docNumEl, docOk);
    if (!docOk) isValid = false;

    const phoneVal = (phoneEl?.value || '').trim();
    let phoneOk = false;
    if (!isForeign) {
      const cleanDigits = phoneVal.replace(/[^0-9]/g, '');
      phoneOk = /^9[0-9]{8}$/.test(cleanDigits);
    } else {
      phoneOk = /^\+?[0-9]{1,4}[0-9\s-]{6,15}$/.test(phoneVal);
    }
    this.setFieldStatus(phoneEl, phoneOk);
    if (!phoneOk) isValid = false;

    const emailVal = (emailEl?.value || '').trim();
    const emailOk = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(emailVal);
    this.setFieldStatus(emailEl, emailOk);
    if (!emailOk) isValid = false;

    const passVal = passEl?.value || '';
    const passOk = passVal.length >= 6;
    this.setFieldStatus(passEl, passOk);
    if (!passOk) isValid = false;

    const confirmVal = confirmEl?.value || '';
    const confirmOk = confirmVal.length >= 6 && confirmVal === passVal;
    this.setFieldStatus(confirmEl, confirmOk);
    if (!confirmOk) isValid = false;

    const termsOk = termsEl?.checked || false;
    if (!termsOk) isValid = false;

    submitBtn.disabled = !isValid;
    return isValid;
  }

  setFieldStatus(el, isValid) {
    if (!el) return;
    if (el.value === '' && !el.required) {
      el.classList.remove('is-valid', 'is-invalid');
      return;
    }
    if (isValid) {
      el.classList.remove('is-invalid');
      el.classList.add('is-valid');
    } else {
      el.classList.remove('is-valid');
      el.classList.add('is-invalid');
    }
  }

  async submitRegister(e) {
    e.preventDefault();
    if (!this.validateRegisterForm()) {
      this.showToast('Por favor completa todos los campos con los formatos requeridos.', 'error');
      return;
    }

    const submitBtn = document.getElementById('btn-register-submit');
    const alertBox = document.getElementById('register-alert');
    if (alertBox) alertBox.classList.add('d-none');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Registrando en PostgreSQL...';

    const isForeign = document.getElementById('reg-origin-foreign')?.checked || false;
    const name = document.getElementById('reg-name').value.trim();
    const nationality = isForeign ? (document.getElementById('reg-nationality').value.trim() || 'Extranjera') : 'Peruana';
    const docType = document.getElementById('reg-doc-type').value;
    const docNumber = document.getElementById('reg-doc-number').value.trim();
    let phone = document.getElementById('reg-phone').value.trim();
    if (!isForeign && !phone.startsWith('+51')) {
      phone = '+51 ' + phone;
    }
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    try {
      const payload = {
        name,
        email,
        password,
        role: 'cliente',
        docType,
        docNumber,
        nationality,
        phone,
        shift: 'Cliente'
      };

      const user = await window.db.registerUser(payload);
      this.showToast(`¡Bienvenido ${user.name}! Tu cuenta ha sido creada exitosamente.`);

      const loginEmail = document.getElementById('login-email');
      const loginPass = document.getElementById('login-password');
      if (loginEmail) loginEmail.value = email;
      if (loginPass) loginPass.value = password;

      await this.quickLogin(email, password);
    } catch (err) {
      if (alertBox) {
        alertBox.textContent = err.message;
        alertBox.classList.remove('d-none');
      }
      this.showHttpError(err.status || 422, 'Error en el Registro de Usuario', err.message, err.errors);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Crear Cuenta';
    }
  }

  // ==========================================
  // EVENTOS DE AUTENTICACIÓN Y RECUPERACIÓN
  // ==========================================

  bindEvents() {
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
      formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const alertBox = document.getElementById('login-alert');
        const submitBtn = document.getElementById('btn-login-submit');

        alertBox.classList.add('d-none');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verificando credenciales...';

        try {
          const user = await window.AuthService.login(email, password);
          const roleConfig = this.getRoleConfig(user.role);
          const normRole = this.normalizeRole(user.role);

          let targetHtml = '/carta.html';
          if (window.RBAC) {
            targetHtml = window.RBAC.getHomeUrl(user);
          } else if (normRole === 'ADMIN') {
            targetHtml = '/admin.html';
          } else if (normRole === 'CHEF') {
            targetHtml = '/cocina.html';
          } else if (normRole === 'WAITER' || normRole === 'RECEPCIONISTA') {
            targetHtml = '/mozo.html';
          } else if (normRole === 'CASHIER') {
            targetHtml = '/cajero.html';
          } else {
            targetHtml = '/carta.html';
          }

          this.showToast(`¡Bienvenido ${user.name}! Redirigiendo a ${roleConfig.label}...`);
          setTimeout(() => {
            window.location.href = targetHtml;
          }, 360);
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.classList.remove('d-none');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Iniciar Sesión';
        }
      });
    }

    const formForgot1 = document.getElementById('form-forgot-step1');
    if (formForgot1) {
      formForgot1.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value;
        const alertBox = document.getElementById('forgot1-alert');
        alertBox.classList.add('d-none');

        try {
          const res = await window.AuthService.sendOtpCode(email);
          this.currentRecoveryEmail = email;
          this.showToast(`Código generado: ${res.code}`);

          const otpInput = document.getElementById('otp-code');
          if (otpInput) {
            otpInput.value = res.code.substring(0, 3) + '-' + res.code.substring(3, 6);
          }
          this.showScreen('forgot-step2');
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.classList.remove('d-none');
        }
      });
    }

    const formForgot2 = document.getElementById('form-forgot-step2');
    if (formForgot2) {
      formForgot2.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('otp-code').value.replace(/[^0-9]/g, '');
        const alertBox = document.getElementById('forgot2-alert');
        alertBox.classList.add('d-none');

        try {
          await window.AuthService.verifyOtp(this.currentRecoveryEmail, code);
          this.currentRecoveryCode = code;
          this.showToast('Código verificado con éxito');
          this.showScreen('forgot-step3');
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.classList.remove('d-none');
        }
      });
    }

    const formForgot3 = document.getElementById('form-forgot-step3');
    if (formForgot3) {
      formForgot3.addEventListener('submit', async (e) => {
        e.preventDefault();
        const p1 = document.getElementById('new-password').value;
        const p2 = document.getElementById('confirm-password').value;
        const alertBox = document.getElementById('forgot3-alert');
        alertBox.classList.add('d-none');

        try {
          await window.AuthService.resetPassword(this.currentRecoveryEmail, this.currentRecoveryCode, p1, p2);
          this.showToast('¡Contraseña actualizada en PostgreSQL con éxito!');
          document.getElementById('login-email').value = this.currentRecoveryEmail;
          document.getElementById('login-password').value = p1;
          this.showScreen('login');
        } catch (err) {
          alertBox.textContent = err.message;
          alertBox.classList.remove('d-none');
        }
      });
    }

    const formStaff = document.getElementById('form-new-staff');
    if (formStaff) {
      formStaff.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateStaffSubmit();
      });
    }
  }

  // ==========================================
  // GESTIÓN DE PERSONAL & CRUD (POSTGRESQL)
  // ==========================================

  handleStaffOriginChange(origin) {
    const isForeign = (origin === 'extranjero');
    const countryContainer = document.getElementById('staff-country-container');
    const docTypeSelect = document.getElementById('staff-doc-type-select');
    const prefixEl = document.getElementById('staff-phone-prefix');
    const phoneInput = document.getElementById('staff-phone-input');

    if (countryContainer) countryContainer.classList.toggle('d-none', !isForeign);

    if (docTypeSelect) {
      docTypeSelect.querySelectorAll('.staff-opt-foreign').forEach(opt => {
        opt.classList.toggle('d-none', !isForeign);
      });
      docTypeSelect.value = isForeign ? 'PASAPORTE' : 'DNI';
      this.handleStaffDocTypeChange(docTypeSelect.value);
    }

    if (prefixEl && phoneInput) {
      if (isForeign) {
        prefixEl.textContent = '🌐';
        phoneInput.placeholder = '+1 4155552671';
      } else {
        prefixEl.textContent = '+51';
        phoneInput.placeholder = '987654321';
      }
    }
  }

  handleStaffDocTypeChange(docType) {
    const input = document.getElementById('staff-doc-number-input');
    const label = document.getElementById('staff-doc-number-label');
    const feedback = document.getElementById('staff-doc-feedback');
    if (!input || !label) return;

    if (docType === 'DNI') {
      label.textContent = 'N° DNI (8 dígitos) *';
      input.placeholder = 'Ej. 72849102';
      input.maxLength = 8;
      if (feedback) feedback.textContent = 'El DNI debe tener 8 dígitos numéricos.';
    } else if (docType === 'PASAPORTE') {
      label.textContent = 'N° Pasaporte (6-12 caracteres) *';
      input.placeholder = 'Ej. PAS9845123A';
      input.maxLength = 12;
      if (feedback) feedback.textContent = 'El pasaporte debe tener 6-12 caracteres.';
    } else if (docType === 'CARNET_EXTRANJERIA') {
      label.textContent = 'N° Carné de Extranjería (9-12 caracteres) *';
      input.placeholder = 'Ej. CE009874123';
      input.maxLength = 12;
      if (feedback) feedback.textContent = 'Carné de Extranjería: 9-12 caracteres.';
    }
  }

  async handleCreateStaffSubmit() {
    const submitBtn = document.getElementById('btn-staff-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando en PostgreSQL...';

    const isForeign = document.getElementById('staff-origin-foreign')?.checked || false;
    const name = document.getElementById('staff-name-input').value.trim();
    const nationality = isForeign ? (document.getElementById('staff-nationality-input').value.trim() || 'Extranjera') : 'Peruana';
    const docType = document.getElementById('staff-doc-type-select').value;
    const docNumber = document.getElementById('staff-doc-number-input').value.trim();
    let phone = document.getElementById('staff-phone-input').value.trim();
    if (!isForeign && phone && !phone.startsWith('+51')) {
      phone = '+51 ' + phone;
    }
    const email = document.getElementById('staff-email-input').value.trim();
    const role = document.getElementById('staff-role-select').value;
    const shift = document.getElementById('staff-shift-select').value;
    const password = document.getElementById('staff-pass-input').value || 'password123';

    try {
      await window.db.insertStaff({
        name,
        email,
        role,
        docType,
        docNumber,
        nationality,
        phone,
        shift,
        status: 'Activo',
        password
      });
      await this.renderStaffList();

      document.getElementById('form-new-staff').reset();
      this.handleStaffOriginChange('nacional');
      this.showToast(`¡Usuario ${name} guardado en PostgreSQL!`);
    } catch (err) {
      this.showHttpError(err.status || 422, 'Error al Crear Usuario', err.message, err.errors);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Guardar Usuario en PostgreSQL';
    }
  }

  searchStaff(term) {
    this.staffFilterSearch = term;
    this.renderStaffList();
  }

  filterStaffRole(role, btn) {
    this.staffFilterRole = role;
    document.querySelectorAll('#staff-role-filters .category-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.renderStaffList();
  }

  toggleIncludeDeleted(checked) {
    this.staffIncludeDeleted = checked;
    this.renderStaffList();
  }

  async refreshStaffList() {
    this.showToast('Actualizando lista de usuarios desde PostgreSQL...');
    await this.renderStaffList();
  }

  async renderStaffList() {
    const container = document.getElementById('staff-cards-container');
    if (!container) return;

    const [staff, allStaff] = await Promise.all([
      window.db.getStaff(this.staffIncludeDeleted, this.staffFilterSearch, this.staffFilterRole),
      window.db.getStaff(true)
    ]);

    const totalCount = allStaff.length;
    const activeCount = allStaff.filter(s => !s.is_deleted && (s.status === 'Activo' || s.estado === 'Activo')).length;
    const foreignCount = allStaff.filter(s => s.es_extranjero || (s.nacionalidad && !['peruana', 'peru', 'perú'].includes(s.nacionalidad.toLowerCase()))).length;
    const deletedCount = allStaff.filter(s => s.is_deleted).length;

    const elTotal = document.getElementById('staff-stat-total');
    const elActive = document.getElementById('staff-stat-active');
    const elForeign = document.getElementById('staff-stat-foreign');
    const elDeleted = document.getElementById('staff-stat-deleted');
    const elIndicator = document.getElementById('staff-count-indicator');

    if (elTotal) elTotal.textContent = totalCount;
    if (elActive) elActive.textContent = activeCount;
    if (elForeign) elForeign.textContent = foreignCount;
    if (elDeleted) elDeleted.textContent = deletedCount;
    if (elIndicator) elIndicator.textContent = `${staff.length} mostrado${staff.length === 1 ? '' : 's'}`;

    if (staff.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-secondary bg-white rounded-4 border p-4">
          <i class="bi bi-people fs-2 text-muted d-block mb-2"></i>
          <div class="fw-bold">No se encontraron usuarios</div>
          <small class="text-muted">Prueba cambiando los filtros o activa la papelera.</small>
        </div>
      `;
      return;
    }

    container.innerHTML = staff.map(s => {
      const isDeleted = !!s.is_deleted;
      const isForeign = s.es_extranjero || (s.nacionalidad && !['peruana', 'peru', 'perú'].includes(s.nacionalidad.toLowerCase()));
      const cardClass = isDeleted ? 'staff-card staff-card-deleted' : 'staff-card';
      const id = Number(s.id || s.id_usuario);
      const rawName = s.name || s.nombre || 'Usuario';
      const safeName = this.escapeHtml(rawName);
      const safeJsName = rawName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      let statusBadge = '';
      if (isDeleted) {
        statusBadge = '<span class="badge-staff-softdeleted">Baja Lógica</span>';
      } else if (s.status === 'Activo' || s.estado === 'Activo') {
        statusBadge = '<span class="badge-staff-active">Activo</span>';
      } else {
        statusBadge = '<span class="badge-staff-inactive">Inactivo</span>';
      }

      const docType = this.escapeHtml(s.tipo_documento || 'DNI');
      const docNum = this.escapeHtml(s.numero_documento || 'Sin doc');
      const docBadge = isForeign
        ? `<span class="badge-doc-foreign">🌎 ${this.escapeHtml(s.nacionalidad || 'Extranjero')} • ${docType}: ${docNum}</span>`
        : `<span class="badge-doc-pe">🇵🇪 DNI: ${docNum}</span>`;

      const phoneText = s.telefono ? `<div class="staff-meta-text"><i class="bi bi-telephone"></i> ${this.escapeHtml(s.telefono)}</div>` : '';
      const activeFlag = (s.status || s.estado) === 'Activo';

      return `
        <div class="${cardClass}">
          <div class="staff-header-line d-flex justify-content-between align-items-center mb-1">
            <span class="staff-name-text fs-6 fw-bold text-dark">${safeName}</span>
            <div>${statusBadge}</div>
          </div>

          <div class="mb-2">${docBadge}</div>

          <div class="staff-meta-text mb-1">
            <i class="bi bi-envelope"></i> ${this.escapeHtml(s.email)} • <strong>${this.escapeHtml(s.role || s.rol)}</strong>
          </div>
          ${phoneText}
          <div class="staff-meta-text mb-3">
            <i class="bi bi-clock"></i> ${this.escapeHtml(s.shift || s.turno || 'Turno Mañana')}
          </div>

          <div class="staff-actions-line border-top pt-2 d-flex flex-wrap gap-2 justify-content-between align-items-center">
            <div class="d-flex gap-2">
              <button type="button" class="btn-action-icon text-dark" onclick="app.openEditUserModal(${id})">
                <i class="bi bi-pencil"></i> Editar
              </button>
              ${!isDeleted ? `
                <button type="button" class="btn-action-icon ${activeFlag ? 'text-secondary' : 'text-success'}" onclick="app.toggleStaffStatus(${id}, '${activeFlag ? 'Activo' : 'Inactivo'}')">
                  <i class="bi bi-arrow-repeat"></i> ${activeFlag ? 'Desactivar' : 'Activar'}
                </button>
              ` : ''}
            </div>

            <div>
              ${!isDeleted ? `
                <button type="button" class="btn-action-icon text-danger" onclick="app.openDeleteConfirmModal(${id}, '${safeJsName}')" title="Dar de baja lógicamente sin borrar de la base de datos">
                  <i class="bi bi-trash3"></i> Dar de Baja
                </button>
              ` : `
                <button type="button" class="btn-action-icon text-success fw-bold" onclick="app.restoreStaff(${id})" title="Restaurar usuario">
                  <i class="bi bi-arrow-counterclockwise"></i> Restaurar
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async toggleStaffStatus(id, currentStatus) {
    const newStatus = (currentStatus === 'Activo') ? 'Inactivo' : 'Activo';
    try {
      this.showToast('Actualizando estado en PostgreSQL...');
      await window.db.updateStaff(id, { status: newStatus, estado: newStatus });
      this.showToast(`Estado cambiado a ${newStatus} con éxito`);
      await this.renderStaffList();
    } catch (e) {
      this.showHttpError(500, 'Error de Actualización', e.message);
    }
  }

  openDeleteConfirmModal(id, name) {
    this.pendingDeleteUserId = id;
    const nameEl = document.getElementById('delete-user-name');
    if (nameEl) nameEl.textContent = name;

    const modalEl = document.getElementById('confirmDeleteModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  async executeSoftDelete() {
    if (!this.pendingDeleteUserId) return;

    const btn = document.getElementById('btn-confirm-soft-delete');
    btn.disabled = true;
    btn.textContent = 'Procesando baja en BD...';

    try {
      await window.db.softDeleteStaff(this.pendingDeleteUserId);

      const modalEl = document.getElementById('confirmDeleteModal');
      const modal = window.bootstrap ? bootstrap.Modal.getInstance(modalEl) : null;
      if (modal) modal.hide();

      this.showToast('Usuario dado de baja lógicamente. Los datos se preservan en PostgreSQL.');
      await this.renderStaffList();
      await this.renderAdminMetrics();
    } catch (err) {
      this.showHttpError(err.status || 500, 'Error al Dar de Baja', err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-trash3-fill"></i> Confirmar Baja';
      this.pendingDeleteUserId = null;
    }
  }

  async restoreStaff(id) {
    try {
      this.showToast('Restaurando usuario en PostgreSQL...');
      await window.db.restoreStaff(id);
      this.showToast('Usuario restaurado exitosamente');
      await this.renderStaffList();
      await this.renderAdminMetrics();
    } catch (err) {
      this.showHttpError(500, 'Error al Restaurar', err.message);
    }
  }

  async openEditUserModal(id) {
    const allStaff = await window.db.getStaff(true);
    const user = allStaff.find(s => Number(s.id) === Number(id) || Number(s.id_usuario) === Number(id));
    if (!user) {
      this.showToast('Usuario no encontrado', 'error');
      return;
    }

    const isForeign = user.es_extranjero || (user.nacionalidad && !['peruana', 'peru', 'perú'].includes(user.nacionalidad.toLowerCase()));

    document.getElementById('edit-user-id').value = id;
    document.getElementById('edit-user-name').value = user.name || user.nombre || '';
    document.getElementById('edit-user-nationality').value = user.nacionalidad || 'Peruana';
    document.getElementById('edit-doc-type').value = (user.tipo_documento || 'DNI').toUpperCase();
    document.getElementById('edit-doc-number').value = user.numero_documento || '';
    document.getElementById('edit-user-phone').value = user.telefono || '';
    document.getElementById('edit-user-role').value = (user.rol || user.role || 'mozo').toLowerCase();
    document.getElementById('edit-user-status').value = user.status || user.estado || 'Activo';
    document.getElementById('edit-user-shift').value = user.shift || user.turno || 'Turno Mañana (8:00 AM - 4:00 PM)';

    if (isForeign) {
      document.getElementById('edit-origin-foreign').checked = true;
      this.handleEditOriginChange('extranjero');
    } else {
      document.getElementById('edit-origin-pe').checked = true;
      this.handleEditOriginChange('nacional');
    }

    const modalEl = document.getElementById('editUserModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  handleEditOriginChange(origin) {
    const isForeign = (origin === 'extranjero');
    const countryContainer = document.getElementById('edit-country-container');
    const docTypeSelect = document.getElementById('edit-doc-type');
    if (countryContainer) countryContainer.classList.toggle('d-none', !isForeign);
    if (docTypeSelect && !isForeign) {
      docTypeSelect.value = 'DNI';
    }
  }

  handleEditDocTypeChange(type) {
    const docLabel = document.getElementById('edit-doc-label');
    if (docLabel) {
      if (type === 'DNI') docLabel.textContent = 'N° DNI (8 dígitos) *';
      else if (type === 'PASAPORTE') docLabel.textContent = 'N° Pasaporte (6-12 carac.) *';
      else if (type === 'CARNET_EXTRANJERIA') docLabel.textContent = 'N° Carné de Extranjería *';
    }
  }

  async submitUserEdit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-user-id').value;
    const name = document.getElementById('edit-user-name').value.trim();
    const isForeign = document.getElementById('edit-origin-foreign')?.checked || false;
    const nationality = isForeign ? (document.getElementById('edit-user-nationality').value.trim() || 'Extranjera') : 'Peruana';
    const docType = document.getElementById('edit-doc-type').value;
    const docNumber = document.getElementById('edit-doc-number').value.trim();
    const phone = document.getElementById('edit-user-phone').value.trim();
    const role = document.getElementById('edit-user-role').value;
    const status = document.getElementById('edit-user-status').value;
    const shift = document.getElementById('edit-user-shift').value;

    const btn = document.getElementById('btn-save-edit-user');
    btn.disabled = true;
    btn.textContent = 'Guardando cambios...';

    try {
      await window.db.updateStaff(id, {
        name,
        nationality,
        docType,
        docNumber,
        phone,
        role,
        status,
        shift
      });

      const modalEl = document.getElementById('editUserModal');
      const modal = window.bootstrap ? bootstrap.Modal.getInstance(modalEl) : null;
      if (modal) modal.hide();

      this.showToast('Usuario actualizado con éxito en PostgreSQL');
      await this.renderStaffList();
    } catch (err) {
      this.showHttpError(err.status || 422, 'Error al Actualizar Usuario', err.message, err.errors);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar Cambios';
    }
  }

  showHttpError(statusCode, summary, detail, validationErrors = null) {
    const badge = document.getElementById('http-error-code-badge');
    const summaryEl = document.getElementById('http-error-summary');
    const detailEl = document.getElementById('http-error-detail');
    const listEl = document.getElementById('http-error-validation-list');

    if (badge) badge.textContent = `HTTP ${statusCode || 500}`;
    if (summaryEl) summaryEl.textContent = summary || 'Error en la operación';
    if (detailEl) detailEl.textContent = detail || 'El servidor devolvió una excepción.';

    if (listEl) {
      if (validationErrors && typeof validationErrors === 'object' && Object.keys(validationErrors).length > 0) {
        listEl.innerHTML = '<div class="alert alert-danger py-2 small mb-0"><ul class="mb-0 ps-3">' +
          Object.entries(validationErrors).map(([k, v]) => `<li><strong>${this.escapeHtml(k)}:</strong> ${this.escapeHtml(v)}</li>`).join('') +
          '</ul></div>';
        listEl.classList.remove('d-none');
      } else {
        listEl.classList.add('d-none');
      }
    }

    const modalEl = document.getElementById('httpErrorModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  // ==========================================
  // PANEL DE ADMINISTRADOR (PostgreSQL)
  // ==========================================

  async renderAdminMetrics() {
    const dashboardData = await window.db.getDashboard();
    if (!dashboardData || !dashboardData.metrics) return;
    const metrics = dashboardData.metrics;

    const elSales = document.getElementById('metric-sales');
    const elOrders = document.getElementById('metric-active-orders');
    const elTables = document.getElementById('metric-tables');
    const elTime = document.getElementById('metric-avg-time');

    if (elSales) elSales.textContent = metrics.ventas_hoy_formato || `S/ ${parseFloat(metrics.ventas_hoy || 0).toFixed(2)}`;
    if (elOrders) elOrders.textContent = metrics.pedidos_activos ?? 0;
    if (elTables) elTables.textContent = metrics.mesas_texto || '0 / 15';
    if (elTime) elTime.textContent = metrics.tiempo_promedio || '14 min';

    const containerOrders = document.getElementById('admin-orders-list');
    if (containerOrders && dashboardData.salon_monitor) {
      containerOrders.innerHTML = dashboardData.salon_monitor.map(ord => {
        const isReady = (ord.estado === 'listo');
        const badgeClass = isReady ? 'badge-status-ready' : 'badge-status-cooking';
        const numMesa = ord.numero_mesa ? String(ord.numero_mesa).padStart(2, '0') : '02';
        const numComanda = ord.numero_comanda || ord.id_pedido;
        const total = parseFloat(ord.total || 0).toFixed(2);

        return `
          <div class="order-monitoring-card">
            <div class="order-header-line">
              <span class="order-id-table">#${numComanda} • Mesa ${numMesa}</span>
              <span class="order-price">S/ ${total}</span>
            </div>
            <div class="order-footer-line">
              <span class="order-waiter-name">Mozo: ${this.escapeHtml(ord.mozo_nombre || 'Carlos Paredes')}</span>
              <span class="${badgeClass}">${this.escapeHtml(ord.badge_text || 'En cocina')}</span>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // ==========================================
  // COCINA KDS (PostgreSQL)
  // ==========================================

  async filterKds(tab) {
    this.activeKdsTab = tab;
    document.querySelectorAll('.kds-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    await this.renderKdsOrders();
  }

  async renderKdsOrders() {
    const container = document.getElementById('kds-orders-container');
    if (!container) return;

    const orders = await window.db.getOrders();

    const countNuevos = orders.filter(o => o.estado === 'pendiente').length;
    const countCocinando = orders.filter(o => o.estado === 'en_cocina').length;
    const countListos = orders.filter(o => o.estado === 'listo').length;

    const badgeNuevos = document.getElementById('kds-count-nuevos');
    const badgeCocinando = document.getElementById('kds-count-cocinando');
    const badgeListos = document.getElementById('kds-count-listos');
    if (badgeNuevos) badgeNuevos.textContent = countNuevos;
    if (badgeCocinando) badgeCocinando.textContent = countCocinando;
    if (badgeListos) badgeListos.textContent = countListos;

    let filtered = [];
    if (this.activeKdsTab === 'nuevos') {
      filtered = orders.filter(o => o.estado === 'pendiente');
    } else if (this.activeKdsTab === 'cocinando') {
      filtered = orders.filter(o => o.estado === 'en_cocina');
    } else if (this.activeKdsTab === 'listos') {
      filtered = orders.filter(o => o.estado === 'listo');
    } else {
      filtered = orders.filter(o => ['pendiente', 'en_cocina', 'listo'].includes(o.estado));
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="text-center py-5 text-secondary">
          <i class="bi bi-check2-circle fs-1 text-teal d-block mb-2"></i>
          <div class="fw-bold">No hay comandas en este estado</div>
          <small>Los nuevos pedidos ingresarán automáticamente</small>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(order => {
      const tableNum = String(order.numero_mesa || 1).padStart(2, '0');
      const comandaNum = order.numero_comanda || order.id_pedido;
      const timeFormatted = order.hora_formato || '10:45';
      const client = this.escapeHtml(order.nombre_cliente || 'Comensal');

      const items = order.items || [];
      const itemsHtml = items.map((item, idx) => `
        <div class="kds-dish-line ${idx === items.length - 1 ? 'mb-3' : ''}">
          <span class="kds-dish-qty">${item.cantidad ?? 1}x</span>
          <span class="text-white">${this.escapeHtml(item.nombre_plato || 'Plato')}</span>
          ${item.observaciones ? `<div class="kds-dish-note">* ${this.escapeHtml(item.observaciones)}</div>` : ''}
        </div>
      `).join('');

      let actionBtn = '';
      if (order.estado === 'pendiente') {
        actionBtn = `<button type="button" class="btn-kds-prepare" onclick="app.markKdsCooking(${order.id_pedido})">Preparar Pedido</button>`;
      } else if (order.estado === 'en_cocina') {
        actionBtn = `<button type="button" class="btn-kds-ready" onclick="app.markKdsReady(${order.id_pedido})">¡Plato Listo!</button>`;
      } else if (order.estado === 'listo') {
        actionBtn = `<button type="button" class="btn-kds-ready" style="opacity: 0.85" onclick="app.markKdsDelivered(${order.id_pedido})">✓ Entregar a Mozo</button>`;
      }

      return `
        <div class="kds-order-card" id="kds-card-${order.id_pedido}">
          <div class="kds-card-header">
            <div>
              <div class="kds-table-title">Mesa ${tableNum}</div>
              <small class="text-secondary">#${comandaNum} • Cliente: ${client}</small>
            </div>
            <span class="kds-card-time">${timeFormatted}</span>
          </div>
          ${itemsHtml}
          ${actionBtn}
        </div>
      `;
    }).join('');
  }

  async markKdsReady(orderId) {
    await window.db.updateOrderStatus(orderId, 'listo');
    this.showToast(`Comanda #${orderId} actualizada a LISTA en PostgreSQL`);
    await Promise.all([this.renderKdsOrders(), this.renderAdminMetrics(), this.renderTrackerOrder()]);
  }

  async markKdsCooking(orderId) {
    await window.db.updateOrderStatus(orderId, 'en_cocina');
    this.showToast(`Comanda #${orderId} puesta en preparación`);
    await Promise.all([this.renderKdsOrders(), this.renderAdminMetrics(), this.renderTrackerOrder()]);
  }

  async markKdsDelivered(orderId) {
    await window.db.updateOrderStatus(orderId, 'entregado');
    this.showToast(`Comanda #${orderId} entregada en mesa`);
    await Promise.all([this.renderKdsOrders(), this.renderAdminMetrics(), this.renderTrackerOrder()]);
  }

  // ==========================================
  // CARTA DIGITAL QR & CARRITO (PostgreSQL)
  // ==========================================

  filterCategory(category, btn) {
    this.activeCategory = category;
    document.querySelectorAll('#category-pills-container .category-pill').forEach(pill => pill.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this.renderMenuDishes();
  }

  searchMenu(term) {
    this.searchTerm = (term || '').trim().toLowerCase();
    this.renderMenuDishes();
  }

  async renderMenuDishes() {
    const container = document.getElementById('menu-dishes-container') || document.getElementById('dishes-list-container');
    if (!container) return;

    if (!this.productsCache) {
      this.productsCache = await window.db.getProducts();
    }
    let dishes = [...this.productsCache];

    if (this.activeCategory !== 'Todos') {
      dishes = dishes.filter(d => (d.categoria_nombre || d.category) === this.activeCategory);
    }

    if (this.searchTerm) {
      dishes = dishes.filter(d =>
        (d.name || '').toLowerCase().includes(this.searchTerm) ||
        (d.description || '').toLowerCase().includes(this.searchTerm)
      );
    }

    if (dishes.length === 0) {
      container.innerHTML = `
        <div class="text-center py-5 text-secondary">
          <i class="bi bi-search fs-2 mb-2 d-block"></i>
          <div class="fw-bold">No se encontraron platos</div>
          <small>Intenta con otra categoría o término de búsqueda</small>
        </div>
      `;
      return;
    }

    container.innerHTML = dishes.map(d => {
      const price = parseFloat(d.price).toFixed(2);
      const isPopular = d.destacado_menu || d.popular;
      const imgUrl = d.image || d.imagen_url || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80';

      return `
        <div class="dish-item-card">
          <img src="${this.escapeHtml(imgUrl)}" alt="${this.escapeHtml(d.name)}" class="dish-img-thumb" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80'">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center justify-content-between gap-2">
              <h4 class="dish-name-title mb-1">${this.escapeHtml(d.name)}</h4>
              ${isPopular ? '<span class="badge bg-warning text-dark small fw-bold px-2 py-0" style="font-size: 0.72rem; border-radius: 6px;">★ Popular</span>' : ''}
            </div>
            <p class="dish-desc-text">${this.escapeHtml(d.description || '')}</p>
            <div class="d-flex justify-content-between align-items-center">
              <span class="dish-price-text">S/ ${price}</span>
              <button type="button" class="btn-add-dish" onclick="app.addToCart(${Number(d.id)})" title="Agregar al pedido">
                <i class="bi bi-plus"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  async addToCart(dishId) {
    if (!this.productsCache) {
      this.productsCache = await window.db.getProducts();
    }
    const dish = this.productsCache.find(d => Number(d.id) === Number(dishId));
    if (!dish) return;

    const existing = this.cart.find(item => Number(item.id) === Number(dishId));
    if (existing) {
      existing.qty++;
      existing.cantidad = existing.qty;
    } else {
      this.cart.push({
        id: dish.id,
        id_producto: dish.id,
        name: dish.name,
        price: parseFloat(dish.price),
        precio: parseFloat(dish.price),
        qty: 1,
        cantidad: 1
      });
    }

    this.updateCartBar(true);
    this.showToast(`¡Agregado: ${dish.name}!`);
  }

  updateCartBar(animate = false) {
    const bar = document.getElementById('cart-floating-bar');
    if (!bar) return;

    const totalItems = this.cart.reduce((sum, item) => sum + (item.qty || item.cantidad || 1), 0);
    const totalPrice = this.cart.reduce((sum, item) => sum + ((item.price || item.precio || 0) * (item.qty || item.cantidad || 1)), 0);

    const countEl = document.getElementById('cart-item-count') || document.getElementById('cart-items-count');
    const totalEl = document.getElementById('cart-total-amount') || document.getElementById('cart-total-price');

    if (countEl) {
      countEl.textContent = `${totalItems} ${totalItems === 1 ? 'item' : 'items'}`;
      if (animate) {
        countEl.classList.remove('cart-pop');
        void countEl.offsetWidth;
        countEl.classList.add('cart-pop');
      }
    }
    if (totalEl) totalEl.textContent = `S/ ${totalPrice.toFixed(2)}`;

    bar.style.display = totalItems > 0 ? 'flex' : 'none';
  }

  async checkoutCart() {
    if (this.cart.length === 0) {
      this.showToast('El carrito está vacío. Agrega platos primero.', 'error');
      return;
    }

    try {
      this.showToast('Enviando comanda a la cocina (PostgreSQL)...');
      const currentUser = window.AuthService.getCurrentUser();
      const waiterName = currentUser?.name || 'Carlos Paredes';
      const result = await window.db.createOrder({
        table_num: 4,
        client_name: currentUser?.name || 'Cliente Mesa 04',
        waiter_name: waiterName,
        items: this.cart
      });

      this.showToast(`Comanda #${result.numero_comanda} creada exitosamente en PostgreSQL`);
      this.cart = [];
      this.updateCartBar();
      await Promise.all([
        this.renderKdsOrders(),
        this.renderAdminMetrics(),
        this.renderTrackerOrder()
      ]);
      this.showScreen('tracker');
    } catch (err) {
      this.showToast(`Error al procesar comanda: ${err.message}`, 'error');
    }
  }

  // ==========================================
  // TRACKER DE PEDIDO EN VIVO (PostgreSQL)
  // ==========================================

  async renderTrackerOrder() {
    const orders = await window.db.getOrders();
    if (!orders || orders.length === 0) return;

    const activeOrder = orders[0];
    const comandaNum = activeOrder.numero_comanda || activeOrder.id_pedido;
    const numMesa = activeOrder.numero_mesa ? String(activeOrder.numero_mesa).padStart(2, '0') : '04';

    const orderNumEl = document.getElementById('tracker-order-num');
    if (orderNumEl) orderNumEl.textContent = `Pedido • #${comandaNum}`;

    const tableBadge = document.querySelector('#screen-tracker .table-pill-badge');
    if (tableBadge) tableBadge.textContent = `Mesa #${numMesa}`;

    const badge = document.getElementById('tracker-status-badge');
    if (badge) {
      badge.style.backgroundColor = '';
      if (activeOrder.estado === 'pendiente') {
        badge.textContent = 'Pendiente en Cocina';
        badge.className = 'badge-status-cooking';
      } else if (activeOrder.estado === 'en_cocina') {
        badge.textContent = 'En cocina';
        badge.className = 'badge-status-cooking';
      } else if (activeOrder.estado === 'listo') {
        badge.textContent = '¡Listo para Servir!';
        badge.className = 'badge-status-ready';
      } else if (activeOrder.estado === 'entregado') {
        badge.textContent = 'Entregado en Mesa';
        badge.className = 'badge-status-ready';
      }
    }

    const stepReady = document.getElementById('step-ready');
    const stepDelivered = document.getElementById('step-delivered');

    if (activeOrder.estado === 'listo') {
      if (stepReady) {
        stepReady.classList.remove('opacity-75');
        const m = stepReady.querySelector('.step-marker');
        if (m) { m.textContent = '✓'; m.className = 'step-marker text-success'; }
      }
    } else if (activeOrder.estado === 'entregado') {
      if (stepReady) {
        stepReady.classList.remove('opacity-75');
        const m = stepReady.querySelector('.step-marker');
        if (m) { m.textContent = '✓'; m.className = 'step-marker text-success'; }
      }
      if (stepDelivered) {
        stepDelivered.classList.remove('opacity-50');
        const m = stepDelivered.querySelector('.step-marker');
        if (m) { m.textContent = '✓'; m.className = 'step-marker text-success'; }
      }
    }

    const dishesBox = document.getElementById('tracker-dishes-box');
    if (dishesBox && activeOrder.items && activeOrder.items.length > 0) {
      dishesBox.innerHTML = `
        <div class="fw-bold fs-6 text-dark mb-2">Platos en este pedido:</div>
        ${activeOrder.items.map(item => `
          <div class="text-secondary small mb-1">• ${item.cantidad ?? 1}x ${this.escapeHtml(item.nombre_plato)} ${item.observaciones ? `(*${this.escapeHtml(item.observaciones)})` : ''}</div>
        `).join('')}
      `;
    }
  }

  // ==========================================
  // UTILIDADES: RELOJ Y NOTIFICACIONES
  // ==========================================

  initLiveClock() {
    const updateTime = () => {
      const now = new Date();
      let hours = now.getHours();
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const str = `${hours}:${minutes} ${ampm}`;

      const kdsClock = document.getElementById('kds-clock') || document.getElementById('kds-live-clock');
      if (kdsClock) kdsClock.textContent = str;
    };
    updateTime();
    setInterval(updateTime, 30000);
  }

  showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container-melidan';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-melidan';
    const icon = type === 'error'
      ? 'bi-exclamation-triangle-fill text-danger'
      : 'bi-check-circle-fill text-success';
    toast.innerHTML = `<i class="bi ${icon}"></i><span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3000);
  }

  async showElectronicReceipt() {
    this.showToast('Consultando comprobante en PostgreSQL (melidan_db)...');
    const receipt = await window.db.getReceipt();
    if (!receipt) {
      this.showToast('No se encontró comprobante registrado en PostgreSQL aún.', 'error');
      return;
    }

    const existing = document.getElementById('spaReceiptModal');
    if (existing) existing.remove();

    const modalHtml = `
      <div class="modal fade" id="spaReceiptModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" style="max-width: 410px;">
          <div class="modal-content rounded-4 shadow-lg p-3">
            <div class="modal-header border-0 pb-0 position-relative">
              <div class="text-center w-100">
                <h4 class="fw-bold mb-1 text-dark">${this.escapeHtml(receipt.restaurante?.nombre || 'Melidan Restaurante')}</h4>
                <p class="text-secondary small mb-1">${this.escapeHtml(receipt.restaurante?.slogan || 'Tradición y sabor a fuego lento')}</p>
                <div class="badge bg-warning text-dark px-3 py-1 mb-2 fw-bold">RUC: ${this.escapeHtml(receipt.restaurante?.ruc || '20601234567')}</div>
                <div class="text-muted small">${this.escapeHtml(receipt.restaurante?.direccion || '')}</div>
              </div>
              <button type="button" class="btn-close position-absolute top-0 end-0 m-3" data-bs-dismiss="modal" aria-label="Cerrar"></button>
            </div>
            <div class="modal-body border-top border-bottom my-3 py-3">
              <div class="d-flex justify-content-between mb-1 small">
                <span class="text-muted">Comprobante:</span>
                <span class="fw-bold text-dark">${this.escapeHtml((receipt.tipo_comprobante || 'BOLETA').toUpperCase())}: ${this.escapeHtml(receipt.numero_comprobante)}</span>
              </div>
              <div class="d-flex justify-content-between mb-1 small">
                <span class="text-muted">Fecha Emisión:</span>
                <span class="text-dark">${this.escapeHtml(receipt.fecha_formato || 'Hoy')}</span>
              </div>
              <div class="d-flex justify-content-between mb-1 small">
                <span class="text-muted">Mesa:</span>
                <span class="fw-bold text-dark">Mesa ${String(receipt.numero_mesa || '04').padStart(2, '0')}</span>
              </div>
              <div class="d-flex justify-content-between mb-3 small">
                <span class="text-muted">Cliente:</span>
                <span class="text-dark">${this.escapeHtml(receipt.nombre_cliente || 'Comensal')}</span>
              </div>

              <div class="fw-bold small mb-2 text-dark border-top pt-2">Detalle de Consumo:</div>
              ${(receipt.items || []).map(it => `
                <div class="d-flex justify-content-between small mb-1">
                  <span>${it.cantidad ?? 1}x ${this.escapeHtml(it.nombre_plato)}</span>
                  <span class="fw-bold">S/ ${parseFloat(it.subtotal || (it.cantidad * it.precio_unitario) || 0).toFixed(2)}</span>
                </div>
              `).join('')}

              <div class="border-top pt-2 mt-2">
                <div class="d-flex justify-content-between small text-muted">
                  <span>Op. Gravada:</span>
                  <span>S/ ${this.escapeHtml(receipt.desglose?.subtotal || '0.00')}</span>
                </div>
                <div class="d-flex justify-content-between small text-muted">
                  <span>I.G.V. (18%):</span>
                  <span>S/ ${this.escapeHtml(receipt.desglose?.igv || '0.00')}</span>
                </div>
                <div class="d-flex justify-content-between fs-5 fw-bold text-dark mt-1">
                  <span>TOTAL:</span>
                  <span class="text-success">S/ ${this.escapeHtml(receipt.desglose?.total || receipt.monto_total)}</span>
                </div>
                <div class="small text-muted text-center mt-2">
                  <span class="badge bg-success-subtle text-success">Pago ${this.escapeHtml((receipt.metodo_pago || 'efectivo').replace('_', ' ').toUpperCase())} • Exitoso</span>
                </div>
              </div>
            </div>
            <div class="modal-footer border-0 pt-0 d-flex gap-2">
              <button type="button" class="btn btn-outline-secondary rounded-3 flex-fill fw-bold" data-bs-dismiss="modal">Cerrar</button>
              <button type="button" class="btn btn-melidan-teal rounded-3 flex-fill fw-bold" onclick="window.print()">Imprimir PDF</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    const modalEl = document.getElementById('spaReceiptModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  async callWaiter() {
    const orders = await window.db.getOrders();
    const activeOrder = orders[0];
    const waiter = activeOrder?.mozo_nombre || 'Carlos Paredes';
    const table = String(activeOrder?.numero_mesa || 4).padStart(2, '0');
    this.showToast(`🛎️ Mozo ${waiter} notificado a la Mesa ${table}. ¡Viene en camino!`);
  }

  logout() {
    window.AuthService.logout();
    this.currentRecoveryEmail = '';
    this.currentRecoveryCode = '';

    const passwordInput = document.getElementById('login-password');
    if (passwordInput) {
      passwordInput.value = '';
    }

    const bottomBar = document.getElementById('app-bottom-bar');
    if (bottomBar) bottomBar.style.display = 'none';

    this.showScreen('login');
    this.showToast('Sesión cerrada correctamente.');
  }

  async quickLogin(email, password = 'password123') {
    const elEmail = document.getElementById('login-email');
    const elPass = document.getElementById('login-password');
    if (elEmail) elEmail.value = email;
    if (elPass) elPass.value = password;
    this.showToast(`Iniciando sesión como ${email}...`);

    try {
      const user = await window.AuthService.login(email, password);
      const targetHtml = window.RBAC ? window.RBAC.getHomeUrl(user) : '/carta.html';
      this.showToast(`¡Bienvenido ${user.name}! Redirigiendo...`);
      setTimeout(() => {
        window.location.href = targetHtml;
      }, 360);
    } catch (err) {
      this.showToast(`Error al autenticar: ${err.message}`, 'error');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});

