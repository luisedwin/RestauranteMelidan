/**
 * cocina.js - Lógica del Módulo Cocina / Kitchen Display System KDS (Melidan)
 */

const cocinaApp = {
  currentStatus: 'pendiente', // Por defecto en "Nuevas"
  currentStation: 'todas',
  searchQuery: '',
  currentSort: 'oldest',
  orders: [],
  isLoading: false,
  pendingActions: new Set(),
  lastRenderedHtml: '',

  async init() {
    this.startClock();
    this.setupListeners();
    await this.loadOrders();
    setInterval(() => {
      if (!document.hidden) this.loadOrders(false);
    }, 12000);
  },

  startClock() {
    const clockEl = document.getElementById('kds-live-clock');
    if (!clockEl) return;
    const update = () => {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    update();
    setInterval(update, 1000);
  },

  async loadOrders(manual = false) {
    if (this.isLoading && !manual) return;
    this.isLoading = true;
    try {
      const allOrders = await window.db.getOrders();
      // Mostrar comandas activas de cocina (pendiente, en_cocina, listo)
      this.orders = allOrders.filter((o) => ['pendiente', 'en_cocina', 'listo'].includes(o.estado));
      this.renderTickets();
      if (manual) this.showToast('🔄 Comandas sincronizadas en tiempo real');
    } catch (e) {
      console.error('[CocinaApp] Error cargando pedidos:', e);
      if (manual || this.orders.length === 0) {
        this.renderTickets();
        this.showToast('⚠️ No se pudieron cargar las comandas desde PostgreSQL', 'error');
      }
    } finally {
      this.isLoading = false;
    }
  },

  setStatusFilter(status) {
    if (!['pendiente', 'en_cocina', 'listo'].includes(status)) return;
    this.currentStatus = status;
    document.querySelectorAll('.kds-status-btn').forEach((btn) => {
      const active = btn.getAttribute('data-status') === status;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    this.renderTickets();
  },

  matchesStation(order, stationFilter) {
    if (!stationFilter || stationFilter === 'todas') return true;
    const target = stationFilter.toLowerCase();
    const items = Array.isArray(order.items) ? order.items : [];
    return items.some((item) => {
      const est = String(item.estacion || '').toLowerCase();
      if (target === 'wok') return est.includes('wok');
      if (target === 'horno') return est.includes('horno') || est.includes('fuego');
      if (target === 'entradas') return est.includes('entrada') || est.includes('fría');
      if (target === 'bebidas') return est.includes('bebida') || est.includes('bar');
      if (target === 'postres') return est.includes('postre') || est.includes('reposter');
      return est.includes(target);
    });
  },

  matchesSearch(order, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const mesaTxt = `mesa ${order.numero_mesa || ''} ${String(order.numero_mesa || '').padStart(2, '0')}`;
    const comandaTxt = `#${order.numero_comanda || ''} ${order.id_pedido || ''}`;
    const clientTxt = String(order.nombre_cliente || '');
    const commentTxt = String(order.comentarios || '');
    const itemsTxt = (Array.isArray(order.items) ? order.items : [])
      .map((i) => `${i.nombre_plato || i.name || ''} ${i.observaciones || ''}`)
      .join(' ');
    return `${mesaTxt} ${comandaTxt} ${clientTxt} ${commentTxt} ${itemsTxt}`.toLowerCase().includes(q);
  },

  sortOrders(list) {
    const copy = [...list];
    if (this.currentSort === 'newest') {
      return copy.sort((a, b) => Number(b.id_pedido || 0) - Number(a.id_pedido || 0));
    }
    if (this.currentSort === 'mesa') {
      return copy.sort((a, b) => Number(a.numero_mesa || 0) - Number(b.numero_mesa || 0) || Number(a.id_pedido || 0) - Number(b.id_pedido || 0));
    }
    // Por defecto FIFO: las comandas más antiguas aparecen primero en cocina
    return copy.sort((a, b) => Number(a.id_pedido || 0) - Number(b.id_pedido || 0));
  },

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  renderTickets() {
    const grid = document.getElementById('kds-tickets-grid');
    if (!grid) return;

    // Aplicar filtro derecho (estación + buscador) para actualizar contadores de las 3 pestañas
    const matchingOrders = this.orders.filter(
      (ord) => this.matchesStation(ord, this.currentStation) && this.matchesSearch(ord, this.searchQuery)
    );

    const pendingCount = matchingOrders.filter((o) => o.estado === 'pendiente').length;
    const cookingCount = matchingOrders.filter((o) => o.estado === 'en_cocina').length;
    const readyCount = matchingOrders.filter((o) => o.estado === 'listo').length;

    // Filtrar estrictamente por el estado seleccionado en la izquierda (Nuevas / Cocinando / Listas)
    const visible = this.sortOrders(matchingOrders.filter((o) => o.estado === this.currentStatus));

    const activeCountEl = document.getElementById('kds-active-count');
    const pendingEl = document.getElementById('kds-pending-count');
    const cookingEl = document.getElementById('kds-cooking-count');
    const readyEl = document.getElementById('kds-ready-count');

    if (pendingEl) pendingEl.innerHTML = `<i class="bi bi-bell-fill"></i><span>${pendingCount} Nueva${pendingCount === 1 ? '' : 's'}</span>`;
    if (cookingEl) cookingEl.innerHTML = `<i class="bi bi-fire"></i><span>${cookingCount} Cocinando</span>`;
    if (readyEl) readyEl.innerHTML = `<i class="bi bi-check-circle-fill"></i><span>${readyCount} Lista${readyCount === 1 ? '' : 's'}</span>`;
    if (activeCountEl) activeCountEl.textContent = `${visible.length} en vista • ${matchingOrders.length} total`;

    if (visible.length === 0) {
      const statusMeta = {
        pendiente: { label: 'Nuevas', desc: 'No hay comandas nuevas pendientes con el filtro actual.' },
        en_cocina: { label: 'Cocinando', desc: 'No hay comandas en preparación con el filtro actual.' },
        listo: { label: 'Listas', desc: 'No hay comandas listas para despacho con el filtro actual.' }
      };
      const meta = statusMeta[this.currentStatus] || statusMeta.pendiente;
      const quickButtons = [];
      if (this.currentStatus !== 'pendiente' && pendingCount > 0) {
        quickButtons.push(`<button type="button" class="btn btn-sm btn-outline-danger rounded-pill px-3 fw-bold" onclick="cocinaApp.setStatusFilter('pendiente')">Ver ${pendingCount} Nueva${pendingCount === 1 ? '' : 's'}</button>`);
      }
      if (this.currentStatus !== 'en_cocina' && cookingCount > 0) {
        quickButtons.push(`<button type="button" class="btn btn-sm btn-outline-warning text-dark rounded-pill px-3 fw-bold" onclick="cocinaApp.setStatusFilter('en_cocina')">Ver ${cookingCount} Cocinando</button>`);
      }
      if (this.currentStatus !== 'listo' && readyCount > 0) {
        quickButtons.push(`<button type="button" class="btn btn-sm btn-outline-success rounded-pill px-3 fw-bold" onclick="cocinaApp.setStatusFilter('listo')">Ver ${readyCount} Lista${readyCount === 1 ? '' : 's'}</button>`);
      }

      const emptyHtml = `
        <div class="col-12 text-center py-5" style="grid-column: 1 / -1;">
          <i class="bi bi-check2-circle text-success fs-1 mb-2 d-block"></i>
          <h4 class="fw-bold">¡${meta.label} al día!</h4>
          <p class="text-muted mb-3">${meta.desc}</p>
          ${quickButtons.length ? `<div class="d-flex justify-content-center gap-2 flex-wrap">${quickButtons.join('')}</div>` : ''}
        </div>
      `;
      if (emptyHtml !== this.lastRenderedHtml) {
        grid.innerHTML = emptyHtml;
        this.lastRenderedHtml = emptyHtml;
      }
      return;
    }

    const nextHtml = visible.map((o) => {
      const orderId = o.id_pedido || o.id || o.numero_comanda;
      const elapsed = Number(o.minutos_transcurridos ?? o.tiempo_min ?? 5);
      const isUrgent = elapsed > 15 && o.estado !== 'listo';
      const isReady = o.estado === 'listo';
      const timerClass = isReady ? 'normal' : (isUrgent ? 'danger' : (elapsed > 8 ? 'warning' : 'normal'));
      const hora = this.escapeHtml(o.hora_formato || o.hora || 'Ahora');
      const items = Array.isArray(o.items) ? o.items : [];
      const orderComment = this.escapeHtml(o.comentarios || '');
      const clientName = this.escapeHtml(o.nombre_cliente || 'Comensal');

      return `
        <div class="kds-ticket ${isUrgent ? 'urgente' : ''}">
          <div class="kds-ticket-header">
            <div>
              <div class="kds-mesa-badge">Mesa #${String(o.numero_mesa || 1).padStart(2, '0')}</div>
              <small class="text-muted">Comanda #${this.escapeHtml(o.numero_comanda || orderId)} • ${hora} • ${clientName}</small>
            </div>
            <span class="kds-timer-badge ${timerClass}">
              <i class="bi bi-clock-history"></i> ${elapsed} min
            </span>
          </div>

          <div class="kds-ticket-body">
            ${orderComment ? `
              <div class="kds-order-comment">
                <i class="bi bi-chat-left-quote-fill me-1"></i>
                <strong>Comentario del cliente:</strong> ${orderComment}
              </div>
            ` : ''}
            ${items.map((item) => {
              const qty = Number(item.cantidad ?? item.quantity ?? 1);
              const dishName = this.escapeHtml(item.nombre_plato || item.name || 'Plato');
              const notes = this.escapeHtml(item.observaciones || item.observations || '');
              const stationBadge = this.escapeHtml(item.estacion || item.coccion || '');
              return `
                <div class="kds-item-row">
                  <span class="kds-item-qty">${qty}x</span>
                  <div class="kds-item-name">
                    <div>${dishName}</div>
                    ${notes ? `<div class="kds-item-notes"><i class="bi bi-chat-dots-fill me-1"></i>${notes}</div>` : ''}
                  </div>
                  ${stationBadge ? `<span class="badge bg-light text-secondary border small">${stationBadge}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>

          <div class="kds-ticket-footer">
            ${isReady ? `
              <button class="btn btn-melidan-teal w-100 fw-bold py-2" onclick="cocinaApp.markDelivered(${orderId})">
                <i class="bi bi-check2-all me-1"></i> Despachar / Entregar a Mozo
              </button>
            ` : (o.estado === 'en_cocina' ? `
              <button class="btn btn-success w-100 fw-bold py-2" onclick="cocinaApp.markReady(${orderId})">
                <i class="bi bi-bell-fill me-1"></i> ¡Plato Listo! (Pasar a Listas)
              </button>
            ` : `
              <button class="btn btn-melidan-orange w-100 fw-bold py-2" onclick="cocinaApp.startPrep(${orderId})">
                <i class="bi bi-fire me-1"></i> Iniciar Preparación (Pasar a Cocinando)
              </button>
            `)}
          </div>
        </div>
      `;
    }).join('');

    if (nextHtml !== this.lastRenderedHtml) {
      grid.innerHTML = nextHtml;
      this.lastRenderedHtml = nextHtml;
    }
  },

  async startPrep(id) {
    if (this.pendingActions.has(id)) return;
    this.pendingActions.add(id);
    const ord = this.orders.find((o) => Number(o.id_pedido || o.id || o.numero_comanda) === Number(id));
    try {
      await window.db.updateOrderStatus(id, 'en_cocina');
      await this.loadOrders();
      this.showToast(`🍳 Comanda #${ord?.numero_comanda || id} movida a Cocinando`);
    } catch (_) {
      this.showToast('⚠️ No se pudo actualizar la comanda', 'error');
    } finally {
      this.pendingActions.delete(id);
    }
  },

  async markReady(id) {
    if (this.pendingActions.has(id)) return;
    this.pendingActions.add(id);
    const ord = this.orders.find((o) => Number(o.id_pedido || o.id || o.numero_comanda) === Number(id));
    try {
      await window.db.updateOrderStatus(id, 'listo');
      await this.loadOrders();
      this.showToast(`🔔 ¡Mesa #${ord?.numero_mesa || ''} movida a Listas para el mozo!`);
    } catch (_) {
      this.showToast('⚠️ No se pudo actualizar la comanda', 'error');
    } finally {
      this.pendingActions.delete(id);
    }
  },

  async markDelivered(id) {
    if (this.pendingActions.has(id)) return;
    this.pendingActions.add(id);
    const ord = this.orders.find((o) => Number(o.id_pedido || o.id || o.numero_comanda) === Number(id));
    try {
      await window.db.updateOrderStatus(id, 'entregado');
      await this.loadOrders();
      this.showToast(`✅ Comanda #${ord?.numero_comanda || id} despachada a salón`);
    } catch (_) {
      this.showToast('⚠️ No se pudo despachar la comanda', 'error');
    } finally {
      this.pendingActions.delete(id);
    }
  },

  setupListeners() {
    document.querySelectorAll('.kds-status-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const nextStatus = e.currentTarget.getAttribute('data-status') || 'pendiente';
        this.setStatusFilter(nextStatus);
      });
    });

    const stationSelect = document.getElementById('kds-station-select');
    if (stationSelect) {
      stationSelect.addEventListener('change', (e) => {
        this.currentStation = e.target.value || 'todas';
        this.renderTickets();
      });
    }

    const searchInput = document.getElementById('kds-order-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value || '';
        this.renderTickets();
      });
    }

    const sortSelect = document.getElementById('kds-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.currentSort = e.target.value || 'oldest';
        this.renderTickets();
      });
    }
  },

  showToast(msg, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container-melidan';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-melidan';
    const icon = type === 'error' ? 'bi-exclamation-triangle-fill text-danger' : 'bi-bell-fill text-warning';
    toast.innerHTML = `<i class="bi ${icon}"></i> <span>${this.escapeHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-leaving');
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }
};

document.addEventListener('DOMContentLoaded', () => cocinaApp.init());

