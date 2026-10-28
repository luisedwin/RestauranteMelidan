/**
 * db.js - Cliente HTTP hacia la API REST de Melidan (PostgreSQL 18).
 * PostgreSQL es la fuente de verdad; adjunta token de sesión para endpoints protegidos por rol.
 */
class MelidanDB {
  constructor() {
    this.apiBase = '/api';
    this.isPostgresConnected = false;
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
    const { headers: extraHeaders = {}, ...restOptions } = options;
    const res = await fetch(`${this.apiBase}${path}`, {
      cache: 'no-store',
      ...restOptions,
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...extraHeaders
      }
    });
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

  async getCategoriesAndProducts() {
    const j = await this.request('/products');
    return {
      categorias: j.categorias || [],
      productos: (j.productos || []).map((p) => ({
        ...p,
        category: p.categoria_nombre,
        name: p.name,
        description: p.description || '',
        price: Number(p.price),
        image: p.image
      }))
    };
  }

  async getProducts() {
    const data = await this.getCategoriesAndProducts();
    return data.productos;
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
}

window.MelidanDB = MelidanDB;
window.db = new MelidanDB();
