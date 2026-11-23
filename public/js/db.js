/**
 * db.js - Cliente HTTP hacia la API REST de Melidan (PostgreSQL 18).
 * PostgreSQL es la fuente de verdad; adjunta token de sesión para endpoints protegidos por rol.
 */
class MelidanDB {
  constructor() {
    this.apiBase = '/api';
    this.isPostgresConnected = false;
    this._lastBadgeState = null;
    this.initialized = false;
    this.initPromise = this.init();
  }

  getAuthHeaders() {
    try {
      const raw = localStorage.getItem('melidan_auth_user');
      const user = raw ? JSON.parse(raw) : null;
      if (user && user.token) {
        return { Authorization: `Bearer ${user.token}` };
      }
    } catch (_) {}
    return {};
  }

  async request(path, options = {}) {
    const { headers: extraHeaders = {}, timeoutMs = 15000, ...restOptions } = options;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let res;
    try {
      res = await fetch(`${this.apiBase}${path}`, {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
        ...restOptions,
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
          ...extraHeaders
        }
      });
    } catch (fetchErr) {
      if (fetchErr && fetchErr.name === 'AbortError') {
        throw new Error('Tiempo de espera agotado al conectar con el servidor Melidan.');
      }
      throw fetchErr;
    } finally {
      if (timer) clearTimeout(timer);
    }

