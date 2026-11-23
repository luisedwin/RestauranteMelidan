/**
 * cajero.js - Lógica del Módulo Cajero y Facturación Electrónica (Melidan)
 * - Métodos de pago: Efectivo, Tarjeta POS, Yape y Plin
 * - Al confirmar pago: muestra botones "Ver Boleta" y "Descargar Boleta (PDF)"
 * - Boleta profesional SUNAT con datos del restaurante, platillos, hora, precios y promoción para siguiente compra
 */

const cajeroApp = {
  activeBills: [],
  recentReceipts: [],
  selectedBill: null,
  lastReceipt: null,
  paymentMethod: 'efectivo',
  documentType: 'boleta',
  isLoadingAll: false,
  isProcessingPayment: false,
  lastRenderedMesa: null,
  lastBillsHtml: '',
  lastReceiptsHtml: '',
  lastCheckoutItemsHtml: '',

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  async init() {
    this.setupListeners();
    await this.loadAll(false);
    setInterval(() => {
      if (!document.hidden && !this.isProcessingPayment) {
        this.loadAll(false);
      }
    }, 15000);
  },

  async loadAll(manual = false) {
    if (this.isLoadingAll && !manual) return;
    this.isLoadingAll = true;
    try {
      await Promise.all([
        this.loadBills(manual),
        this.loadRecentReceipts()
      ]);
      if (manual) this.showToast('🔄 Cuentas y comprobantes actualizados');
    } finally {
      this.isLoadingAll = false;
    }
  },

  async loadBills() {
    try {
      const orders = await window.db.getOrders();
      const prevSelectedMesa = this.selectedBill?.numero_mesa ?? null;

      // Consolidar todos los pedidos pendientes de pago de una MISMA MESA en UNA SOLA cuenta y boleta
      const unpaid = orders.filter((o) => !o.pagado && o.estado !== 'cancelado');
      const byMesa = new Map();

      for (const o of unpaid) {
        const mesaNum = Number(o.numero_mesa || 1);
        if (!byMesa.has(mesaNum)) byMesa.set(mesaNum, []);
        byMesa.get(mesaNum).push(o);
      }

      this.activeBills = [...byMesa.entries()]
        .map(([mesaNum, group]) => {
          // Orden cronológico ascendente para que el primer pedido sea la comanda principal
          const sorted = [...group].sort((a, b) => Number(a.id_pedido) - Number(b.id_pedido));
          const primary = sorted[0];
          const comandas = sorted.map((o) => o.numero_comanda || o.id_pedido);
          const idPedidos = sorted.map((o) => Number(o.id_pedido));

          // Unificar ítems idénticos (mismo producto, mismo precio unitario y misma observación)
          const mergedItemsMap = new Map();
          for (const ord of sorted) {
            for (const i of (ord.items || [])) {
              const name = i.nombre_plato || 'Producto';
              const price = Number(i.precio_unitario || 0);
              const obs = String(i.observaciones || '').trim();
              const qty = Number(i.cantidad || 1);
              const key = `${i.id_producto || name}|${price.toFixed(2)}|${obs.toLowerCase()}`;
              if (mergedItemsMap.has(key)) {
                mergedItemsMap.get(key).qty += qty;
              } else {
                mergedItemsMap.set(key, {
                  id_producto: i.id_producto || null,
                  name,
                  qty,
                  price,
                  observaciones: obs
                });
              }
            }
          }

          const items = [...mergedItemsMap.values()];
          const total = Number(sorted.reduce((sum, o) => sum + Number(o.total || 0), 0).toFixed(2));
          const isCuenta = sorted.some((o) => o.estado_mesa === 'cuenta' || o.estado === 'entregado' || o.estado === 'listo');

          const clientName = sorted
            .map((o) => String(o.nombre_cliente || '').trim())
            .find((n) => n && n.toLowerCase() !== 'comensal')
            || primary.nombre_cliente
            || 'Comensal';

          const waiterName = sorted
            .map((o) => String(o.mozo_nombre || '').trim())
            .find((m) => m && m !== 'Pedido en Carta Digital')
            || primary.mozo_nombre
            || 'Mozo de Turno';

          const comentarios = [...new Set(sorted.map((o) => String(o.comentarios || '').trim()).filter(Boolean))].join(' • ');

          return {
            id: mesaNum,
            id_pedido: Number(primary.id_pedido),
            id_pedidos: idPedidos,
            pedidos_count: sorted.length,
            comandas,
            numero_comanda: comandas.length > 1 ? comandas.join(' + #') : String(comandas[0]),
            numero_mesa: mesaNum,
            cliente: clientName,
            mozo: waiterName,
            comentarios,
            total,
            subtotal: total / 1.18,
            igv: total - total / 1.18,
            estado: isCuenta ? 'cuenta' : primary.estado,
            items
          };
        })
        .sort((a, b) => (b.estado === 'cuenta' ? 1 : 0) - (a.estado === 'cuenta' ? 1 : 0) || a.numero_mesa - b.numero_mesa);

      const badge = document.getElementById('pending-bills-badge');
      if (badge) badge.textContent = `🔴 ${this.activeBills.length} Mesa${this.activeBills.length === 1 ? '' : 's'} Pendiente${this.activeBills.length === 1 ? '' : 's'}`;

      this.selectedBill = this.activeBills.find((b) => b.numero_mesa === prevSelectedMesa)
        || (this.activeBills.length > 0 ? this.activeBills[0] : null);

      this.renderBillsList();
      this.renderCheckout(false);
    } catch (e) {
      console.error('[CajeroApp] Error cargando cuentas:', e);
      if (this.activeBills.length === 0) {
        this.selectedBill = null;
        this.renderBillsList();
        this.renderCheckout(true);
        this.showToast('⚠️ No se pudieron cargar las cuentas desde PostgreSQL', 'error');
      }
    }
  },

  async loadRecentReceipts() {
    try {
      this.recentReceipts = await window.db.getRecentReceipts(8);
      this.renderRecentReceipts();
    } catch (_) {
      if (this.recentReceipts.length === 0) this.renderRecentReceipts();
    }
  },

  renderRecentReceipts() {
    const listEl = document.getElementById('recent-receipts-list');
    if (!listEl) return;

    let html;
    if (this.recentReceipts.length === 0) {
      html = '<div class="text-muted small py-2">Aún no hay comprobantes emitidos.</div>';
    } else {
      html = this.recentReceipts.map((r) => {
        const ch = r.canal_pago || 'Efectivo';
        const chCls = ch === 'Yape'
          ? 'badge-yape'
          : (ch === 'Plin' ? 'badge-plin' : 'bg-secondary-subtle text-secondary');
        return `
          <div class="recent-receipt-row">
            <div>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="badge bg-dark font-monospace">${this.escapeHtml(r.numero_comprobante)}</span>
                <span class="fw-bold small">${this.escapeHtml(r.nombre_cliente || 'Cliente')}</span>
                <span class="badge ${chCls}" style="font-size: 0.68rem;">${this.escapeHtml(ch)}</span>
              </div>
              <small class="text-muted">Mesa #${String(r.numero_mesa || 1).padStart(2, '0')} • ${this.escapeHtml(r.fecha_formato || '')} • <strong class="text-melidan-orange">S/ ${Number(r.monto_total || 0).toFixed(2)}</strong></small>
            </div>
            <div class="d-flex gap-1">
              <button type="button" class="btn btn-sm btn-melidan-outline py-1 px-2" onclick="cajeroApp.viewReceiptById(${Number(r.id_comprobante)})">
                <i class="bi bi-eye"></i> Ver Boleta
              </button>
              <button type="button" class="btn btn-sm btn-melidan-teal py-1 px-2" onclick="cajeroApp.downloadReceiptPdf(${Number(r.id_comprobante)})">
                <i class="bi bi-download"></i> PDF
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
    if (html !== this.lastReceiptsHtml) {
      listEl.innerHTML = html;
      this.lastReceiptsHtml = html;
    }
  },

  renderBillsList() {
    const listEl = document.getElementById('pending-bills-list');
    if (!listEl) return;

    let html;
    if (this.activeBills.length === 0) {
      html = `
        <div class="card border p-4 text-center">
          <i class="bi bi-check2-circle text-success fs-1 mb-2 d-block"></i>
          <h6 class="fw-bold mb-1">Sin cuentas pendientes</h6>
          <small class="text-muted">Todas las comandas activas han sido liquidadas en caja.</small>
        </div>
      `;
    } else {
      html = this.activeBills.map((b) => {
        const isSelected = this.selectedBill && this.selectedBill.id === b.id;
        const isCuenta = b.estado === 'cuenta';
        const unifiedBadge = b.pedidos_count > 1
          ? `<span class="badge bg-info-subtle text-info border border-info-subtle" style="font-size: 0.66rem;">🧾 ${b.pedidos_count} pedidos en 1 boleta</span>`
          : '';

        return `
          <div class="bill-card-item ${isSelected ? 'selected' : ''} ${isCuenta ? 'bill-solicitada' : ''}" onclick="cajeroApp.selectBill(${b.id})">
            <div>
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <h6 class="mb-0 fw-bold">Mesa ${String(b.numero_mesa).padStart(2, '0')}</h6>
                ${isCuenta
                  ? '<span class="badge bg-danger" style="font-size: 0.68rem;">🔴 Lista para Cobro</span>'
                  : '<span class="badge bg-warning text-dark" style="font-size: 0.68rem;">En Consumo</span>'}
                ${unifiedBadge}
              </div>
              <small class="text-muted d-block mt-1">Comanda${b.pedidos_count > 1 ? 's' : ''} #${this.escapeHtml(b.numero_comanda)} • ${this.escapeHtml(b.cliente)} (${this.escapeHtml(b.mozo)})</small>
            </div>
            <div class="text-end">
              <div class="bill-total-amount">S/ ${b.total.toFixed(2)}</div>
              <small class="text-primary fw-bold" style="font-size: 0.72rem;">Seleccionar &rarr;</small>
            </div>
          </div>
        `;
      }).join('');
    }
    if (html !== this.lastBillsHtml) {
      listEl.innerHTML = html;
      this.lastBillsHtml = html;
    }
  },

  selectBill(billId) {
    this.selectedBill = this.activeBills.find((b) => b.id === billId) || null;
    this.renderBillsList();
    this.renderCheckout(true);
  },

  renderCheckout(billChanged = false) {
    const mesaSpan = document.getElementById('checkout-table-title');
    const itemsContainer = document.getElementById('checkout-items-list');
    const subtotalEl = document.getElementById('checkout-subtotal');
    const igvEl = document.getElementById('checkout-igv');
    const totalEl = document.getElementById('checkout-total');
    const btnPay = document.getElementById('btn-process-payment');
    const clientNameInput = document.getElementById('doc-client-name');

    if (!this.selectedBill) {
      this.lastRenderedMesa = null;
      if (mesaSpan) mesaSpan.textContent = 'Selecciona una mesa para liquidar';
      if (itemsContainer) {
        const empty = '<div class="text-muted small py-2 text-center">No hay ítems seleccionados.</div>';
        if (empty !== this.lastCheckoutItemsHtml) {
          itemsContainer.innerHTML = empty;
          this.lastCheckoutItemsHtml = empty;
        }
      }
      if (subtotalEl) subtotalEl.textContent = 'S/ 0.00';
      if (igvEl) igvEl.textContent = 'S/ 0.00';
      if (totalEl) totalEl.textContent = 'S/ 0.00';
      if (btnPay) {
        btnPay.disabled = true;
        btnPay.innerHTML = '<i class="bi bi-check2-circle me-2"></i> Sin cuenta pendiente seleccionada';
      }
      const changeSpan = document.getElementById('cash-change-display');
      if (changeSpan) {
        changeSpan.textContent = 'S/ 0.00';
        changeSpan.className = 'fw-bold text-muted fs-5';
      }
      return;
    }

    const b = this.selectedBill;
    const isDifferentMesa = billChanged || this.lastRenderedMesa !== b.numero_mesa;
    this.lastRenderedMesa = b.numero_mesa;

    if (mesaSpan) {
      mesaSpan.textContent = b.pedidos_count > 1
        ? `Mesa #${String(b.numero_mesa).padStart(2, '0')} — Cuenta Única (${b.pedidos_count} pedidos unificados)`
        : `Mesa #${String(b.numero_mesa).padStart(2, '0')} - Comanda #${b.numero_comanda}`;
    }
    if (subtotalEl) subtotalEl.textContent = `S/ ${b.subtotal.toFixed(2)}`;
    if (igvEl) igvEl.textContent = `S/ ${b.igv.toFixed(2)}`;
    if (totalEl) totalEl.textContent = `S/ ${b.total.toFixed(2)}`;

    // Preservar lo que escribe el cajero durante refrescos automáticos; solo actualizar al cambiar de mesa
    if (clientNameInput && (isDifferentMesa || (!clientNameInput.value.trim() && document.activeElement !== clientNameInput))) {
      clientNameInput.value = b.cliente || 'Cliente General';
    }

    const payLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta POS', yape: 'Yape', plin: 'Plin' };
    if (btnPay && !this.isProcessingPayment) {
      btnPay.disabled = false;
      btnPay.innerHTML = `<i class="bi bi-check2-circle me-2"></i> Pagar con ${payLabels[this.paymentMethod] || 'Caja'} • S/ ${b.total.toFixed(2)}`;
    }

    if (itemsContainer) {
      const itemsHtml = b.items.map((i) => `
        <div class="d-flex justify-content-between mb-1 small">
          <span>${i.qty}x ${this.escapeHtml(i.name)}${i.observaciones ? ` <em class="text-muted">(${this.escapeHtml(i.observaciones)})</em>` : ''}</span>
          <span class="fw-bold">S/ ${(i.price * i.qty).toFixed(2)}</span>
        </div>
      `).join('');
      if (itemsHtml !== this.lastCheckoutItemsHtml) {
        itemsContainer.innerHTML = itemsHtml;
        this.lastCheckoutItemsHtml = itemsHtml;
      }
    }

    const cashInput = document.getElementById('cash-received-input');
    if (cashInput && isDifferentMesa && document.activeElement !== cashInput && (parseFloat(cashInput.value) || 0) < b.total) {
      cashInput.value = Math.ceil(b.total / 10) * 10;
    }
    this.calcChange();
  },

  setPaymentMethod(method) {
    this.paymentMethod = method;
    document.querySelectorAll('.payment-method-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-method') === method);
    });

    const cashBox = document.getElementById('cash-calculator-container');
    const digitalBox = document.getElementById('digital-payment-container');
    const badgeEl = document.getElementById('digital-pay-badge');
    const titleEl = document.getElementById('digital-pay-title');
    const numEl = document.getElementById('digital-pay-number');
    const refInput = document.getElementById('payment-ref-input');

    if (method === 'efectivo') {
      if (cashBox) cashBox.classList.remove('d-none');
      if (digitalBox) digitalBox.classList.add('d-none');
    } else {
      if (cashBox) cashBox.classList.add('d-none');
      if (digitalBox) digitalBox.classList.remove('d-none');
      if (method === 'yape') {
        if (badgeEl) { badgeEl.textContent = 'Yape Oficial'; badgeEl.className = 'badge rounded-pill px-2 py-1 fw-bold badge-yape'; }
        if (titleEl) titleEl.textContent = 'Melidan Restaurante S.A.C. (Yape)';
        if (numEl) numEl.textContent = 'Celular Yape: +51 987 654 321 • Verifica captura antes de confirmar';
        if (refInput) refInput.placeholder = 'Ej. YAPE-482910';
      } else if (method === 'plin') {
        if (badgeEl) { badgeEl.textContent = 'Plin Interbank / BBVA / Scotiabank'; badgeEl.className = 'badge rounded-pill px-2 py-1 fw-bold badge-plin'; }
        if (titleEl) titleEl.textContent = 'Melidan Restaurante S.A.C. (Plin)';
        if (numEl) numEl.textContent = 'Celular Plin: +51 987 654 321 • Verifica constancia antes de confirmar';
        if (refInput) refInput.placeholder = 'Ej. PLIN-719204';
      } else {
        if (badgeEl) { badgeEl.textContent = 'POS Visa / Mastercard'; badgeEl.className = 'badge rounded-pill px-2 py-1 fw-bold bg-primary text-white'; }
        if (titleEl) titleEl.textContent = 'Terminal POS Melidan';
        if (numEl) numEl.textContent = 'Acepta Débito, Crédito y Contactless';
        if (refInput) refInput.placeholder = 'Ej. LOTE-0042 / REF-1928';
      }
    }

    this.renderCheckout();
  },

  setDocType(type) {
    this.documentType = type;
    const clientLabel = document.getElementById('doc-client-label');
    const clientInput = document.getElementById('doc-client-number');

    if (type === 'factura') {
      if (clientLabel) clientLabel.textContent = 'RUC (11 dígitos) *';
      if (clientInput) {
        clientInput.placeholder = '20601234567';
        const cur = clientInput.value.trim();
        if (!cur || cur === '74589632') clientInput.value = '20601234567';
      }
    } else {
      if (clientLabel) clientLabel.textContent = 'DNI / Documento';
      if (clientInput) {
        clientInput.placeholder = '74589632';
        const cur = clientInput.value.trim();
        if (!cur || cur === '20601234567') clientInput.value = '74589632';
      }
    }
  },

  calcChange() {
    if (!this.selectedBill) return;
    const cashInput = document.getElementById('cash-received-input');
    const changeSpan = document.getElementById('cash-change-display');
    if (!cashInput || !changeSpan) return;

    const received = parseFloat(cashInput.value) || 0;
    const total = this.selectedBill.total;
    const change = received - total;

    if (change >= 0) {
      changeSpan.textContent = `S/ ${change.toFixed(2)}`;
      changeSpan.className = 'fw-bold text-success fs-5';
    } else {
      changeSpan.textContent = `Faltan S/ ${Math.abs(change).toFixed(2)}`;
      changeSpan.className = 'fw-bold text-danger fs-6';
    }
  },

  async processPayment() {
    if (!this.selectedBill || this.isProcessingPayment) return;
    const b = this.selectedBill;

    if (this.paymentMethod === 'efectivo') {
      const cashInput = document.getElementById('cash-received-input');
      const received = parseFloat(cashInput?.value) || 0;
      if (received < b.total) {
        this.showToast('⚠️ El monto recibido en efectivo es menor al total a cobrar.', 'error');
        return;
      }
    }

    this.isProcessingPayment = true;
    const btnPay = document.getElementById('btn-process-payment');
    if (btnPay) {
      btnPay.disabled = true;
      btnPay.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Procesando pago...';
    }

    try {
      const paymentConfig = {
        efectivo: { metodo_pago: 'efectivo_caja', canal_pago: 'Efectivo' },
        tarjeta:  { metodo_pago: 'tarjeta_caja',  canal_pago: 'Tarjeta POS' },
        yape:     { metodo_pago: 'aplicacion',    canal_pago: 'Yape' },
        plin:     { metodo_pago: 'aplicacion',    canal_pago: 'Plin' }
      };
      const cfg = paymentConfig[this.paymentMethod] || paymentConfig.efectivo;
      const currentUser = window.AuthService?.getCurrentUser?.();
      const docNumber = document.getElementById('doc-client-number')?.value.trim() || '74589632';
      const clientName = document.getElementById('doc-client-name')?.value.trim() || b.cliente || 'Cliente General';
      const refCode = this.paymentMethod === 'efectivo'
        ? ''
        : (document.getElementById('payment-ref-input')?.value.trim() || '');

      const result = await window.db.createReceipt({
        id_pedido: b.id_pedido,
        id_pedidos: b.id_pedidos || [b.id_pedido],
        numero_mesa: b.numero_mesa,
        metodo_pago: cfg.metodo_pago,
        canal_pago: cfg.canal_pago,
        referencia_pago: refCode,
        tipo_comprobante: this.documentType,
        documento_cliente: docNumber,
        nombre_cliente: clientName,
        cajero_nombre: currentUser?.name || 'María Salazar'
      });

      this.lastReceipt = result.receipt || null;
      const refInput = document.getElementById('payment-ref-input');
      if (refInput) refInput.value = '';

      this.showPostPaymentBanner(this.lastReceipt);
      this.isProcessingPayment = false;
      this.lastRenderedMesa = null;
      await this.loadAll(false);
      const unifiedNote = Number(result.consolidated_orders || 1) > 1
        ? ` (${result.consolidated_orders} pedidos unificados en 1 boleta)`
        : '';
      this.showToast(`✅ Pago con ${cfg.canal_pago} completado (${result.numero_comprobante})${unifiedNote}. ¡Ya puedes ver o descargar la boleta!`);
    } catch (e) {
      console.error(e);
      this.isProcessingPayment = false;
      this.showToast(`⚠️ ${e.message || 'Error al registrar el pago en PostgreSQL'}`, 'error');
      this.renderCheckout(false);
    }
  },

  showPostPaymentBanner(receipt) {
    const banner = document.getElementById('post-payment-banner');
    const titleEl = document.getElementById('post-pay-title');
    const subEl = document.getElementById('post-pay-subtitle');
    if (!banner || !receipt) return;

    banner.classList.remove('d-none');
    if (titleEl) {
      titleEl.textContent = `¡Pago confirmado! ${receipt.numero_comprobante} — S/ ${Number(receipt.monto_total || 0).toFixed(2)} (${receipt.canal_pago})`;
    }
    if (subEl) {
      subEl.textContent = `Mesa #${String(receipt.numero_mesa || 1).padStart(2, '0')} • Cliente: ${receipt.nombre_cliente} • Cupón promo: ${receipt.codigo_promo}`;
    }
  },

  async viewReceiptById(voucherId) {
    const local = this.recentReceipts.find((r) => Number(r.id_comprobante) === Number(voucherId));
    if (local) {
      this.lastReceipt = local;
      this.openReceiptModal();
      return;
    }
    try {
      const full = await window.db.getReceiptByVoucherId(voucherId);
      if (full) {
        this.lastReceipt = full;
        this.openReceiptModal();
      }
    } catch (e) {
      this.showToast('No se pudo cargar la boleta seleccionada', 'error');
    }
  },

  openReceiptModal() {
    if (!this.lastReceipt) {
      this.showToast('Primero registra un pago o selecciona un comprobante emitido.', 'error');
      return;
    }
    this.renderReceiptModal(this.lastReceipt);
    const modalEl = document.getElementById('receiptModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  renderReceiptModal(r) {
    const container = document.getElementById('receipt-paper-content');
    if (!container || !r) return;

    const rest = r.restaurante || {};
    const isFactura = String(r.tipo_comprobante || 'boleta').toLowerCase() === 'factura';
    const docTitle = isFactura ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA';
    const items = Array.isArray(r.items) ? r.items : [];
    const total = Number(r.monto_total || r.desglose?.total || 0);
    const subtotal = Number(r.desglose?.subtotal || (total / 1.18));
    const igv = Number(r.desglose?.igv || (total - subtotal));

    container.innerHTML = `
      <div class="pro-receipt-top-stripe"></div>

      <div class="text-center mb-2">
        <div class="fw-bold fs-5" style="font-family: var(--font-heading); letter-spacing: -0.02em;">
          ${this.escapeHtml((rest.nombre || 'Melidan Restaurante S.A.C.').toUpperCase())}
        </div>
        <div class="text-muted" style="font-size: 0.76rem;">${this.escapeHtml(rest.slogan || 'Tradición y sabor a fuego lento')}</div>
        <div class="fw-bold small mt-1">R.U.C.: ${this.escapeHtml(rest.ruc || '20601234567')}</div>
        <div class="text-muted" style="font-size: 0.75rem;">${this.escapeHtml(rest.direccion || 'Av. La Marina 2450, San Miguel, Lima')}</div>
        <div class="text-muted" style="font-size: 0.75rem;">Tel: ${this.escapeHtml(rest.telefono || '+51 987 654 321')} • www.melidan.pe</div>
      </div>

      <div class="pro-receipt-box-doc">
        <div class="fw-bold" style="font-size: 0.86rem;">${docTitle}</div>
        <div class="fw-bold fs-5 font-monospace text-melidan-orange">${this.escapeHtml(r.numero_comprobante)}</div>
      </div>

      <div class="small mb-2">
        <div class="d-flex justify-content-between"><span class="text-muted">Fecha y Hora:</span><strong>${this.escapeHtml(r.fecha_formato || '')}</strong></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Mesa / Comanda:</span><strong>Mesa #${String(r.numero_mesa || 1).padStart(2, '0')} • #${this.escapeHtml(r.numero_comanda || '')}</strong></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Cliente:</span><strong>${this.escapeHtml(r.nombre_cliente || 'Cliente General')}</strong></div>
        <div class="d-flex justify-content-between"><span class="text-muted">${isFactura ? 'RUC:' : 'DNI / Doc.:'}</span><strong>${this.escapeHtml(r.documento_cliente || '-')}</strong></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Cajero:</span><strong>${this.escapeHtml(r.cajero_nombre || 'Caja Principal')}</strong></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Medio de Pago:</span><strong>${this.escapeHtml(r.canal_pago || 'Efectivo')}${r.referencia_pago ? ` (${this.escapeHtml(r.referencia_pago)})` : ''}</strong></div>
      </div>

      <table class="pro-receipt-table">
        <thead>
          <tr>
            <th style="width: 14%;">Cant</th>
            <th>Descripción</th>
            <th class="text-end" style="width: 22%;">P.Unit</th>
            <th class="text-end" style="width: 24%;">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it) => `
            <tr>
              <td class="fw-bold">${Number(it.cantidad)}x</td>
              <td>
                <div>${this.escapeHtml(it.nombre_plato)}</div>
                ${it.observaciones ? `<div style="font-size: 0.72rem; color: #C2410C;">* ${this.escapeHtml(it.observaciones)}</div>` : ''}
              </td>
              <td class="text-end">S/ ${Number(it.precio_unitario).toFixed(2)}</td>
              <td class="text-end fw-bold">S/ ${Number(it.subtotal).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="pro-receipt-totals">
        <div class="d-flex justify-content-between small">
          <span class="text-muted">OP. GRAVADA (SUBTOTAL):</span>
          <span>S/ ${subtotal.toFixed(2)}</span>
        </div>
        <div class="d-flex justify-content-between small">
          <span class="text-muted">I.G.V. (18%):</span>
          <span>S/ ${igv.toFixed(2)}</span>
        </div>
        <div class="pro-receipt-grand-total">
          <span>IMPORTE TOTAL:</span>
          <span class="text-melidan-orange">S/ ${total.toFixed(2)}</span>
        </div>
        <div class="text-center fw-semibold text-secondary" style="font-size: 0.72rem;">
          ${this.escapeHtml(r.monto_en_letras || '')}
        </div>
      </div>

      <div class="pro-receipt-promo-coupon">
        <div class="fw-bold" style="font-size: 0.85rem;">🎁 PROMOCIÓN PARA TU SIGUIENTE COMPRA</div>
        <div style="font-size: 0.78rem; margin-top: 0.2rem;">${this.escapeHtml(r.descripcion_promo || '')}</div>
        <div class="pro-receipt-promo-code">${this.escapeHtml(r.codigo_promo || '')}</div>
        <div style="font-size: 0.71rem; opacity: 0.9;">
          Presenta esta boleta en caja • ${this.escapeHtml(r.valido_hasta || 'Válido por 30 días')}
        </div>
      </div>

      <div class="text-center text-muted mt-3 pt-2 border-top" style="font-size: 0.7rem;">
        <div>Representación impresa del Comprobante de Pago Electrónico</div>
        <div class="font-monospace">Hash SUNAT: ${this.escapeHtml(r.hash_verificacion || '')}</div>
        <div class="fw-bold text-dark mt-1">¡Gracias por elegir Melidan Restaurante!</div>
      </div>
    `;
  },

  downloadReceiptPdf(voucherId) {
    const id = Number(voucherId || this.lastReceipt?.id_comprobante || 0);
    if (!id) {
      this.showToast('No hay comprobante seleccionado para descargar.', 'error');
      return;
    }
    const url = window.db.getReceiptPdfUrl(id);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    link.remove();
    this.showToast('📄 Descargando boleta electrónica en PDF...');
  },

  setupListeners() {
    document.querySelectorAll('.payment-method-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const method = e.currentTarget.getAttribute('data-method');
        if (method) this.setPaymentMethod(method);
      });
    });

    const cashInput = document.getElementById('cash-received-input');
    if (cashInput) {
      cashInput.addEventListener('input', () => this.calcChange());
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
    }, 3600);
  }
};

document.addEventListener('DOMContentLoaded', () => cajeroApp.init());
