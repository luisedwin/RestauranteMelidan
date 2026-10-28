/**
 * carta.js - Controlador Interactivo del Apartado Carta Digital (Melidan)
 * Accesible para Cliente, Mozo y Administrador según restricciones RBAC.
 */

const cartaApp = {
  categories: [],
  products: [],
  tables: [],
  activeCategory: 'Todos',
  searchQuery: '',
  selectedMesa: 4,
  cart: [],

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  async init() {
    const params = new URLSearchParams(window.location.search);
    const mesaParam = Number(params.get('mesa'));
    if (Number.isInteger(mesaParam) && mesaParam >= 1 && mesaParam <= 15) {
      this.selectedMesa = mesaParam;
    }

    this.restoreCartDraft();
    this.updateMesaPill();
    this.setupListeners();
    this.prefillClientName();

    await Promise.all([
      this.loadMenuData(),
      this.loadTables()
    ]);

    this.renderCategories();
    this.renderDishes();
    this.updateBottomBar();
  },

  prefillClientName() {
    const user = window.AuthService?.getCurrentUser?.();
    const clientInput = document.getElementById('cart-modal-client');
    if (clientInput && user && window.RBAC?.normalizeRole(user.role) === 'CLIENT') {
      clientInput.value = user.name || '';
    }
  },

  restoreCartDraft() {
    try {
      const saved = sessionStorage.getItem('melidan_carta_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) this.cart = parsed;
      }
      const savedMesa = Number(sessionStorage.getItem('melidan_carta_mesa'));
      if (!new URLSearchParams(window.location.search).has('mesa') && savedMesa >= 1 && savedMesa <= 15) {
        this.selectedMesa = savedMesa;
      }
    } catch (_) {}
  },

  persistCartDraft() {
    try {
      sessionStorage.setItem('melidan_carta_cart', JSON.stringify(this.cart));
      sessionStorage.setItem('melidan_carta_mesa', String(this.selectedMesa));
    } catch (_) {}
  },

  async loadMenuData() {
    try {
      const data = await window.db.getCategoriesAndProducts();
      this.categories = data.categorias || [];
      this.products = data.productos || [];
    } catch (e) {
      console.error('[CartaApp] Error cargando carta:', e);
      this.showToast('No se pudo cargar la carta desde PostgreSQL', 'error');
    }
  },

  async loadTables() {
    try {
      const res = await window.db.getMesas();
      this.tables = res?.data || [];
      this.populateMesaSelect();
    } catch (_) {
      this.tables = Array.from({ length: 15 }, (_, idx) => ({ numero_mesa: idx + 1, estado: 'libre' }));
      this.populateMesaSelect();
    }
  },

  populateMesaSelect() {
    const select = document.getElementById('cart-modal-mesa');
    if (!select) return;
    const list = this.tables.length
      ? this.tables
      : Array.from({ length: 15 }, (_, idx) => ({ numero_mesa: idx + 1, estado: 'libre' }));

    select.innerHTML = list.map((t) => {
      const n = Number(t.numero_mesa);
      const label = `Mesa #${String(n).padStart(2, '0')}`;
      return `<option value="${n}" ${n === this.selectedMesa ? 'selected' : ''}>${label}</option>`;
    }).join('');
  },

  updateMesaPill() {
    const label = document.getElementById('carta-mesa-label');
    if (label) {
      label.textContent = `Mesa #${String(this.selectedMesa).padStart(2, '0')}`;
    }
    const select = document.getElementById('cart-modal-mesa');
    if (select) {
      select.value = String(this.selectedMesa);
    }
  },

  openMesaSelector() {
    const grid = document.getElementById('carta-mesa-grid');
    if (!grid) return;
    const list = this.tables.length
      ? this.tables
      : Array.from({ length: 15 }, (_, idx) => ({ numero_mesa: idx + 1, estado: 'libre' }));

    grid.innerHTML = list.map((t) => {
      const n = Number(t.numero_mesa);
      const selected = n === this.selectedMesa ? 'selected' : '';
      const est = String(t.estado || 'libre').replace('_', ' ');
      return `
        <button type="button" class="carta-mesa-option ${selected}" onclick="cartaApp.selectMesa(${n})">
          <div class="fw-bold small">Mesa #${String(n).padStart(2, '0')}</div>
          <small class="text-muted" style="font-size: 0.7rem;">${this.escapeHtml(est)}</small>
        </button>
      `;
    }).join('');

    const modalEl = document.getElementById('cartaMesaModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  selectMesa(num) {
    this.selectedMesa = Number(num) || 4;
    this.updateMesaPill();
    this.persistCartDraft();

    const modalEl = document.getElementById('cartaMesaModal');
    if (modalEl && window.bootstrap) {
      const inst = bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
    }
    this.showToast(`Mesa #${String(this.selectedMesa).padStart(2, '0')} seleccionada`);
  },

  renderCategories() {
    const bar = document.getElementById('carta-categories-bar');
    if (!bar) return;

    const preferredOrder = ['Todos', 'Entradas', 'Platos de Fondo', 'Bebidas', 'Especialidades al Horno', 'Postres'];
    const dbNames = this.categories.map((c) => c.nombre);
    const allCats = ['Todos', ...preferredOrder.slice(1).filter((n) => dbNames.includes(n))];
    for (const name of dbNames) {
      if (!allCats.includes(name)) allCats.push(name);
    }

    bar.innerHTML = allCats.map((cat) => `
      <button
        type="button"
        class="carta-cat-pill ${this.activeCategory === cat ? 'active' : ''}"
        onclick="cartaApp.setCategory('${this.escapeHtml(cat)}')"
      >${this.escapeHtml(cat)}</button>
    `).join('');
  },

  setCategory(cat) {
    this.activeCategory = cat;
    this.renderCategories();
    this.renderDishes();
  },

  getFilteredProducts() {
    const q = this.searchQuery.toLowerCase().trim();
    let list = this.products.filter((p) => {
      if (this.activeCategory !== 'Todos' && p.category !== this.activeCategory) {
        return false;
      }
      if (q) {
        const hay = `${p.name} ${p.description} ${p.category}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });

    // Ordenar colocando los populares (Lomo Saltado Clásico, Ají de Gallina, Limonada Frozen, etc.) al inicio en "Todos"
    if (this.activeCategory === 'Todos' && !q) {
      const heroIds = [6, 4, 7];
      list = [...list].sort((a, b) => {
        const ia = heroIds.indexOf(Number(a.id));
        const ib = heroIds.indexOf(Number(b.id));
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        if (Boolean(a.destacado_menu) !== Boolean(b.destacado_menu)) {
          return a.destacado_menu ? -1 : 1;
        }
        return Number(a.id) - Number(b.id);
      });
    }
    return list;
  },

  renderDishes() {
    const grid = document.getElementById('carta-dishes-grid');
    const titleEl = document.getElementById('carta-section-title');
    const countEl = document.getElementById('carta-results-count');
    if (!grid) return;

    const filtered = this.getFilteredProducts();

    if (titleEl) {
      if (this.searchQuery.trim()) {
        titleEl.textContent = 'Resultados de búsqueda';
      } else if (this.activeCategory === 'Todos') {
        titleEl.textContent = 'Populares hoy';
      } else {
        titleEl.textContent = this.activeCategory;
      }
    }
    if (countEl) {
      countEl.textContent = `${filtered.length} plato${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="text-center py-5 text-muted" style="grid-column: 1 / -1;">
          <i class="bi bi-search fs-2 d-block mb-2"></i>
          <div class="fw-bold">No encontramos platos con ese criterio</div>
          <small>Intenta con otro término o selecciona "Todos".</small>
        </div>
      `;
      return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80';

    grid.innerHTML = filtered.map((dish) => {
      const id = Number(dish.id);
      const inCart = this.cart.find((item) => Number(item.id) === id);
      const qtyBadge = inCart ? `<span class="carta-qty-dot">${inCart.qty}</span>` : '';

      return `
        <article class="carta-dish-card">
          <img
            src="${this.escapeHtml(dish.image || fallbackImg)}"
            alt="${this.escapeHtml(dish.name)}"
            class="carta-dish-thumb"
            loading="lazy"
            onerror="this.src='${fallbackImg}'"
          >
          <div class="carta-dish-content">
            <h3 class="carta-dish-title">${this.escapeHtml(dish.name)}</h3>
            <p class="carta-dish-desc">${this.escapeHtml(dish.description)}</p>
            <div class="carta-dish-footer">
              <span class="carta-dish-price">S/ ${Number(dish.price).toFixed(2)}</span>
              <button
                type="button"
                class="carta-add-btn"
                onclick="cartaApp.addToCart(${id})"
                aria-label="Agregar ${this.escapeHtml(dish.name)}"
                title="Agregar al carrito"
              >
                <i class="bi bi-plus-lg"></i>
                ${qtyBadge}
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  },

  addToCart(productId) {
    const prod = this.products.find((p) => Number(p.id) === Number(productId));
    if (!prod) return;

    const existing = this.cart.find((i) => Number(i.id) === Number(productId));
    if (existing) {
      existing.qty += 1;
    } else {
      this.cart.push({
        id: Number(prod.id),
        name: prod.name,
        price: Number(prod.price),
        qty: 1,
        notes: ''
      });
    }

    this.persistCartDraft();
    this.renderDishes();
    this.updateBottomBar();
    this.showToast(`${prod.name} agregado al carrito`);
  },

  updateBottomBar() {
    const count = this.cart.reduce((acc, i) => acc + i.qty, 0);
    const total = this.cart.reduce((acc, i) => acc + i.price * i.qty, 0);

    const pillEl = document.getElementById('carta-items-pill');
    const totalEl = document.getElementById('carta-cart-total');
    const modalTotalEl = document.getElementById('carta-modal-total');

    if (pillEl) pillEl.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
    if (totalEl) totalEl.textContent = `S/ ${total.toFixed(2)}`;
    if (modalTotalEl) modalTotalEl.textContent = `S/ ${total.toFixed(2)}`;
  },

  openCartModal() {
    this.populateMesaSelect();
    this.renderCartModalItems();
    const modalEl = document.getElementById('cartaCartModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  renderCartModalItems() {
    const container = document.getElementById('carta-cart-modal-items');
    const submitBtn = document.getElementById('btn-carta-submit-order');
    if (!container) return;

    this.updateBottomBar();

    if (this.cart.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-bag-plus fs-1 d-block mb-2"></i>
          <div class="fw-bold">Tu carrito está vacío</div>
          <small>Pulsa el botón naranja <strong>+</strong> en cualquier plato de la carta.</small>
        </div>
      `;
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    if (submitBtn) submitBtn.disabled = false;

    container.innerHTML = this.cart.map((item, idx) => `
      <div class="carta-cart-item-row">
        <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
          <div>
            <div class="fw-bold small">${this.escapeHtml(item.name)}</div>
            <small class="text-muted">S/ ${item.price.toFixed(2)} c/u • Subtotal: <strong>S/ ${(item.price * item.qty).toFixed(2)}</strong></small>
          </div>
          <div class="d-flex align-items-center gap-2">
            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="cartaApp.changeQty(${idx}, -1)">-</button>
            <span class="fw-bold small">${item.qty}</span>
            <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="cartaApp.changeQty(${idx}, 1)">+</button>
          </div>
        </div>
        <input
          type="text"
          class="form-control form-control-melidan form-control-sm"
          placeholder="Nota opcional (ej. sin ají, término medio, poco hielo)..."
          value="${this.escapeHtml(item.notes || '')}"
          oninput="cartaApp.updateItemNote(${idx}, this.value)"
        >
      </div>
    `).join('');
  },

  changeQty(idx, delta) {
    if (!this.cart[idx]) return;
    this.cart[idx].qty += delta;
    if (this.cart[idx].qty <= 0) {
      this.cart.splice(idx, 1);
    }
    this.persistCartDraft();
    this.renderDishes();
    this.renderCartModalItems();
  },

  updateItemNote(idx, value) {
    if (!this.cart[idx]) return;
    this.cart[idx].notes = value;
    this.persistCartDraft();
  },

  clearCart() {
    this.cart = [];
    this.persistCartDraft();
    this.renderDishes();
    this.renderCartModalItems();
  },

  async submitOrder() {
    if (this.cart.length === 0) {
      this.showToast('Agrega al menos un plato antes de confirmar el pedido', 'error');
      return;
    }

    const btn = document.getElementById('btn-carta-submit-order');
    const mesaSel = document.getElementById('cart-modal-mesa');
    const clientInput = document.getElementById('cart-modal-client');

    if (mesaSel && mesaSel.value) {
      this.selectedMesa = Number(mesaSel.value);
      this.updateMesaPill();
    }

    const user = window.AuthService?.getCurrentUser?.();
    const normRole = window.RBAC?.normalizeRole(user?.role);
    const clientName = (clientInput?.value || '').trim() || (normRole === 'CLIENT' ? user?.name : 'Comensal');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enviando...';
    }

    try {
      const payload = {
        table_num: this.selectedMesa,
        client_name: clientName || 'Comensal',
        id_usuario: user?.db_id || null,
        waiter_name: (normRole === 'WAITER' || normRole === 'ADMIN') ? (user?.name || '') : '',
        items: this.cart.map((item) => ({
          id_producto: item.id,
          cantidad: item.qty,
          observaciones: item.notes || ''
        }))
      };

      const order = await window.db.createOrder(payload);
      this.cart = [];
      this.persistCartDraft();
      this.renderDishes();
      this.updateBottomBar();
      await this.loadTables();

      const modalEl = document.getElementById('cartaCartModal');
      if (modalEl && window.bootstrap) {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
      }

      this.showToast(
        `¡Pedido #${order.numero_comanda} registrado para Mesa #${String(this.selectedMesa).padStart(2, '0')}! Enviado a Cocina.`
      );
    } catch (err) {
      console.error('[CartaApp] Error enviando pedido:', err);
      this.showToast(err.message || 'No se pudo enviar el pedido', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-send-fill me-1"></i> Confirmar Pedido';
      }
    }
  },

  setupListeners() {
    const searchInput = document.getElementById('carta-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value || '';
        this.renderDishes();
      });
    }

    const mesaSelect = document.getElementById('cart-modal-mesa');
    if (mesaSelect) {
      mesaSelect.addEventListener('change', (e) => {
        this.selectedMesa = Number(e.target.value) || 4;
        this.updateMesaPill();
        this.persistCartDraft();
      });
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
    const icon = type === 'error'
      ? 'bi-exclamation-triangle-fill text-danger'
      : 'bi-check-circle-fill text-success';
    toast.innerHTML = `<i class="bi ${icon}"></i> <span>${this.escapeHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3400);
  }
};

document.addEventListener('DOMContentLoaded', () => cartaApp.init());

