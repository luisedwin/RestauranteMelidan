/**
 * carta.js - Controlador Interactivo del Apartado Carta Digital (Melidan)
 * Incluye:
 * - Carrusel de imágenes de platos (exactamente 4 platos destacados con rotación diaria)
 * - Apartado llamativo del Platillo Especial del Día (-25%) con precios decimales psicológicos (.90)
 * - Franja compacta de Promociones y Programación por Días (Lun·Mié·Vie / Mar·Jue·Sáb / Domingo)
 * - Populares calculados dinámicamente con ventas reales de los últimos 7 días en PostgreSQL
 * - Categorías: Menú del Día, Combos, Platos Criollos, Platos Especiales, Entradas, Bebidas y Jarras, Postres
 * - Upselling inteligente dentro del carrito + comentarios opcionales para cocina
 */

const cartaApp = {
  categories: [],
  products: [],
  promos: [],
  upsellSuggestions: [],
  complementPool: [],
  complementDiscountPercent: 20,
  randomComplements: [],
  tables: [],
  carouselItems: [],
  specialOfDay: null,
  dailyMeta: null,
  popularMeta: null,
  scheduleDay: '', // '' = Hoy (fecha real de Perú), 'LUN' = Lun·Mié·Vie, 'MAR' = Mar·Jue·Sáb, 'DOM' = Domingo
  currentDayCode: '',
  carouselIndex: 0,
  carouselTimer: null,
  carouselPaused: false,
  touchStartX: null,
  heroMouseStartX: null,
  heroSuppressClickUntil: 0,
  promoDrag: { active: false, startX: 0, startScrollLeft: 0, moved: false },
  promoSuppressClickUntil: 0,
  promoScrollRaf: null,
  activeCategory: 'Todos',
  searchQuery: '',
  selectedMesa: 4,
  cart: [],
  orderCommentEnabled: false,
  isSubmittingOrder: false,

  escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  escapeJsSingle(value) {
    return this.escapeHtml(
      String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    );
  },

  highResImage(url) {
    const fallback = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80';
    if (!url) return fallback;
    return String(url).replace(/([?&])w=\d+/i, '$1w=900');
  },

  formatPriceHtml(amount) {
    const fixed = Number(amount || 0).toFixed(2);
    const [whole, dec] = fixed.split('.');
    return `S/ ${whole}<span class="carta-price-dec">.${dec}</span>`;
  },

  formatDaysLabel(diasStr) {
    const raw = String(diasStr || 'TODOS').toUpperCase();
    if (raw === 'LUN,MIE,VIE') return 'Lun · Mié · Vie';
    if (raw === 'MAR,JUE,SAB') return 'Mar · Jue · Sáb';
    if (raw === 'DOM') return 'Solo Domingos';
    if (raw === 'VIE,SAB,DOM') return 'Vie · Sáb · Dom';
    return 'Todos los días';
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
      this.loadDailyShowcase(),
      this.loadTables()
    ]);

    this.syncCartPrices();
    this.renderShowcase();
    this.renderPromos();
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

  hasRegularCartItem() {
    return this.cart.some((i) => !i.is_complement);
  },

  reconcileComplementEligibility() {
    if (!this.cart.length) return false;
    const eligible = this.hasRegularCartItem();
    let changed = false;
    for (const item of this.cart) {
      if (item.is_complement && !eligible) {
        const regular = this.findProductById(item.id);
        item.is_complement = false;
        if (regular) {
          item.price = Number(regular.price);
          item.original_price = Number(regular.original_price ?? regular.price);
          item.discount_percent = Number(regular.discount_percent || 0);
        }
        changed = true;
      }
    }
    return changed;
  },

  syncCartPrices() {
    if (!this.cart.length) return;
    let changed = this.reconcileComplementEligibility();
    for (const item of this.cart) {
      if (item.is_complement) {
        const comp = this.complementPool.find((c) => Number(c.id) === Number(item.id));
        if (comp) {
          const compPrice = Number(comp.complement_price ?? comp.price);
          const origPrice = Number(comp.original_price ?? compPrice);
          const disc = Number(comp.discount_percent || this.complementDiscountPercent || 20);
          if (item.price !== compPrice || item.original_price !== origPrice || item.discount_percent !== disc) {
            item.price = compPrice;
            item.original_price = origPrice;
            item.discount_percent = disc;
            changed = true;
          }
          continue;
        }
      }
      const match = this.findProductById(item.id);
      if (match) {
        const effectivePrice = Number(match.price);
        const origPrice = Number(match.original_price ?? match.price);
        const disc = Number(match.discount_percent || 0);
        if (item.price !== effectivePrice || item.original_price !== origPrice || item.discount_percent !== disc) {
          item.price = effectivePrice;
          item.original_price = origPrice;
          item.discount_percent = disc;
          item.is_special_of_day = Boolean(match.is_special_of_day);
          item.category = match.category || item.category || '';
          changed = true;
        }
      }
    }
    if (changed) this.persistCartDraft();
  },

  findProductById(productId) {
    const id = Number(productId);
    if (this.specialOfDay && Number(this.specialOfDay.id) === id) {
      return this.specialOfDay;
    }
    return this.products.find((p) => Number(p.id) === id)
      || this.carouselItems.find((p) => Number(p.id) === id)
      || null;
  },

  async loadMenuData() {
    try {
      const data = await window.db.getCategoriesAndProducts(this.scheduleDay);
      this.categories = data.categorias || [];
      this.products = data.productos || [];
      this.promos = data.promociones || [];
      this.upsellSuggestions = data.upsell_suggestions || [];
      this.complementPool = Array.isArray(data.complement_pool) && data.complement_pool.length
        ? data.complement_pool
        : this.upsellSuggestions;
      this.complementDiscountPercent = Number(data.complement_discount_percent || 20);
      this.popularMeta = data.popular_meta || null;
      this.currentDayCode = data.day_code || '';
    } catch (e) {
      console.error('[CartaApp] Error cargando carta:', e);
      this.showToast('No se pudo cargar la carta desde PostgreSQL', 'error');
    }
  },

  async loadDailyShowcase() {
    try {
      const data = await window.db.getDailySpecials('', this.scheduleDay);
      this.dailyMeta = data;
      this.carouselItems = Array.isArray(data.carousel) ? data.carousel.slice(0, 4) : [];
      this.specialOfDay = data.special_of_day || null;
      this.carouselIndex = 0;
    } catch (e) {
      console.error('[CartaApp] Error cargando carrusel y especial del día:', e);
      this.carouselItems = [];
      this.specialOfDay = null;
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

  async setScheduleDay(dayCode) {
    this.scheduleDay = String(dayCode || '');
    document.querySelectorAll('#carta-day-tabs .carta-day-tab').forEach((btn) => {
      btn.classList.toggle('active', (btn.getAttribute('data-day') || '') === this.scheduleDay);
    });

    await Promise.all([
      this.loadMenuData(),
      this.loadDailyShowcase()
    ]);

    this.syncCartPrices();
    this.renderShowcase();
    this.renderPromos();
    this.renderDishes();

    const labels = {
      '': 'Carta de Hoy',
      LUN: 'Programación Lunes · Miércoles · Viernes',
      MAR: 'Programación Martes · Jueves · Sábado',
      DOM: 'Especial Familiar de Domingo'
    };
    this.showToast(`📅 Mostrando: ${labels[this.scheduleDay] || 'Selección del día'}`);
  },

  // =========================================================================
  // CARRUSEL INTERACTIVO DE PROMOCIONES (FLECHAS, CURSOR DRAG, TECLADO Y TÁCTIL)
  // =========================================================================
  renderPromos() {
    const strip = document.getElementById('carta-promos-strip');
    const dots = document.getElementById('carta-promos-dots');
    if (!strip) return;

    if (!this.promos.length) {
      strip.innerHTML = '';
      if (dots) dots.innerHTML = '';
      return;
    }

    strip.innerHTML = this.promos.map((pr, idx) => {
      const accent = this.escapeHtml(pr.color_acento || '#FF5722');
      const catJs = this.escapeJsSingle(pr.categoria_destino || 'Todos');
      const prodId = Number(pr.id_producto_destacado || 0);
      const isToday = pr.active_today !== false;
      return `
        <button
          type="button"
          class="carta-promo-chip ${isToday ? '' : 'promo-inactive'}"
          data-promo-index="${idx}"
          style="--promo-accent: ${accent};"
          onclick="cartaApp.handlePromoClick('${catJs}', ${prodId})"
        >
          <div class="carta-promo-chip-top">
            <span class="carta-promo-chip-badge">${this.escapeHtml(pr.badge_texto)}</span>
            <small class="fw-bold" style="font-size: 0.65rem; color: ${isToday ? '#009B77' : '#94A3B8'};">
              ${isToday ? '● Activa' : 'Programada'}
            </small>
          </div>
          <div class="carta-promo-chip-title">${this.escapeHtml(pr.titulo)}</div>
          <div class="carta-promo-chip-sub">${this.escapeHtml(pr.subtitulo)}</div>
        </button>
      `;
    }).join('');

    if (dots) {
      dots.innerHTML = this.promos.map((pr, idx) => `
        <button
          type="button"
          class="carta-promos-dot ${idx === 0 ? 'active' : ''}"
          onclick="cartaApp.scrollPromoToIndex(${idx})"
          aria-label="Ir a promoción ${idx + 1}: ${this.escapeHtml(pr.titulo)}"
        ></button>
      `).join('');
    }

    strip.scrollLeft = 0;
    requestAnimationFrame(() => this.updatePromosCarouselUI());
  },

  slidePromos(direction) {
    const strip = document.getElementById('carta-promos-strip');
    if (!strip) return;
    const firstCard = strip.querySelector('.carta-promo-chip');
    const step = firstCard ? (firstCard.offsetWidth + 12) : 268;
    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);

    if (maxScroll <= 4) return;

    if (direction > 0 && strip.scrollLeft >= maxScroll - 8) {
      strip.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (direction < 0 && strip.scrollLeft <= 8) {
      strip.scrollTo({ left: maxScroll, behavior: 'smooth' });
    } else {
      strip.scrollBy({ left: direction * step, behavior: 'smooth' });
    }
  },

  scrollPromoToIndex(idx) {
    const strip = document.getElementById('carta-promos-strip');
    if (!strip) return;
    const cards = strip.querySelectorAll('.carta-promo-chip');
    const target = cards[idx];
    if (!target) return;
    const leftPad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
    strip.scrollTo({ left: Math.max(0, target.offsetLeft - leftPad), behavior: 'smooth' });
  },

  updatePromosCarouselUI() {
    const strip = document.getElementById('carta-promos-strip');
    const prevBtn = document.getElementById('btn-promos-prev');
    const nextBtn = document.getElementById('btn-promos-next');
    const dots = document.querySelectorAll('#carta-promos-dots .carta-promos-dot');
    if (!strip) return;

    const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const hasOverflow = maxScroll > 6;

    if (prevBtn) {
      prevBtn.classList.toggle('d-none', !hasOverflow);
      prevBtn.classList.toggle('is-edge', strip.scrollLeft <= 6);
    }
    if (nextBtn) {
      nextBtn.classList.toggle('d-none', !hasOverflow);
      nextBtn.classList.toggle('is-edge', strip.scrollLeft >= maxScroll - 6);
    }

    if (dots.length) {
      let activeIdx = 0;
      if (maxScroll > 0) {
        const ratio = Math.min(1, Math.max(0, strip.scrollLeft / maxScroll));
        activeIdx = Math.round(ratio * (dots.length - 1));
      }
      dots.forEach((dot, idx) => dot.classList.toggle('active', idx === activeIdx));
    }
  },

  handlePromoClick(category, _productId) {
    if (Date.now() < this.promoSuppressClickUntil) return;
    if (category && category !== 'Todos') {
      this.setCategory(category);
      const header = document.querySelector('.carta-section-header');
      if (header) header.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  // =========================================================================
  // CARRUSEL DE PLATOS (4 IMÁGENES) + APARTADO PLATILLO ESPECIAL DEL DÍA
  // =========================================================================
  renderShowcase() {
    const dateEl = document.getElementById('carta-showcase-date');
    if (dateEl && this.dailyMeta) {
      const text = this.scheduleDay
        ? (this.dailyMeta.schedule_label || this.dailyMeta.day_label)
        : (this.dailyMeta.day_label || this.dailyMeta.date || 'Selección de hoy');
      dateEl.textContent = text;
    }
    this.renderCarousel();
    this.renderSpecialOfDay();
    this.startCarouselAutoplay();
  },

  renderCarousel() {
    const track = document.getElementById('carta-carousel-track');
    const thumbs = document.getElementById('carta-carousel-thumbs');
    const counter = document.getElementById('carta-carousel-counter');
    if (!track) return;

    const slides = this.carouselItems.slice(0, 4);
    if (!slides.length) {
      track.innerHTML = `
        <div class="carta-carousel-placeholder">
          <i class="bi bi-image fs-2 text-muted mb-2"></i>
          <div class="small text-muted">No hay imágenes disponibles en el carrusel.</div>
        </div>
      `;
      if (thumbs) thumbs.innerHTML = '';
      if (counter) counter.textContent = '0 / 0';
      return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=900&q=80';

    track.innerHTML = slides.map((dish, idx) => `
      <div class="carta-carousel-slide ${idx === this.carouselIndex ? 'active' : ''}" data-slide-index="${idx}">
        <img
          src="${this.escapeHtml(this.highResImage(dish.image))}"
          alt="${this.escapeHtml(dish.name)}"
          class="carta-carousel-img"
          draggable="false"
          onerror="this.onerror=null;this.src='${fallbackImg}'"
        >
        <div class="carta-carousel-scrim" aria-hidden="true"></div>
        <span class="carta-carousel-cat-tag">${this.escapeHtml(dish.badge_label || dish.category || 'Plato de la Casa')}</span>
        <div class="carta-carousel-caption">
          <div class="min-w-0">
            <h3 class="carta-carousel-title">${this.escapeHtml(dish.name)}</h3>
            <p class="carta-carousel-desc">${this.escapeHtml(dish.description || '')}</p>
          </div>
          <div class="carta-carousel-cta">
            <span class="carta-carousel-price">${this.formatPriceHtml(dish.price)}</span>
            <button
              type="button"
              class="carta-carousel-add-btn"
              onclick="cartaApp.addToCart(${Number(dish.id)})"
            >
              <i class="bi bi-plus-lg"></i> Pedir
            </button>
          </div>
        </div>
      </div>
    `).join('');

    if (thumbs) {
      thumbs.innerHTML = slides.map((dish, idx) => `
        <button
          type="button"
          class="carta-carousel-thumb ${idx === this.carouselIndex ? 'active' : ''}"
          role="tab"
          aria-selected="${idx === this.carouselIndex ? 'true' : 'false'}"
          onclick="cartaApp.goToSlide(${idx})"
          title="Ver ${this.escapeHtml(dish.name)}"
        >
          <img
            src="${this.escapeHtml(dish.image || fallbackImg)}"
            alt="${this.escapeHtml(dish.name)}"
            onerror="this.onerror=null;this.src='${fallbackImg}'"
          >
          <span class="carta-carousel-thumb-name">${this.escapeHtml(dish.name)}</span>
        </button>
      `).join('');
    }

    this.updateCarouselPosition();
  },

  updateCarouselPosition() {
    const track = document.getElementById('carta-carousel-track');
    const counter = document.getElementById('carta-carousel-counter');
    const total = this.carouselItems.length;
    if (!track || !total) return;

    track.style.transform = `translateX(-${this.carouselIndex * 100}%)`;
    track.querySelectorAll('.carta-carousel-slide').forEach((el, idx) => {
      el.classList.toggle('active', idx === this.carouselIndex);
    });

    const thumbs = document.querySelectorAll('#carta-carousel-thumbs .carta-carousel-thumb');
    thumbs.forEach((btn, idx) => {
      const isActive = idx === this.carouselIndex;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    if (counter) {
      counter.textContent = `${this.carouselIndex + 1} / ${total}`;
    }
  },

  goToSlide(idx) {
    const total = this.carouselItems.length;
    if (!total) return;
    this.carouselIndex = ((Number(idx) % total) + total) % total;
    this.updateCarouselPosition();
    this.startCarouselAutoplay();
  },

  nextSlide() {
    this.goToSlide(this.carouselIndex + 1);
  },

  prevSlide() {
    this.goToSlide(this.carouselIndex - 1);
  },

  startCarouselAutoplay() {
    this.stopCarouselAutoplay();
    if (this.carouselItems.length <= 1 || this.carouselPaused) return;
    this.carouselTimer = setInterval(() => {
      if (!document.hidden && !this.carouselPaused && this.carouselItems.length > 1) {
        this.carouselIndex = (this.carouselIndex + 1) % this.carouselItems.length;
        this.updateCarouselPosition();
      }
    }, 4500);
  },

  stopCarouselAutoplay() {
    if (this.carouselTimer) {
      clearInterval(this.carouselTimer);
      this.carouselTimer = null;
    }
  },

  renderSpecialOfDay() {
    const card = document.getElementById('carta-special-card');
    if (!card) return;

    const dish = this.specialOfDay;
    if (!dish) {
      card.innerHTML = `
        <div class="carta-special-loading text-center">
          <i class="bi bi-fire fs-2 text-warning mb-2"></i>
          <div class="small text-muted">No hay platillo especial disponible hoy.</div>
        </div>
      `;
      return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80';
    const origPrice = Number(dish.original_price ?? dish.price);
    const promoPrice = Number(dish.special_price ?? dish.price);
    const savings = Number(dish.savings_amount ?? Math.max(0, origPrice - promoPrice));
    const discPct = Number(dish.discount_percent || 25);
    const inCart = this.cart.find((item) => Number(item.id) === Number(dish.id));
    const cartSuffix = inCart ? ` (${inCart.qty} en carrito)` : '';

    card.innerHTML = `
      <div class="carta-special-header">
        <span class="carta-special-pill"><i class="bi bi-fire"></i> Especial del Día</span>
        <span class="carta-discount-burst">-${discPct}% HOY</span>
      </div>

      <div class="carta-special-media">
        <img
          src="${this.escapeHtml(this.highResImage(dish.image))}"
          alt="${this.escapeHtml(dish.name)}"
          onerror="this.onerror=null;this.src='${fallbackImg}'"
        >
        <span class="carta-special-ribbon">
          <i class="bi bi-stars me-1"></i>Precio Rebajado Solo Hoy
        </span>
      </div>

      <div>
        <small class="fw-bold text-uppercase text-muted" style="font-size: 0.68rem; letter-spacing: 0.04em;">
          ${this.escapeHtml(dish.category || 'Especialidad Melidan')}
        </small>
        <h3 class="carta-special-title">${this.escapeHtml(dish.name)}</h3>
        <p class="carta-special-desc">${this.escapeHtml(dish.description || '')}</p>
      </div>

      <div class="carta-special-price-box">
        <div>
          <div class="carta-special-price-old">Antes S/ ${origPrice.toFixed(2)}</div>
          <div class="carta-special-price-new">${this.formatPriceHtml(promoPrice)}</div>
        </div>
        <span class="carta-special-savings">
          <i class="bi bi-tag-fill"></i> Ahorras S/ ${savings.toFixed(2)}
        </span>
      </div>

      <button
        type="button"
        class="carta-special-cta"
        onclick="cartaApp.addToCart(${Number(dish.id)})"
      >
        <i class="bi bi-bag-plus-fill"></i>
        <span>Pedir Especial del Día${cartSuffix}</span>
      </button>

      <div class="carta-special-rotation-note">
        <i class="bi bi-arrow-repeat"></i>
        <span>Rota cada día: mañana habrá otro platillo especial en oferta</span>
      </div>
    `;
  },

  // =========================================================================
  // SELECTOR DE MESA, CATEGORÍAS Y CARTA COMPLETA
  // =========================================================================
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

    const preferredOrder = [
      'Todos',
      'Menú del Día',
      'Combos',
      'Platos Criollos',
      'Platos Especiales',
      'Entradas',
      'Bebidas y Jarras',
      'Postres'
    ];
    const dbNames = this.categories.map((c) => c.nombre);
    const allCats = ['Todos', ...preferredOrder.slice(1).filter((n) => dbNames.includes(n))];
    for (const name of dbNames) {
      if (!allCats.includes(name)) allCats.push(name);
    }

    bar.innerHTML = allCats.map((cat) => `
      <button
        type="button"
        class="carta-cat-pill ${this.activeCategory === cat ? 'active' : ''}"
        onclick="cartaApp.setCategory('${this.escapeJsSingle(cat)}')"
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
        const hay = `${p.name} ${p.description} ${p.category} ${p.etiqueta_marketing || ''}`.toLowerCase();
        return hay.includes(q);
      }
      // En vista general "Todos" mostramos los disponibles en el día seleccionado para no saturar
      if (this.activeCategory === 'Todos' && !p.available_today) {
        return false;
      }
      return true;
    });

    const specialId = this.specialOfDay ? Number(this.specialOfDay.id) : -1;

    list = [...list].sort((a, b) => {
      // Priorizar disponibles del día cuando se exploran categorías específicas (ej. Menú del Día / Criollos)
      if (Boolean(a.available_today) !== Boolean(b.available_today)) {
        return a.available_today ? -1 : 1;
      }
      const aSpec = Number(a.id) === specialId || Boolean(a.is_special_of_day);
      const bSpec = Number(b.id) === specialId || Boolean(b.is_special_of_day);
      if (aSpec !== bSpec) return aSpec ? -1 : 1;

      if (this.activeCategory === 'Todos' && !q) {
        // Destacar primero el Menú del Día exclusivo de hoy y los Populares de la semana
        const aDayEx = Boolean(a.is_day_exclusive && a.available_today);
        const bDayEx = Boolean(b.is_day_exclusive && b.available_today);
        if (aDayEx !== bDayEx) return aDayEx ? -1 : 1;

        const aPop = Boolean(a.is_popular_week);
        const bPop = Boolean(b.is_popular_week);
        if (aPop !== bPop) return aPop ? -1 : 1;
        if (aPop && bPop) {
          const rankDiff = (a.popular_rank || 99) - (b.popular_rank || 99);
          if (rankDiff !== 0) return rankDiff;
        }
      }

      const salesDiff = Number(b.unidades_vendidas_7d || 0) - Number(a.unidades_vendidas_7d || 0);
      if (salesDiff !== 0) return salesDiff;
      if (Boolean(a.destacado_menu) !== Boolean(b.destacado_menu)) {
        return a.destacado_menu ? -1 : 1;
      }
      return Number(a.id) - Number(b.id);
    });

    return list;
  },

  renderDishes() {
    const grid = document.getElementById('carta-dishes-grid');
    const titleEl = document.getElementById('carta-section-title');
    const countEl = document.getElementById('carta-results-count');
    if (!grid) return;

    const filtered = this.getFilteredProducts();
    const specialId = this.specialOfDay ? Number(this.specialOfDay.id) : -1;

    if (titleEl) {
      if (this.searchQuery.trim()) {
        titleEl.textContent = 'Resultados de búsqueda';
      } else if (this.activeCategory === 'Todos') {
        titleEl.textContent = this.scheduleDay ? `Populares (${this.formatDaysLabel(this.scheduleDay === 'LUN' ? 'LUN,MIE,VIE' : (this.scheduleDay === 'MAR' ? 'MAR,JUE,SAB' : 'DOM'))})` : 'Populares hoy';
      } else {
        titleEl.textContent = this.activeCategory;
      }
    }
    if (countEl) {
      const popNote = this.activeCategory === 'Todos' && !this.searchQuery.trim() && this.popularMeta?.source?.startsWith('ventas_')
        ? `Top ventas últimos ${this.popularMeta.window_days}d • `
        : '';
      countEl.textContent = `${popNote}${filtered.length} opción${filtered.length === 1 ? '' : 'es'}`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="text-center py-5 text-muted" style="grid-column: 1 / -1;">
          <i class="bi bi-search fs-2 d-block mb-2"></i>
          <div class="fw-bold">No encontramos opciones con ese criterio</div>
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
      const isSpecialToday = id === specialId || Boolean(dish.is_special_of_day);
      const isPopularWeek = Boolean(dish.is_popular_week);
      const popularRank = Number(dish.popular_rank || 0);
      const weeklyUnits = Number(dish.unidades_vendidas_7d || 0);
      const isCombo = String(dish.category || '').toLowerCase().includes('combo');
      const isOtherDay = dish.is_day_exclusive && !dish.available_today;

      const effectivePrice = isSpecialToday
        ? Number(this.specialOfDay?.special_price ?? dish.price)
        : Number(dish.price);
      const origPrice = isSpecialToday
        ? Number(dish.original_price ?? this.specialOfDay?.original_price ?? dish.price)
        : Number(dish.original_price ?? dish.precio_regular ?? dish.price);
      const hasDiscount = origPrice > effectivePrice;
      const savings = hasDiscount ? Number((origPrice - effectivePrice).toFixed(2)) : 0;
      const discPct = isSpecialToday
        ? Number(dish.discount_percent || this.specialOfDay?.discount_percent || 25)
        : Number(dish.discount_percent || 0);

      // Máximo 2 insignias limpias por tarjeta para mantener una vista elegante sin saturación
      const badges = [];
      if (isSpecialToday) {
        badges.push(`<span class="badge bg-danger text-white" style="font-size: 0.65rem;">🔥 Especial -${discPct}%</span>`);
      } else if (isOtherDay) {
        badges.push(`<span class="carta-schedule-pill"><i class="bi bi-calendar-event"></i> ${this.escapeHtml(this.formatDaysLabel(dish.dias_disponibles))}</span>`);
      } else if (hasDiscount && savings >= 2) {
        badges.push(`<span class="carta-savings-pill">Ahorra S/ ${savings.toFixed(2)}</span>`);
      } else if (dish.is_day_exclusive && dish.available_today) {
        badges.push(`<span class="carta-schedule-pill">Hoy · ${this.escapeHtml(this.formatDaysLabel(dish.dias_disponibles))}</span>`);
      }

      if (isPopularWeek && badges.length < 2) {
        badges.push(
          `<span class="carta-popular-badge" title="Top ventas reales de los últimos días">
             <i class="bi bi-trophy-fill"></i>
             ${popularRank > 0 ? `Top #${popularRank}` : 'Popular'}${weeklyUnits > 0 ? ` · ${weeklyUnits}` : ''}
           </span>`
        );
      } else if (badges.length === 0 && dish.etiqueta_marketing) {
        badges.push(`<span class="badge bg-light text-secondary border" style="font-size: 0.64rem;">${this.escapeHtml(dish.etiqueta_marketing)}</span>`);
      }

      const priceHtml = hasDiscount
        ? `<div class="carta-price-group">
             <span class="carta-price-old">S/ ${origPrice.toFixed(2)}</span>
             <span class="carta-dish-price">${this.formatPriceHtml(effectivePrice)}</span>
           </div>`
        : `<span class="carta-dish-price">${this.formatPriceHtml(effectivePrice)}</span>`;

      const cardClasses = [
        'carta-dish-card',
        isSpecialToday ? 'carta-dish-card-special' : '',
        (!isSpecialToday && isPopularWeek) ? 'carta-dish-card-popular' : '',
        (!isSpecialToday && isCombo) ? 'carta-dish-card-combo' : '',
        isOtherDay ? 'carta-dish-card-other-day' : ''
      ].filter(Boolean).join(' ');

      return `
        <article class="${cardClasses}">
          <img
            src="${this.escapeHtml(dish.image || fallbackImg)}"
            alt="${this.escapeHtml(dish.name)}"
            class="carta-dish-thumb"
            loading="lazy"
            onerror="this.onerror=null;this.src='${fallbackImg}'"
          >
          <div class="carta-dish-content">
            <div class="d-flex align-items-center gap-1 flex-wrap mb-1">
              <h3 class="carta-dish-title mb-0">${this.escapeHtml(dish.name)}</h3>
              ${badges.join('')}
            </div>
            <p class="carta-dish-desc">${this.escapeHtml(dish.description)}</p>
            <div class="carta-dish-footer">
              ${priceHtml}
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
    const prod = this.findProductById(productId);
    if (!prod) return;

    const effectivePrice = Number(prod.price);
    const origPrice = Number(prod.original_price ?? prod.price);
    const discPct = Number(prod.discount_percent || 0);
    const isSpecial = Boolean(prod.is_special_of_day);

    const existing = this.cart.find((i) => Number(i.id) === Number(productId));
    if (existing) {
      existing.qty += 1;
      // Si ya estaba marcado como complemento rebajado (-20%) y hay plato principal, conservar su precio de complemento para coincidir con el backend
      if (!(existing.is_complement && this.hasRegularCartItem() && !isSpecial)) {
        existing.price = effectivePrice;
        existing.original_price = origPrice;
        existing.discount_percent = discPct;
        existing.is_special_of_day = isSpecial;
        existing.is_complement = false;
      }
    } else {
      this.cart.push({
        id: Number(prod.id),
        name: prod.name,
        category: prod.category || '',
        price: effectivePrice,
        original_price: origPrice,
        discount_percent: discPct,
        is_special_of_day: isSpecial,
        is_complement: false,
        qty: 1,
        notes: '',
        showNote: false
      });
    }

    this.persistCartDraft();
    this.renderSpecialOfDay();
    this.renderDishes();
    this.updateBottomBar();
    this.renderCartModalItems();
    this.showToast(
      isSpecial
        ? `🔥 ${prod.name} agregado con -${discPct}% (S/ ${effectivePrice.toFixed(2)})`
        : `${prod.name} agregado (S/ ${effectivePrice.toFixed(2)})`
    );
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
    this.pickRandomComplements(4, true);
    this.renderCartModalItems();
    const modalEl = document.getElementById('cartaCartModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  },

  shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  },

  pickRandomComplements(count = 4, avoidPrevious = false) {
    const cartIds = new Set(this.cart.map((i) => Number(i.id)));
    const prevIds = new Set((this.randomComplements || []).map((c) => Number(c.id)));
    const allAvailable = (this.complementPool || []).filter((c) => !cartIds.has(Number(c.id)));

    if (!allAvailable.length) {
      this.randomComplements = [];
      return [];
    }

    // Priorizar opciones nuevas cuando el cliente pulsa "Otros al azar"
    const freshCandidates = avoidPrevious
      ? allAvailable.filter((c) => !prevIds.has(Number(c.id)))
      : allAvailable;
    const primaryPool = freshCandidates.length >= count ? freshCandidates : allAvailable;

    // Mezclar al azar priorizando variedad de categorías (Bebidas, Postres y Entradas)
    const byCategory = new Map();
    for (const item of this.shuffleArray(primaryPool)) {
      const catKey = String(item.category || item.id_categoria || 'otros');
      if (!byCategory.has(catKey)) byCategory.set(catKey, []);
      byCategory.get(catKey).push(item);
    }

    const picked = [];
    const pickedIds = new Set();
    const catKeys = this.shuffleArray([...byCategory.keys()]);

    // Primero 1 complemento al azar de cada categoría disponible
    for (const key of catKeys) {
      if (picked.length >= count) break;
      const list = byCategory.get(key) || [];
      const first = list.shift();
      if (first && !pickedIds.has(Number(first.id))) {
        picked.push(first);
        pickedIds.add(Number(first.id));
      }
    }

    // Completar hasta `count` (4) al azar del resto del pool
    const remainder = this.shuffleArray(allAvailable.filter((c) => !pickedIds.has(Number(c.id))));
    for (const item of remainder) {
      if (picked.length >= count) break;
      picked.push(item);
      pickedIds.add(Number(item.id));
    }

    this.randomComplements = picked;
    return picked;
  },

  shuffleRandomComplements() {
    this.pickRandomComplements(4, true);
    this.renderCartUpsell();
  },

  addComplementToCart(productId) {
    const id = Number(productId);
    const comp = (this.complementPool || []).find((c) => Number(c.id) === id);
    if (!comp) {
      this.addToCart(id);
      return;
    }

    if (!this.hasRegularCartItem()) {
      this.addToCart(id);
      return;
    }

    const compPrice = Number(comp.complement_price ?? comp.price);
    const origPrice = Number(comp.original_price ?? compPrice);
    const discPct = Number(comp.discount_percent || this.complementDiscountPercent || 20);
    const savings = Number((origPrice - compPrice).toFixed(2));

    const existing = this.cart.find((i) => Number(i.id) === id);
    if (existing) {
      existing.qty += 1;
      existing.price = compPrice;
      existing.original_price = origPrice;
      existing.discount_percent = discPct;
      existing.is_complement = true;
    } else {
      this.cart.push({
        id,
        name: comp.name,
        category: comp.category || '',
        price: compPrice,
        original_price: origPrice,
        discount_percent: discPct,
        is_special_of_day: false,
        is_complement: true,
        qty: 1,
        notes: '',
        showNote: false
      });
    }

    // Reemplazar el complemento recién agregado por otra sugerencia al azar disponible
    const cartIds = new Set(this.cart.map((i) => Number(i.id)));
    const remaining = (this.randomComplements || []).filter((c) => !cartIds.has(Number(c.id)));
    const shownIds = new Set(remaining.map((c) => Number(c.id)));
    const extras = this.shuffleArray(
      (this.complementPool || []).filter((c) => !cartIds.has(Number(c.id)) && !shownIds.has(Number(c.id)))
    );
    while (remaining.length < 4 && extras.length > 0) {
      remaining.push(extras.shift());
    }
    this.randomComplements = remaining;

    this.persistCartDraft();
    this.renderSpecialOfDay();
    this.renderDishes();
    this.updateBottomBar();
    this.renderCartModalItems();
    this.showToast(
      `✨ ${comp.name} añadido como complemento (-${discPct}% • Ahorras S/ ${savings.toFixed(2)})`
    );
  },

  toggleItemNote(idx) {
    if (!this.cart[idx]) return;
    this.cart[idx].showNote = !this.cart[idx].showNote;
    this.renderCartModalItems();
  },

  toggleOrderComment(enabled) {
    this.orderCommentEnabled = Boolean(enabled);
    const box = document.getElementById('carta-order-comment-box');
    if (box) box.classList.toggle('d-none', !this.orderCommentEnabled);
    if (!this.orderCommentEnabled) {
      const ta = document.getElementById('carta-order-comment');
      if (ta) ta.value = '';
    }
  },

  renderCartUpsell() {
    const upsellBox = document.getElementById('carta-cart-upsell');
    if (!upsellBox) return;

    if (this.cart.length === 0 || !this.hasRegularCartItem() || !this.complementPool.length) {
      upsellBox.classList.add('d-none');
      upsellBox.innerHTML = '';
      return;
    }

    const cartIds = new Set(this.cart.map((i) => Number(i.id)));
    const currentValid = (this.randomComplements || []).filter((c) => !cartIds.has(Number(c.id)));
    if (currentValid.length === 0) {
      this.pickRandomComplements(4, false);
    } else if (currentValid.length < 4) {
      const shownIds = new Set(currentValid.map((c) => Number(c.id)));
      const extras = this.shuffleArray(
        this.complementPool.filter((c) => !cartIds.has(Number(c.id)) && !shownIds.has(Number(c.id)))
      );
      while (currentValid.length < 4 && extras.length > 0) {
        currentValid.push(extras.shift());
      }
      this.randomComplements = currentValid;
    }

    const suggestions = (this.randomComplements || []).slice(0, 4);
    if (!suggestions.length) {
      upsellBox.classList.add('d-none');
      upsellBox.innerHTML = '';
      return;
    }

    const fallbackImg = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=240&q=80';
    const discPct = Number(this.complementDiscountPercent || 20);
    const canShuffle = this.complementPool.filter((c) => !cartIds.has(Number(c.id))).length > suggestions.length;

    upsellBox.classList.remove('d-none');
    upsellBox.innerHTML = `
      <div class="carta-cart-upsell-header">
        <div class="carta-cart-upsell-title mb-0">
          <i class="bi bi-stars text-melidan-orange"></i>
          <span>¿Acompañas tu pedido por menos?</span>
          <span class="carta-upsell-promo-badge">-${discPct}% EXTRA</span>
        </div>
        ${canShuffle ? `
          <button type="button" class="carta-upsell-shuffle-btn" onclick="cartaApp.shuffleRandomComplements()" title="Mostrar otros complementos al azar">
            <i class="bi bi-shuffle"></i> Otros al azar
          </button>
        ` : ''}
      </div>
      <div class="carta-cart-upsell-sub">Complementos elegidos al azar a precio exclusivo por acompañar tu plato:</div>
      <div class="carta-cart-upsell-list">
        ${suggestions.map((s) => {
          const orig = Number(s.original_price ?? s.price);
          const promo = Number(s.complement_price ?? s.price);
          const pct = Number(s.discount_percent || discPct);
          return `
            <div class="carta-upsell-item">
              <img
                src="${this.escapeHtml(s.image || fallbackImg)}"
                alt="${this.escapeHtml(s.name)}"
                class="carta-upsell-thumb"
                loading="lazy"
                onerror="this.onerror=null;this.src='${fallbackImg}'"
              >
              <div class="carta-upsell-info">
                <div class="carta-upsell-meta">
                  <span class="carta-upsell-cat">${this.escapeHtml(s.category || 'Complemento')}</span>
                  <span class="carta-upsell-disc">-${pct}%</span>
                </div>
                <div class="carta-upsell-name" title="${this.escapeHtml(s.name)}">${this.escapeHtml(s.name)}</div>
                <div class="carta-upsell-bottom">
                  <div class="carta-upsell-prices">
                    ${orig > promo ? `<span class="carta-upsell-old">S/ ${orig.toFixed(2)}</span>` : ''}
                    <span class="carta-upsell-new">S/ ${promo.toFixed(2)}</span>
                  </div>
                  <button
                    type="button"
                    class="btn btn-sm btn-melidan-orange carta-upsell-add-btn"
                    onclick="cartaApp.addComplementToCart(${Number(s.id)})"
                  >+ Añadir</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  renderCartModalItems() {
    const container = document.getElementById('carta-cart-modal-items');
    const submitBtn = document.getElementById('btn-carta-submit-order');
    if (!container) return;

    this.updateBottomBar();
    this.renderCartUpsell();

    if (this.cart.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-bag-plus fs-1 d-block mb-2"></i>
          <div class="fw-bold">Tu carrito está vacío</div>
          <small>Pulsa el botón naranja <strong>+</strong> en cualquier plato, combo o en el <strong>Platillo Especial del Día</strong>.</small>
        </div>
      `;
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    if (submitBtn) submitBtn.disabled = false;

    container.innerHTML = this.cart.map((item, idx) => {
      const hasDiscount = Number(item.original_price || 0) > Number(item.price);
      const unitInfo = hasDiscount
        ? `<span class="text-decoration-line-through me-1">S/ ${Number(item.original_price).toFixed(2)}</span><strong class="text-melidan-orange">S/ ${item.price.toFixed(2)}</strong> c/u`
        : `S/ ${item.price.toFixed(2)} c/u`;

      return `
        <div class="carta-cart-item-row">
          <div class="d-flex justify-content-between align-items-center gap-2">
            <div>
              <div class="d-flex align-items-center gap-1 flex-wrap">
                <span class="fw-bold small">${this.escapeHtml(item.name)}</span>
                ${item.is_special_of_day
                  ? `<span class="badge bg-danger text-white" style="font-size: 0.62rem;">-${Number(item.discount_percent || 25)}% Especial</span>`
                  : (item.is_complement
                    ? `<span class="badge bg-info-subtle text-info border border-info-subtle" style="font-size: 0.62rem;">✨ -${Number(item.discount_percent || 20)}% Complemento</span>`
                    : (hasDiscount ? '<span class="badge bg-success-subtle text-success" style="font-size: 0.62rem;">Precio Promo</span>' : ''))}
              </div>
              <small class="text-muted">${unitInfo} • Subtotal: <strong>S/ ${(item.price * item.qty).toFixed(2)}</strong></small>
            </div>
            <div class="d-flex align-items-center gap-2">
              <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="cartaApp.changeQty(${idx}, -1)">-</button>
              <span class="fw-bold small">${item.qty}</span>
              <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" onclick="cartaApp.changeQty(${idx}, 1)">+</button>
            </div>
          </div>
          <div class="mt-1">
            <button type="button" class="carta-note-toggle-btn" onclick="cartaApp.toggleItemNote(${idx})">
              <i class="bi bi-chat-dots"></i>
              <span>${item.showNote ? 'Ocultar comentario' : (item.notes ? `Comentario: "${this.escapeHtml(item.notes.slice(0, 28))}"` : '+ Agregar comentario (opcional)')}</span>
            </button>
            ${item.showNote ? `
              <input
                type="text"
                class="form-control form-control-melidan form-control-sm mt-1"
                placeholder="Ej. sin ají, término medio, poco hielo..."
                value="${this.escapeHtml(item.notes || '')}"
                oninput="cartaApp.updateItemNote(${idx}, this.value)"
              >
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  },

  changeQty(idx, delta) {
    if (!this.cart[idx]) return;
    this.cart[idx].qty += delta;
    if (this.cart[idx].qty <= 0) {
      this.cart.splice(idx, 1);
    }
    this.reconcileComplementEligibility();
    this.persistCartDraft();
    this.renderSpecialOfDay();
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
    this.renderSpecialOfDay();
    this.renderDishes();
    this.renderCartModalItems();
  },

  async submitOrder() {
    if (this.isSubmittingOrder) return;
    if (this.cart.length === 0) {
      this.showToast('Agrega al menos un plato antes de confirmar el pedido', 'error');
      return;
    }

    this.isSubmittingOrder = true;
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
    const orderComment = this.orderCommentEnabled
      ? (document.getElementById('carta-order-comment')?.value.trim() || '')
      : '';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Enviando...';
    }

    try {
      const payload = {
        table_num: this.selectedMesa,
        client_name: clientName || 'Comensal',
        comentarios: orderComment,
        id_usuario: user?.db_id || null,
        waiter_name: (normRole === 'WAITER' || normRole === 'ADMIN') ? (user?.name || '') : '',
        items: this.cart.map((item) => ({
          id_producto: item.id,
          cantidad: item.qty,
          observaciones: item.notes || '',
          es_complemento: Boolean(item.is_complement)
        }))
      };

      const order = await window.db.createOrder(payload);
      this.cart = [];
      this.persistCartDraft();
      const toggleEl = document.getElementById('carta-comment-toggle');
      if (toggleEl) toggleEl.checked = false;
      this.toggleOrderComment(false);

      this.renderSpecialOfDay();
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
      this.isSubmittingOrder = false;
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

    const carouselCard = document.getElementById('carta-carousel-card');
    if (carouselCard) {
      carouselCard.addEventListener('mouseenter', () => {
        this.carouselPaused = true;
        this.stopCarouselAutoplay();
      });
      carouselCard.addEventListener('mouseleave', () => {
        this.carouselPaused = false;
        this.startCarouselAutoplay();
      });
    }

    const viewport = document.getElementById('carta-carousel-viewport');
    if (viewport) {
      // Deslizar táctil en celular/tablet
      viewport.addEventListener('touchstart', (e) => {
        this.touchStartX = e.changedTouches?.[0]?.clientX ?? null;
      }, { passive: true });

      viewport.addEventListener('touchend', (e) => {
        if (this.touchStartX === null) return;
        const endX = e.changedTouches?.[0]?.clientX ?? this.touchStartX;
        const diff = endX - this.touchStartX;
        this.touchStartX = null;
        if (Math.abs(diff) >= 42) {
          if (diff < 0) this.nextSlide();
          else this.prevSlide();
        }
      }, { passive: true });

      // Arrastrar con el cursor del mouse en el carrusel principal
      viewport.addEventListener('dragstart', (e) => e.preventDefault());
      viewport.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        this.heroMouseStartX = e.clientX;
        viewport.classList.add('is-dragging');
      });

      const finishHeroDrag = (e) => {
        if (this.heroMouseStartX === null) return;
        const clientX = typeof e?.clientX === 'number' ? e.clientX : this.heroMouseStartX;
        const diff = clientX - this.heroMouseStartX;
        this.heroMouseStartX = null;
        viewport.classList.remove('is-dragging');
        if (Math.abs(diff) >= 42) {
          this.heroSuppressClickUntil = Date.now() + 180;
          if (diff < 0) this.nextSlide();
          else this.prevSlide();
        }
      };

      window.addEventListener('mouseup', finishHeroDrag);
      window.addEventListener('blur', () => {
        this.heroMouseStartX = null;
        viewport.classList.remove('is-dragging');
      });

      // Flechas del teclado en el carrusel principal
      viewport.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.nextSlide();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.prevSlide();
        }
      });
    }

    // Carrusel de Promos y Menú por Día: arrastre con cursor, rueda, teclado y táctil
    const promoStrip = document.getElementById('carta-promos-strip');
    if (promoStrip) {
      promoStrip.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this.promoDrag = {
          active: true,
          startX: e.clientX,
          startScrollLeft: promoStrip.scrollLeft,
          moved: false
        };
        promoStrip.classList.add('is-dragging');
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.promoDrag.active) return;
        const dx = e.clientX - this.promoDrag.startX;
        if (Math.abs(dx) > 6) {
          this.promoDrag.moved = true;
        }
        if (this.promoDrag.moved) {
          e.preventDefault();
          promoStrip.scrollLeft = this.promoDrag.startScrollLeft - dx * 1.15;
        }
      });

      const finishPromoDrag = () => {
        if (!this.promoDrag.active) return;
        if (this.promoDrag.moved) {
          this.promoSuppressClickUntil = Date.now() + 200;
        }
        this.promoDrag.active = false;
        this.promoDrag.moved = false;
        promoStrip.classList.remove('is-dragging');
        this.updatePromosCarouselUI();
      };

      window.addEventListener('mouseup', finishPromoDrag);
      window.addEventListener('blur', finishPromoDrag);
      promoStrip.addEventListener('dragstart', (e) => e.preventDefault());

      // Rueda horizontal / Shift + rueda del mouse
      promoStrip.addEventListener('wheel', (e) => {
        if (e.shiftKey && Math.abs(e.deltaY) > 0) {
          e.preventDefault();
          promoStrip.scrollLeft += e.deltaY;
        }
      }, { passive: false });

      // Flechas del teclado cuando el carrusel tiene foco
      promoStrip.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.slidePromos(1);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.slidePromos(-1);
        }
      });

      // Sincronizar puntitos y flechas al desplazar (táctil, mouse o flechas)
      promoStrip.addEventListener('scroll', () => {
        if (this.promoScrollRaf) cancelAnimationFrame(this.promoScrollRaf);
        this.promoScrollRaf = requestAnimationFrame(() => this.updatePromosCarouselUI());
      }, { passive: true });

      window.addEventListener('resize', () => this.updatePromosCarouselUI());
    }

    // Accesibilidad por teclado en la barra inferior "Ver Carrito"
    const bottomBar = document.getElementById('carta-bottom-bar');
    if (bottomBar) {
      bottomBar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.openCartModal();
        }
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
