/**
 * mozo.js - Lógica del Módulo Mozo y Control de Mesas y Aforo (Melidan)
 * - Clic fuera del panel o en la mesa para cerrar (sin botón "Volver a Mesas")
 * - Comentarios opcionales por plato y generales solo cuando el cliente lo requiera
 * - Alertas en vivo de comandas listas desde Cocina KDS
 */

const mozoApp = {
  tables: [],
  activeOrders: [],
  products: [],
  menuSearch: '',
  selectedMesa: null,
  cart: [],
  orderCommentEnabled: false,
  isLoadingTables: false,
  isSubmittingOrder: false,
  isUpdatingMesa: false,
  lastTablesHtml: '',

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  async init() {
    await Promise.all([
      this.loadTables(false),
      this.loadProducts()
    ]);
    this.setupListeners();
    setInterval(() => {
      if (!document.hidden) this.loadTables(false);
    }, 15000);
  },

  async loadTables(manual = false) {
    if (this.isLoadingTables && !manual) return;
    this.isLoadingTables = true;
    try {
      const [mesasRes, orders] = await Promise.all([
        window.db.getMesas(),
        window.db.getOrders().catch(() => [])
      ]);
      this.activeOrders = Array.isArray(orders)
        ? orders.filter((o) => ['pendiente', 'en_cocina', 'listo'].includes(o.estado))
        : [];

      if (mesasRes && mesasRes.data) {
        this.tables = mesasRes.data;
        this.updateCounters(mesasRes.counts);
      }
      this.renderTablesGrid();
      if (manual) this.showToast('🔄 Plano de mesas actualizado');
    } catch (e) {
      console.error('[MozoApp] Error cargando mesas:', e);
      if (manual || this.tables.length === 0) {
        this.showToast('⚠️ Error al sincronizar el plano de mesas', 'error');
      }
    } finally {
      this.isLoadingTables = false;
    }
  },

  async loadProducts() {
    try {
      this.products = await window.db.getProducts();
      this.renderMenu();
    } catch (e) {
      console.error('[MozoApp] Error cargando carta:', e);
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

  getReadyOrdersForMesa(numeroMesa) {
    return this.activeOrders.filter((o) => Number(o.numero_mesa) === Number(numeroMesa) && o.estado === 'listo');
  },

  renderTablesGrid() {
    const grid = document.getElementById('tables-grid-container');
    if (!grid) return;

    const nextHtml = this.tables.map((t) => {
      const num = Number(t.numero_mesa || t.num || t.id);
      const numFormatted = `Mesa ${String(num).padStart(2, '0')}`;
      const state = this.normalizeState(t.estado);
      const cap = t.capacidad || 4;
      const dinersText = `${cap} personas`;
      const readyCount = this.getReadyOrdersForMesa(num).length;

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
          ${readyCount > 0 ? `<span class="table-kds-ready-pill"><i class="bi bi-bell-fill"></i> Listo</span>` : ''}
          <div class="table-number">${numFormatted}</div>
          <div class="table-time">${timeText}</div>
          <div class="table-capacity">${dinersText}</div>
        </div>
      `;
    }).join('');
    if (nextHtml !== this.lastTablesHtml) {
      grid.innerHTML = nextHtml;
      this.lastTablesHtml = nextHtml;
    }
  },

  openMesaModal(numeroMesa) {
    const mesa = this.tables.find((t) => Number(t.numero_mesa) === Number(numeroMesa));
    if (!mesa) return;

    const modalEl = document.getElementById('mesaActionModal');
    // Si ya está abierto para esta misma mesa, hacer clic la cierra
    if (modalEl && modalEl.classList.contains('show') && this.selectedMesa && Number(this.selectedMesa.numero_mesa) === Number(numeroMesa)) {
      const inst = bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
      return;
    }

    this.selectedMesa = mesa;
    const numFormatted = `Mesa ${String(numeroMesa).padStart(2, '0')}`;
    const state = this.normalizeState(mesa.estado);

    const titleEl = document.getElementById('modal-mesa-title');
    const badgeEl = document.getElementById('modal-mesa-status-badge');
    const waiterEl = document.getElementById('modal-mesa-waiter');
    const dinersEl = document.getElementById('modal-mesa-diners');
    const timeEl = document.getElementById('modal-mesa-time');
    const amountEl = document.getElementById('modal-mesa-amount');
    const kdsAlert = document.getElementById('modal-mesa-kds-alert');

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

    const readyOrders = this.getReadyOrdersForMesa(numeroMesa);
    if (kdsAlert) {
      if (readyOrders.length > 0) {
        kdsAlert.classList.remove('d-none');
        kdsAlert.innerHTML = `<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">🔔 Cocina tiene ${readyOrders.length} comanda(s) LISTA(S) para servir</span>`;
      } else {
        kdsAlert.classList.add('d-none');
        kdsAlert.innerHTML = '';
      }
    }

    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  async changeMesaStatus(nuevoEstado) {
    if (!this.selectedMesa || this.isUpdatingMesa) return;
    this.isUpdatingMesa = true;
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

      await this.loadTables(false);
    } catch (e) {
      console.error(e);
      this.showToast('⚠️ Error al actualizar el estado de la mesa', 'error');
    } finally {
      this.isUpdatingMesa = false;
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

    this.openOrderDrawer(num);
  },

  openCartaForMesa() {
    const num = this.selectedMesa?.numero_mesa || 4;
    window.location.href = `/carta.html?mesa=${encodeURIComponent(num)}`;
  },

  openOrderDrawer(mesaNum) {
    const overlay = document.getElementById('mozo-order-overlay');
    if (!overlay) return;
    if (mesaNum) {
      const sel = document.getElementById('order-table-select');
      if (sel) sel.value = String(mesaNum);
    }
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (!this.products.length) this.loadProducts();
  },

  closeOrderDrawer() {
    const overlay = document.getElementById('mozo-order-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  },

  handleOverlayBackdropClick(event) {
    if (event.target && event.target.id === 'mozo-order-overlay') {
      this.closeOrderDrawer();
    }
  },

  setupListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('mozo-order-overlay');
        if (overlay && overlay.classList.contains('open')) {
          this.closeOrderDrawer();
        }
      }
    });
  },

  filterMenu(query) {
    this.menuSearch = String(query || '').toLowerCase().trim();
    this.renderMenu();
  },

  renderMenu() {
    const container = document.getElementById('mozo-menu-container');
    if (!container) return;

    const filtered = this.products.filter((d) => {
      if (!this.menuSearch) return true;
      const hay = `${d.name} ${d.category || ''} ${d.description || ''}`.toLowerCase();
      return hay.includes(this.menuSearch);
    });

    if (filtered.length === 0) {
      container.innerHTML = '<p class="text-muted small text-center py-4">No se encontraron platos con ese nombre.</p>';
      return;
    }

    container.innerHTML = filtered.map((d) => `
      <div class="menu-item-card">
        <img src="${this.escapeHtml(d.image)}" class="menu-item-img" alt="${this.escapeHtml(d.name)}" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80'">
        <div class="menu-item-info">
          <h6 class="menu-item-title">${this.escapeHtml(d.name)}</h6>
          <span class="badge bg-light text-secondary border small mb-1">${this.escapeHtml(d.category || 'Carta')}</span>
          <div class="menu-item-price">S/ ${Number(d.price).toFixed(2)}</div>
        </div>
        <button type="button" class="btn btn-sm btn-melidan-orange" onclick="mozoApp.addToCart(${d.id})">
          <i class="bi bi-plus-lg"></i> Agregar
        </button>
      </div>
    `).join('');
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
      this.cart.push({
        ...dish,
        price: Number(dish.price),
        quantity: 1,
        observations: '',
        showNote: false
      });
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

  toggleItemNote(idx) {
    if (!this.cart[idx]) return;
    this.cart[idx].showNote = !this.cart[idx].showNote;
    this.renderCart();
  },

  updateItemNote(idx, value) {
    if (!this.cart[idx]) return;
    this.cart[idx].observations = value;
  },

  toggleOrderComment(enabled) {
    this.orderCommentEnabled = Boolean(enabled);
    const wrap = document.getElementById('mozo-comment-wrap');
    if (wrap) wrap.classList.toggle('d-none', !this.orderCommentEnabled);
    if (!this.orderCommentEnabled) {
      const ta = document.getElementById('mozo-order-comment');
      if (ta) ta.value = '';
    }
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
      <div class="mozo-cart-item-block">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <div>
            <div class="fw-bold small">${this.escapeHtml(item.name)}</div>
            <div class="text-muted" style="font-size: 0.75rem;">S/ ${item.price.toFixed(2)} c/u</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="mozoApp.adjustQty(${idx}, -1)">-</button>
            <span class="fw-bold small">${item.quantity}</span>
            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="mozoApp.adjustQty(${idx}, 1)">+</button>
          </div>
        </div>
        <div class="mt-1">
          <button type="button" class="mozo-note-toggle-btn" onclick="mozoApp.toggleItemNote(${idx})">
            <i class="bi bi-chat-dots"></i>
            <span>${item.showNote ? 'Ocultar nota' : (item.observations ? `Nota: "${this.escapeHtml(item.observations.slice(0, 26))}"` : '+ Agregar comentario al plato')}</span>
          </button>
          ${item.showNote ? `
            <input
              type="text"
              class="form-control form-control-melidan form-control-sm mt-1"
              placeholder="Ej. sin ají, término medio, sin hielo..."
              value="${this.escapeHtml(item.observations || '')}"
              oninput="mozoApp.updateItemNote(${idx}, this.value)"
            >
          ` : ''}
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
    if (this.isSubmittingOrder) return;
    if (this.cart.length === 0) {
      this.showToast('⚠️ Agrega al menos un plato a la comanda', 'error');
      return;
    }

    this.isSubmittingOrder = true;
    const submitBtn = document.querySelector('#mozo-order-overlay button[onclick*="submitOrder"]');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enviando comanda...';
    }

    const tableSelect = document.getElementById('order-table-select');
    const mesaNum = tableSelect ? Number(tableSelect.value) : 1;
    const clientName = document.getElementById('order-client-name')?.value.trim() || 'Comensal';
    const orderComment = this.orderCommentEnabled
      ? (document.getElementById('mozo-order-comment')?.value.trim() || '')
      : '';
    const currentUser = window.AuthService?.getCurrentUser?.();
    const waiterName = currentUser?.name || 'Carlos Paredes';

    try {
      const order = await window.db.createOrder({
        table_num: mesaNum,
        client_name: clientName,
        comentarios: orderComment,
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
      const toggleEl = document.getElementById('mozo-comment-toggle');
      if (toggleEl) toggleEl.checked = false;
      this.toggleOrderComment(false);

      this.showToast(`🔥 ¡Comanda #${order.numero_comanda} enviada a COCINA para Mesa ${String(mesaNum).padStart(2, '0')}!`);
      this.closeOrderDrawer();
      await this.loadTables(false);
    } catch (e) {
      console.error(e);
      this.showToast(`⚠️ ${e.message || 'Error al registrar pedido'}`, 'error');
    } finally {
      this.isSubmittingOrder = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
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
    toast.innerHTML = `<i class="bi ${icon}"></i> <span>${this.escapeHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => mozoApp.init());