    let json = {};
    try { json = await res.json(); } catch (_) {}
    if (!res.ok || json.success === false) {
      const err = new Error(json.message || `Error HTTP ${res.status}`);
      err.status = res.status;
      err.errors = json.errors;
      throw err;
    }
    this.isPostgresConnected = true;
    this.updateConnectionBadge(true);
    return json;
  }

  async init() {
    if (this.initialized) return;
    try {
      await this.request('/health');
    } catch (e) {
      this.isPostgresConnected = false;
      this.updateConnectionBadge(false);
      console.warn('[MelidanDB] PostgreSQL/API no disponible:', e.message);
    }
    this.initialized = true;
  }

  updateConnectionBadge(connected) {
    if (this._lastBadgeState === connected) return;
    this._lastBadgeState = connected;
    document.querySelectorAll('.db-status-badge').forEach((badge) => {
      badge.innerHTML = connected
        ? '<span class="badge-dot-green"></span> PostgreSQL 18 Conectado (melidan_db)'
        : '<span class="badge-dot-amber"></span> PostgreSQL no disponible';
      badge.className = `db-status-badge ${connected ? 'db-connected' : 'db-local'}`;
    });
  }

  async getDashboard() { return this.request('/dashboard'); }

  async getStaff(includeDeleted = false, search = '', role = '', status = '') {
    const p = new URLSearchParams();
    if (includeDeleted) p.set('include_deleted', '1');
    if (search) p.set('search', search);
    if (role && role !== 'Todos' && role !== 'todos') p.set('role', role);
    if (status && status !== 'Todos' && status !== 'todos') p.set('status', status);
    return (await this.request(`/staff?${p}`)).staff || [];
  }

  async insertStaff(data) { return this.createStaff(data); }
  async createStaff(data) {
    const j = await this.request('/staff', { method: 'POST', body: JSON.stringify(data) });
    return j.member || j.user;
  }
  async updateStaff(id, data) {
    const j = await this.request(`/staff/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
    return j.member || j.user;
  }
  async softDeleteStaff(id) { return this.request(`/staff/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async restoreStaff(id) { return this.request(`/staff/${encodeURIComponent(id)}/restore`, { method: 'POST', body: '{}' }); }

  async registerUser(data) {
    const j = await this.request('/auth?action=register', { method: 'POST', body: JSON.stringify(data) });
    if (j.user && window.AuthService?.saveSession) {
      window.AuthService.saveSession(j.user);
    }
    return j.user;
  }

  async getOrders() { return (await this.request('/orders')).orders || []; }
  async createOrder(data) { return (await this.request('/orders', { method: 'POST', body: JSON.stringify(data) })).order; }
  async updateOrderStatus(id, status) {
    return (await this.request(`/orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: status })
    })).order;
  }

  async getCategoriesAndProducts(dayCode = '') {
    const q = dayCode ? `?day=${encodeURIComponent(dayCode)}` : '';
    const j = await this.request(`/products${q}`);
    return {
      date: j.date || null,
      day_code: j.day_code || null,
      day_label: j.day_label || null,
      schedule_label: j.schedule_label || null,
      categorias: j.categorias || [],
      promociones: j.promociones || [],
      upsell_suggestions: j.upsell_suggestions || [],
      complement_pool: j.complement_pool || [],
      complement_discount_percent: Number(j.complement_discount_percent || 20),
      popular_meta: j.popular_meta || null,
      special_of_day: j.special_of_day || null,
      productos: (j.productos || []).map((p) => ({
        ...p,
        category: p.categoria_nombre,
        name: p.name,
        description: p.description || '',
        price: Number(p.price),
        original_price: Number(p.original_price ?? p.price),
        precio_regular: p.precio_regular ? Number(p.precio_regular) : null,
        has_promo_price: Boolean(p.has_promo_price),
        discount_percent: Number(p.discount_percent || 0),
        savings_amount: Number(p.savings_amount || 0),
        etiqueta_marketing: p.etiqueta_marketing || '',
        dias_disponibles: p.dias_disponibles || 'TODOS',
        available_today: p.available_today !== false,
        is_day_exclusive: Boolean(p.is_day_exclusive),
        unidades_vendidas_7d: Number(p.unidades_vendidas_7d || 0),
        pedidos_7d: Number(p.pedidos_7d || 0),
        is_popular_week: Boolean(p.is_popular_week),
        popular_rank: p.popular_rank ? Number(p.popular_rank) : null,
        image: p.image
      }))
    };
  }

  async getProducts() {
    const data = await this.getCategoriesAndProducts();
    return data.productos;
  }

  async getDailySpecials(dateStr = '', dayCode = '') {
    const params = new URLSearchParams();
    if (dateStr) params.set('date', dateStr);
    if (dayCode) params.set('day', dayCode);
    const qs = params.toString();
    return this.request(`/daily-specials${qs ? `?${qs}` : ''}`);
  }

  async getMesas() { return this.request('/mesas'); }

  async updateMesa(numeroMesa, estado, tiempoMin = 0, mozoAsignado = undefined, montoAcumulado = undefined) {
    const payload = { numero_mesa: numeroMesa, estado, tiempo_min: tiempoMin };
    if (mozoAsignado !== undefined) payload.mozo_asignado = mozoAsignado;
    if (montoAcumulado !== undefined) payload.monto_acumulado = montoAcumulado;
    return this.request('/mesas', { method: 'PUT', body: JSON.stringify(payload) });
  }

  async getReceipt(orderId = 0) {
    const q = orderId ? `?id_pedido=${encodeURIComponent(orderId)}` : '';
    const j = await this.request(`/billing${q}`);
    return j.receipt || null;
  }

  async getReceiptByVoucherId(voucherId) {
    const j = await this.request(`/billing?id_comprobante=${encodeURIComponent(voucherId)}`);
    return j.receipt || null;
  }

  async getRecentReceipts(limit = 12) {
    const j = await this.request(`/billing/recent?limit=${encodeURIComponent(limit)}`);
    return j.receipts || [];
  }

  getReceiptPdfUrl(voucherId) {
    return `${this.apiBase}/billing/${encodeURIComponent(voucherId)}/pdf`;
  }

  async createReceipt(data) {
    return this.request('/billing', { method: 'POST', body: JSON.stringify(data) });
  }

  async getPurchasesHistory(filters = {}) {
    const p = new URLSearchParams();
    if (filters.search) p.set('search', filters.search);
    if (filters.metodo_pago && filters.metodo_pago !== 'todos') p.set('metodo_pago', filters.metodo_pago);
    if (filters.tipo_comprobante && filters.tipo_comprobante !== 'todos') p.set('tipo_comprobante', filters.tipo_comprobante);
    const qs = p.toString();
    return this.request(`/purchases-history${qs ? `?${qs}` : ''}`);
  }

  async registerHistoricalPurchase(data) {
    return this.request('/purchases-history', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async downloadSalesExcel() {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 30000) : null;
    let res;
    try {
      res = await fetch(`${this.apiBase}/reports/sales-excel`, {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
        headers: {
          ...this.getAuthHeaders()
        }
      });
    } catch (fetchErr) {
      if (fetchErr && fetchErr.name === 'AbortError') {
        throw new Error('Tiempo de espera agotado al generar el Excel de ventas.');
      }
      throw fetchErr;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      let msg = `Error HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.message) msg = j.message;
      } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const disp = res.headers.get('Content-Disposition') || '';
    const match = disp.match(/filename="?([^"]+)"?/i);
    const filename = match ? match[1] : `Reporte_Ventas_Melidan_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { blob, filename };
  }
}

window.MelidanDB = MelidanDB;
window.db = new MelidanDB();
