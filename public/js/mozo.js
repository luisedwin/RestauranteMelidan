/**
 * mozo.js - Lógica del Módulo Mozo y Control de Mesas y Aforo (Melidan)
 */

const mozoApp = {
  tables: [],
  products: [],
  selectedMesa: null,
  activeTab: 'tables',
  cart: [],

  async init() {
    await this.loadTables();
    this.setupListeners();
    await this.renderMenu();
  },

  async loadTables() {
    try {
      const res = await window.db.getMesas();
      if (res && res.data) {
        this.tables = res.data;
        this.updateCounters(res.counts);
      }
      this.renderTablesGrid();
    } catch (e) {
      console.error('[MozoApp] Error cargando mesas:', e);
      this.showToast('⚠️ Error al sincronizar el plano de mesas', 'error');
    }
  },

  updateCounters(counts) {
    if (!counts) {
      counts = { libre: 0, ocupada: 0, por_limpiar: 0, cuenta: 0 };
      this.tables.forEach((t) => {
        const est = this.normalizeState(t.estado);
        if (counts[est] !== undefined) counts[est]++;
      });
    }

    const elLibre = document.getElementById('count-libre');
    const elOcupada = document.getElementById('count-ocupada');
    const elLimpiar = document.getElementById('count-limpiar');
    const elCuenta = document.getElementById('count-cuenta');

    if (elLibre) elLibre.textContent = counts.libre ?? 0;
    if (elOcupada) elOcupada.textContent = counts.ocupada ?? 0;
    if (elLimpiar) elLimpiar.textContent = counts.por_limpiar ?? 0;
    if (elCuenta) elCuenta.textContent = counts.cuenta ?? 0;
  },

  normalizeState(state) {
    if (!state) return 'libre';
    const s = state.toLowerCase().trim();
    if (s === 'disponible' || s === 'free') return 'libre';
    if (s === 'occupied') return 'ocupada';
    if (s === 'cleaning') return 'por_limpiar';
    if (s === 'bill') return 'cuenta';
    return s;
  },

  renderTablesGrid() {
    const grid = document.getElementById('tables-grid-container');
    if (!grid) return;

    grid.innerHTML = this.tables.map((t) => {
      const num = Number(t.numero_mesa || t.num || t.id);
      const numFormatted = `Mesa ${String(num).padStart(2, '0')}`;
      const state = this.normalizeState(t.estado);
      const cap = t.capacidad || 4;
      const dinersText = `${cap} personas`;

      let timeText = 'Libre';
      let statusClass = 'status-free';

      if (state === 'libre') {
        timeText = 'Libre';
        statusClass = 'status-free';
      } else if (state === 'ocupada') {
        const min = t.tiempo_min || 15;
        timeText = `${min} min`;
        statusClass = 'status-occupied';
      } else if (state === 'por_limpiar') {
        timeText = 'Por limpiar';
        statusClass = 'status-cleaning';
      } else if (state === 'cuenta') {
        const min = t.tiempo_min || 45;
        timeText = `${min} min`;
        statusClass = 'status-bill';
      }

      return `
        <div class="table-node ${statusClass}" onclick="mozoApp.openMesaModal(${num})">
          <div class="table-number">${numFormatted}</div>
          <div class="table-time">${timeText}</div>
          <div class="table-capacity">${dinersText}</div>
        </div>
      `;
    }).join('');
  },

  openMesaModal(numeroMesa) {
    const mesa = this.tables.find((t) => Number(t.numero_mesa) === Number(numeroMesa));
    if (!mesa) return;

    this.selectedMesa = mesa;
    const numFormatted = `Mesa ${String(numeroMesa).padStart(2, '0')}`;
    const state = this.normalizeState(mesa.estado);

    const titleEl = document.getElementById('modal-mesa-title');
    const badgeEl = document.getElementById('modal-mesa-status-badge');
    const waiterEl = document.getElementById('modal-mesa-waiter');
    const dinersEl = document.getElementById('modal-mesa-diners');
    const timeEl = document.getElementById('modal-mesa-time');
    const amountEl = document.getElementById('modal-mesa-amount');

    if (titleEl) titleEl.textContent = numFormatted;

    const statusBadges = {
      libre: '<span class="badge bg-success">🟢 Libre (Disponible)</span>',
      ocupada: '<span class="badge bg-warning text-dark">🟠 Ocupada</span>',
      por_limpiar: '<span class="badge bg-primary">🔵 Por Limpiar</span>',
      cuenta: '<span class="badge bg-danger">🔴 Cuenta Solicitada</span>'
    };

    if (badgeEl) badgeEl.innerHTML = statusBadges[state] || state;
    if (waiterEl) waiterEl.textContent = (!mesa.mozo_asignado || mesa.mozo_asignado === '-') ? 'Sin asignar' : mesa.mozo_asignado;
    if (dinersEl) dinersEl.textContent = `${mesa.capacidad || 4} comensales`;
    if (timeEl) timeEl.textContent = state === 'libre' ? 'Disponible ahora' : `${mesa.tiempo_min || 0} min`;
    if (amountEl) amountEl.textContent = `S/ ${Number(mesa.monto_acumulado || 0).toFixed(2)}`;

    const modalEl = document.getElementById('mesaActionModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  async changeMesaStatus(nuevoEstado) {
    if (!this.selectedMesa) return;
    const num = this.selectedMesa.numero_mesa;
    const currentUser = window.AuthService?.getCurrentUser?.();

    let min = 0;
    let waiter = undefined;
    if (nuevoEstado === 'ocupada') {
      min = 15;
      if (!this.selectedMesa.mozo_asignado || this.selectedMesa.mozo_asignado === '-') {
        waiter = currentUser?.name || 'Carlos Paredes';
      }
    } else if (nuevoEstado === 'cuenta') {
      min = Math.max(Number(this.selectedMesa.tiempo_min || 0), 30);
    }

    try {
      await window.db.updateMesa(num, nuevoEstado, min, waiter);
      this.showToast(`✅ Mesa ${String(num).padStart(2, '0')} actualizada a: ${nuevoEstado.replace('_', ' ').toUpperCase()}`);

      const modalEl = document.getElementById('mesaActionModal');
      if (modalEl && window.bootstrap) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }

      await this.loadTables();
    } catch (e) {
      console.error(e);
      this.showToast('⚠️ Error al actualizar el estado de la mesa', 'error');
    }
  },

  goToOrderForMesa() {
    if (!this.selectedMesa) return;
    const num = this.selectedMesa.numero_mesa;

    const modalEl = document.getElementById('mesaActionModal');
    if (modalEl && window.bootstrap) {
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();
    }

    this.switchTab('menu');
    const sel = document.getElementById('order-table-select');
    if (sel) sel.value = num;

    this.showToast(`📝 Tomando comanda para Mesa ${String(num).padStart(2, '0')}`);
  },

  openCartaForMesa() {
    const num = this.selectedMesa?.numero_mesa || 4;
    window.location.href = `/carta.html?mesa=${encodeURIComponent(num)}`;
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.mozo-view-tab').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.mozo-nav-btn').forEach((b) => b.classList.remove('active'));

    const activeView = document.getElementById(`mozo-view-${tab}`);
    const activeNav = document.getElementById(`mozo-nav-${tab}`);

    if (activeView) activeView.classList.add('active');
    if (activeNav) activeNav.classList.add('active');

    if (tab === 'tables') {
      this.loadTables();
    }
  },

  setupListeners() {
    document.querySelectorAll('.mozo-nav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (tab) this.switchTab(tab);
      });
    });
  },

  async renderMenu() {
    const container = document.getElementById('mozo-menu-container');
    if (!container) return;

    try {
      this.products = await window.db.getProducts();
      container.innerHTML = this.products.map((d) => `
        <div class="menu-item-card">
          <img src="${d.image}" class="menu-item-img" alt="${d.name}" onerror="this.src='https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80'">
          <div class="menu-item-info">
            <h6 class="menu-item-title">${d.name}</h6>
            <span class="badge bg-light text-secondary border small mb-1">${d.category || 'Carta'}</span>
            <div class="menu-item-price">S/ ${Number(d.price).toFixed(2)}</div>
          </div>
          <button class="btn btn-sm btn-melidan-orange" onclick="mozoApp.addToCart(${d.id})">
            <i class="bi bi-plus-lg"></i> Agregar
          </button>
        </div>
      `).join('');
    } catch (e) {
      console.error('[MozoApp] Error cargando carta:', e);
    }
  },

  async addToCart(dishId) {
    if (!this.products.length) {
      this.products = await window.db.getProducts();
    }
    const dish = this.products.find((d) => Number(d.id) === Number(dishId));
    if (!dish) return;

    const existing = this.cart.find((i) => Number(i.id) === Number(dishId));
    if (existing) {
      existing.quantity++;
    } else {
      this.cart.push({ ...dish, quantity: 1, observations: '' });
    }

    this.renderCart();
    const badge = document.getElementById('mozo-cart-badge');
    if (badge) {
      badge.classList.remove('cart-pop');
      void badge.offsetWidth;
      badge.classList.add('cart-pop');
    }
    this.showToast(`🛒 ${dish.name} añadido a la comanda`);
  },

  renderCart() {
    const container = document.getElementById('mozo-cart-items');
    const totalEl = document.getElementById('mozo-cart-total');
    const countEl = document.getElementById('mozo-cart-badge');

    if (!container) return;

    const total = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const count = this.cart.reduce((sum, item) => sum + item.quantity, 0);

    if (totalEl) totalEl.textContent = `S/ ${total.toFixed(2)}`;
    if (countEl) countEl.textContent = count;

    if (this.cart.length === 0) {
      container.innerHTML = '<p class="text-muted small text-center my-3">No hay ítems en la comanda actual.</p>';
      return;
    }

    container.innerHTML = this.cart.map((item, idx) => `
      <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
        <div>
          <div class="fw-bold small">${item.name}</div>
          <div class="text-muted" style="font-size: 0.75rem;">S/ ${item.price.toFixed(2)} c/u</div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="mozoApp.adjustQty(${idx}, -1)">-</button>
          <span class="fw-bold small">${item.quantity}</span>
          <button class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="mozoApp.adjustQty(${idx}, 1)">+</button>
        </div>
      </div>
    `).join('');
  },

  adjustQty(idx, delta) {
    if (!this.cart[idx]) return;
    this.cart[idx].quantity += delta;
    if (this.cart[idx].quantity <= 0) {
      this.cart.splice(idx, 1);
    }
    this.renderCart();
  },

  async submitOrder() {
    if (this.cart.length === 0) {
      this.showToast('⚠️ Agrega al menos un plato a la comanda', 'error');
      return;
    }

    const tableSelect = document.getElementById('order-table-select');
    const mesaNum = tableSelect ? Number(tableSelect.value) : 1;
    const clientName = document.getElementById('order-client-name')?.value.trim() || 'Comensal';
    const currentUser = window.AuthService?.getCurrentUser?.();
    const waiterName = currentUser?.name || 'Carlos Paredes';

    try {
      const order = await window.db.createOrder({
        table_num: mesaNum,
        client_name: clientName,
        id_usuario: currentUser?.db_id || null,
        waiter_name: waiterName,
        items: this.cart.map((i) => ({
          id_producto: i.id,
          cantidad: i.quantity,
          observaciones: i.observations || ''
        }))
      });

      this.cart = [];
      this.renderCart();
      const clientInput = document.getElementById('order-client-name');
      if (clientInput) clientInput.value = '';
      this.showToast(`🔥 ¡Comanda #${order.numero_comanda} enviada a COCINA para Mesa ${String(mesaNum).padStart(2, '0')}!`);
      this.switchTab('tables');
    } catch (e) {
      console.error(e);
      this.showToast(`⚠️ ${e.message || 'Error al registrar pedido'}`, 'error');
    }
  },

  showToast(msg, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container-melidan';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-melidan';
    const icon = type === 'error' ? 'bi-exclamation-triangle-fill text-danger' : 'bi-check-circle-fill text-success';
    toast.innerHTML = `<i class="bi ${icon}"></i> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => mozoApp.init());

