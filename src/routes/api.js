/**
 * src/routes/api.js - Rutas RESTful de Restaurante Melidan (PostgreSQL 18)
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { publicUser, userDto, validateUser, dbRoleAliases } = require('../utils/validators');
const { signToken, verifyToken, extractBearerToken, requireAdmin } = require('../utils/authToken');
const { generateReceiptPdf, numberToSpanishWords, computeVerificationHash } = require('../utils/receiptPdf');
const { generateSalesExcel } = require('../utils/salesExcel');
const { ensureCartaMarketingSchema } = require('../utils/syncCartaMarketing');

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const DAY_CODES = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
const DAY_GROUP_LABELS = {
  LUN: 'Lunes · Miércoles · Viernes',
  MIE: 'Lunes · Miércoles · Viernes',
  VIE: 'Lunes · Miércoles · Viernes',
  MAR: 'Martes · Jueves · Sábado',
  JUE: 'Martes · Jueves · Sábado',
  SAB: 'Martes · Jueves · Sábado',
  DOM: 'Especial de Domingo'
};

function getPeruDateString(inputDate) {
  if (inputDate && /^\d{4}-\d{2}-\d{2}$/.test(String(inputDate).trim())) {
    return String(inputDate).trim();
  }
  const now = new Date();
  const peru = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return peru.toISOString().slice(0, 10);
}

function getPeruDayCode(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return DAY_CODES[dt.getUTCDay()] || 'DOM';
}

function resolveDayCode(rawDay, dateStr) {
  const clean = String(rawDay || '').trim().toUpperCase();
  if (DAY_CODES.includes(clean)) return clean;
  return getPeruDayCode(dateStr);
}

function matchesDayCode(diasDisponibles, dayCode) {
  const raw = String(diasDisponibles || 'TODOS').trim().toUpperCase();
  if (!raw || raw === 'TODOS') return true;
  return raw.split(',').map((s) => s.trim()).includes(dayCode);
}

function formatPeruDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${days[dt.getUTCDay()]} ${d} de ${months[dt.getUTCMonth()]}`;
}

function createSeededRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function next() {
    h += 0x6D2B79F5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededPick(list, count, rng) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

const DAILY_SPECIAL_DISCOUNT_PERCENT = 25;
const COMPLEMENT_DISCOUNT_PERCENT = 20;
const COMPLEMENT_CATEGORY_IDS = new Set([3, 4, 5]); // Bebidas y Jarras (3), Postres (4), Entradas (5)
const WEEKLY_POPULAR_LIMIT = 4;

function getDayIndexFromDateStr(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function getCyclePermutation(list, cycleIndex, salt) {
  const n = list.length;
  if (n <= 1) return [...list];
  const perm = seededPick(list, n, createSeededRng(`${salt}-cycle-${cycleIndex}`));
  // Evitar que el primer elemento de un nuevo ciclo coincida con el último del ciclo anterior
  if (n > 1) {
    const prevPerm = seededPick(list, n, createSeededRng(`${salt}-cycle-${cycleIndex - 1}`));
    if (prevPerm.length && Number(perm[0].id) === Number(prevPerm[prevPerm.length - 1].id)) {
      [perm[0], perm[1]] = [perm[1], perm[0]];
    }
  }
  return perm;
}

function buildDailySpecials(products, dateStr, dayCodeOverride = null) {
  const canonicalProducts = [...products].sort((a, b) => Number(a.id) - Number(b.id));
  const dayCode = resolveDayCode(dayCodeOverride, dateStr);
  const dayOffset = dayCodeOverride && DAY_CODES.includes(String(dayCodeOverride).toUpperCase())
    ? DAY_CODES.indexOf(String(dayCodeOverride).toUpperCase())
    : 0;
  const dayIndex = getDayIndexFromDateStr(dateStr) + dayOffset;

  // Separar platos fijos (TODOS) y exclusivos del día para garantizar rotación sin solapamiento entre días consecutivos
  const isShowcaseFood = (p) => {
    const c = String(p.categoria_nombre || '').toLowerCase();
    return !c.includes('bebida') && !c.includes('postre') && !c.includes('combo') && !c.includes('menú') && !c.includes('menu');
  };

  const alwaysFoodPool = canonicalProducts.filter((p) => isShowcaseFood(p) && String(p.dias_disponibles || 'TODOS').toUpperCase() === 'TODOS');
  const dayExclusiveFoodPool = canonicalProducts.filter((p) => isShowcaseFood(p) && String(p.dias_disponibles || 'TODOS').toUpperCase() !== 'TODOS' && matchesDayCode(p.dias_disponibles, dayCode));
  const platosPool = [...dayExclusiveFoodPool, ...alwaysFoodPool];

  // Candidatos estables (TODOS) para el Platillo Especial del Día: rotación cíclica garantizada sin repetición
  const mainDishesPool = alwaysFoodPool.filter((p) => {
    const c = String(p.categoria_nombre || '').toLowerCase();
    const isMain = c.includes('horno') || c.includes('fondo') || c.includes('especial') || c.includes('criollo');
    return isMain && Number(p.price) >= 24;
  });

  const specialCandidates = mainDishesPool.length > 0 ? mainDishesPool : alwaysFoodPool;

  // Rotación cíclica garantizada por día: nunca repite el mismo Platillo Especial en días consecutivos
  let pickedSpecialRaw = null;
  let nextSpecialRaw = null;
  if (specialCandidates.length > 0) {
    const n = specialCandidates.length;
    const cycleIdx = Math.floor(dayIndex / n);
    const posInCycle = ((dayIndex % n) + n) % n;
    const cyclePerm = getCyclePermutation(specialCandidates, cycleIdx, 'melidan-special');
    pickedSpecialRaw = cyclePerm[posInCycle];

    const tomorrowIdx = dayIndex + 1;
    const tomorrowCycleIdx = Math.floor(tomorrowIdx / n);
    const tomorrowPos = ((tomorrowIdx % n) + n) % n;
    const tomorrowPerm = tomorrowCycleIdx === cycleIdx
      ? cyclePerm
      : getCyclePermutation(specialCandidates, tomorrowCycleIdx, 'melidan-special');
    nextSpecialRaw = tomorrowPerm[tomorrowPos] || null;
  }

  let specialOfDay = null;
  const usedIds = new Set();
  const usedImages = new Set();

  if (pickedSpecialRaw) {
    const originalPrice = Number(Number(pickedSpecialRaw.price).toFixed(2));
    const discountPercent = DAILY_SPECIAL_DISCOUNT_PERCENT;
    const specialPrice = Number((originalPrice * (1 - discountPercent / 100)).toFixed(2));
    const savingsAmount = Number((originalPrice - specialPrice).toFixed(2));

    usedIds.add(Number(pickedSpecialRaw.id));
    if (pickedSpecialRaw.image) usedImages.add(String(pickedSpecialRaw.image).trim());

    specialOfDay = {
      ...pickedSpecialRaw,
      id: Number(pickedSpecialRaw.id),
      category: pickedSpecialRaw.categoria_nombre,
      original_price: originalPrice,
      discount_percent: discountPercent,
      special_price: specialPrice,
      savings_amount: savingsAmount,
      price: specialPrice,
      is_special_of_day: true,
      rotates_daily: true,
      next_special_name: nextSpecialRaw ? nextSpecialRaw.name : null,
      promo_label: `Platillo Especial del Día (-${discountPercent}%)`
    };
  }

  // Anillo fijo de imágenes únicas (TODOS) + 1 plato exclusivo del día (Lun·Mié·Vie / Mar·Jue·Sáb / Dom)
  const uniqueImageRing = [];
  const ringImgSeen = new Set();
  for (const dish of seededPick(alwaysFoodPool, alwaysFoodPool.length, createSeededRng('melidan-carousel-ring-v2'))) {
    const imgKey = String(dish.image || '').trim();
    if (imgKey && ringImgSeen.has(imgKey)) continue;
    uniqueImageRing.push(dish);
    if (imgKey) ringImgSeen.add(imgKey);
  }

  const carouselPicked = [];
  // Slide 1: destacar un plato exclusivo del día (ej. Carapulcra/Arroz con Mariscos Lun·Mié·Vie, Tacu Tacu Mar·Jue·Sáb, Pachamanca Dom)
  if (dayExclusiveFoodPool.length > 0) {
    const exIdx = ((dayIndex % dayExclusiveFoodPool.length) + dayExclusiveFoodPool.length) % dayExclusiveFoodPool.length;
    const exDish = dayExclusiveFoodPool[exIdx];
    const exImg = String(exDish.image || '').trim();
    if (!usedIds.has(Number(exDish.id)) && (!exImg || !usedImages.has(exImg))) {
      carouselPicked.push(exDish);
      usedIds.add(Number(exDish.id));
      if (exImg) usedImages.add(exImg);
    }
  }

  // Slides restantes desde el anillo fijo avanzando 4 posiciones por día (cero solapamiento entre días seguidos)
  if (uniqueImageRing.length > 0) {
    const ringLen = uniqueImageRing.length;
    const startOffset = (((dayIndex * 4) % ringLen) + ringLen) % ringLen;
    for (let step = 0; step < ringLen && carouselPicked.length < 4; step++) {
      const dish = uniqueImageRing[(startOffset + step) % ringLen];
      const idNum = Number(dish.id);
      const imgKey = String(dish.image || '').trim();
      if (usedIds.has(idNum)) continue;
      if (imgKey && usedImages.has(imgKey)) continue;
      carouselPicked.push(dish);
      usedIds.add(idNum);
      if (imgKey) usedImages.add(imgKey);
    }
  }
  for (const dish of platosPool) {
    if (carouselPicked.length >= 4) break;
    if (usedIds.has(Number(dish.id))) continue;
    carouselPicked.push(dish);
    usedIds.add(Number(dish.id));
  }

  const carousel = carouselPicked.slice(0, 4).map((item, idx) => {
    const basePrice = Number(Number(item.price).toFixed(2));
    const regPrice = item.precio_regular ? Number(Number(item.precio_regular).toFixed(2)) : basePrice;
    return {
      ...item,
      id: Number(item.id),
      slide_index: idx,
      price: basePrice,
      original_price: regPrice,
      category: item.categoria_nombre,
      badge_label: item.etiqueta_marketing || (item.destacado_menu ? 'Recomendado' : (item.categoria_nombre || 'Plato de la Casa'))
    };
  });

  return {
    date: dateStr,
    day_code: dayCode,
    day_label: formatPeruDayLabel(dateStr),
    schedule_label: DAY_GROUP_LABELS[dayCode] || 'Selección de Hoy',
    rotates_daily: true,
    counts: {
      carousel: carousel.length,
      special: specialOfDay ? 1 : 0,
      total: carousel.length + (specialOfDay ? 1 : 0)
    },
    carousel,
    special_of_day: specialOfDay
  };
}

async function fetchWeeklyPopularRanking(queryable, products, limit = WEEKLY_POPULAR_LIMIT) {
  const foodProductIds = new Set(
    products
      .filter((p) => {
        const c = String(p.categoria_nombre || '').toLowerCase();
        return !c.includes('bebida');
      })
      .map((p) => Number(p.id))
  );

  const queryWindow = async (days) => {
    const { rows } = await queryable.query(
      `SELECT dp.id_producto AS id,
              SUM(dp.cantidad)::int AS unidades_vendidas,
              COUNT(DISTINCT p.id_pedido)::int AS total_pedidos
       FROM detalle_pedidos dp
       JOIN pedidos p ON p.id_pedido = dp.id_pedido
       WHERE p.estado <> 'cancelado'
         AND p.fecha_hora >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 day')
       GROUP BY dp.id_producto
       ORDER BY unidades_vendidas DESC, total_pedidos DESC, dp.id_producto ASC`,
      [days]
    );
    return rows;
  };

  let windowDays = 7;
  let source = 'ventas_7d';
  let rows = await queryWindow(7);
  let rankedFood = rows.filter((r) => foodProductIds.has(Number(r.id)) && Number(r.unidades_vendidas) > 0);

  if (rankedFood.length === 0) {
    windowDays = 30;
    source = 'ventas_30d';
    rows = await queryWindow(30);
    rankedFood = rows.filter((r) => foodProductIds.has(Number(r.id)) && Number(r.unidades_vendidas) > 0);
  }

  const statsById = new Map();
  for (const r of rows) {
    statsById.set(Number(r.id), {
      unidades_vendidas: Number(r.unidades_vendidas || 0),
      total_pedidos: Number(r.total_pedidos || 0)
    });
  }

  const topIds = rankedFood.slice(0, limit).map((r) => Number(r.id));
  if (topIds.length === 0) {
    source = 'recomendados';
    for (const p of products) {
      if (topIds.length >= limit) break;
      if (foodProductIds.has(Number(p.id)) && p.destacado_menu) {
        topIds.push(Number(p.id));
      }
    }
  }

  const rankMap = new Map();
  topIds.forEach((id, idx) => rankMap.set(id, idx + 1));

  return {
    window_days: windowDays,
    source,
    top_ids: topIds,
    rankMap,
    statsById
  };
}

async function fetchAvailableCatalogProducts(queryable) {
  const { rows } = await queryable.query(
    `SELECT p.id_producto AS id, p.id_categoria, c.nombre AS categoria_nombre,
            p.nombre AS name, p.descripcion AS description, p.precio AS price,
            p.precio_regular, p.etiqueta_marketing, COALESCE(p.dias_disponibles, 'TODOS') AS dias_disponibles,
            p.tipo_coccion, p.tiempo_preparacion_min, p.destacado_menu, p.disponible,
            p.imagen_url AS image
     FROM productos p
     LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
     WHERE p.disponible = TRUE
     ORDER BY p.id_producto ASC`
  );
  return rows;
}

function resolvePaymentChannel(metodoPago, rawChannel) {
  const ch = String(rawChannel || '').trim().toLowerCase();
  if (ch === 'yape') return { dbMethod: 'aplicacion', label: 'Yape' };
  if (ch === 'plin') return { dbMethod: 'aplicacion', label: 'Plin' };
  if (ch === 'efectivo' || ch === 'efectivo_caja') return { dbMethod: 'efectivo_caja', label: 'Efectivo' };
  if (ch === 'tarjeta' || ch === 'tarjeta_caja' || ch === 'tarjeta pos') return { dbMethod: 'tarjeta_caja', label: 'Tarjeta POS' };
  if (metodoPago === 'efectivo_caja') return { dbMethod: 'efectivo_caja', label: 'Efectivo' };
  if (metodoPago === 'tarjeta_caja') return { dbMethod: 'tarjeta_caja', label: 'Tarjeta POS' };
  if (metodoPago === 'aplicacion') return { dbMethod: 'aplicacion', label: 'Yape' };
  return { dbMethod: 'efectivo_caja', label: 'Efectivo' };
}

function buildNextPurchasePromo(voucherNumber, totalAmount) {
  const suffix = crypto.createHash('sha1').update(`${voucherNumber}-${Date.now()}`).digest('hex').slice(0, 4).toUpperCase();
  const code = `MELIDAN15-${suffix}`;
  const isHighTicket = Number(totalAmount || 0) >= 80;
  const description = isHighTicket
    ? '15% de descuento en tu próxima compra + 1 Postre de la Casa GRATIS presentando esta boleta (válido 30 días).'
    : '15% de descuento en tu próxima compra o 1 Bebida Artesanal GRATIS por consumos desde S/ 40.00 (válido 30 días).';
  const validDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const dd = String(validDate.getDate()).padStart(2, '0');
  const mm = String(validDate.getMonth() + 1).padStart(2, '0');
  const yyyy = validDate.getFullYear();
  return {
    codigo_promo: code,
    descripcion_promo: description,
    valido_hasta: `Válido hasta ${dd}/${mm}/${yyyy}`
  };
}

function enrichReceiptObject(row, items, rest) {
  const total = Number(Number(row.monto_total || 0).toFixed(2));
  const subtotal = Number((total / 1.18).toFixed(2));
  const igv = Number((total - subtotal).toFixed(2));
  const channel = row.canal_pago || (
    row.metodo_pago === 'efectivo_caja'
      ? 'Efectivo'
      : (row.metodo_pago === 'tarjeta_caja' ? 'Tarjeta POS' : 'Yape')
  );
  const emissionDate = row.fecha_emision ? new Date(row.fecha_emision) : new Date();
  const validDate = new Date(emissionDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  const validoHasta = `Válido hasta ${String(validDate.getDate()).padStart(2, '0')}/${String(validDate.getMonth() + 1).padStart(2, '0')}/${validDate.getFullYear()}`;

  const enriched = {
    ...row,
    nombre_cliente: row.comprobante_cliente || row.nombre_cliente || 'Cliente General',
    documento_cliente: row.documento_cliente || (row.tipo_comprobante === 'factura' ? '20601234567' : '74589632'),
    cajero_nombre: row.cajero_nombre || row.atendido_por || 'Caja Principal',
    canal_pago: channel,
    referencia_pago: row.referencia_pago || '',
    codigo_promo: row.codigo_promo || `MELIDAN15-${String(row.id_comprobante || 1001).padStart(4, '0')}`,
    descripcion_promo: row.descripcion_promo || '15% de descuento en tu próxima compra o 1 Bebida Artesanal GRATIS (consumo mínimo S/ 40.00). Válido 30 días.',
    valido_hasta: validoHasta,
    restaurante: rest,
    has_receipt: true,
    items: (items || []).map((it) => ({
      ...it,
      cantidad: Number(it.cantidad || 1),
      precio_unitario: Number(it.precio_unitario || 0),
      subtotal: Number(it.subtotal ?? (Number(it.cantidad || 1) * Number(it.precio_unitario || 0)))
    })),
    desglose: {
      subtotal: subtotal.toFixed(2),
      igv: igv.toFixed(2),
      total: total.toFixed(2)
    },
    monto_en_letras: numberToSpanishWords(total),
    pdf_url: `/api/billing/${row.id_comprobante}/pdf`
  };
  enriched.hash_verificacion = computeVerificationHash(enriched);
  return enriched;
}

async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
  return rows[0] || null;
}

async function getNextVoucherNumber(client, tipoComprobante) {
  const serie = tipoComprobante === 'factura' ? 'F001' : 'B001';
  const seq = await client.query(
    `SELECT COALESCE(MAX(NULLIF(SUBSTRING(numero_comprobante FROM '[0-9]+$'), '')::int), 1025) + 1 AS next
     FROM comprobantes`
  );
  const nextInt = Number(seq.rows[0].next || 1026);
  return `${serie}-${String(nextInt).padStart(8, '0')}`;
}

// ============================================================================
// 1. HEALTHCHECK DE BASE DE DATOS
// ============================================================================
router.get('/health', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT current_database() AS database, version() AS version');
  res.json({ success: true, database: rows[0].database, postgres: rows[0].version });
}));

// ============================================================================
// 2. AUTENTICACIÓN, REGISTRO Y RECUPERACIÓN OTP
// ============================================================================
router.all('/auth', asyncRoute(async (req, res) => {
  const action = String(req.query.action || (req.method === 'POST' ? 'login' : 'users'));
  const input = req.body || {};

  if (action === 'login') {
    const email = String(input.email || '').trim().toLowerCase();
    const password = String(input.password || '');
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email y contraseña son requeridos' });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado con ese correo electrónico' });
    }
    if (user.is_deleted || user.estado === 'Inactivo') {
      return res.status(403).json({
        success: false,
        message: 'La cuenta de este usuario se encuentra dada de baja o inactiva. Contacte a Gerencia.'
      });
    }

    const stored = String(user.password_hash || '');
    let valid = false;
    try {
      valid = bcrypt.compareSync(password, stored.replace(/^\$2y\$/, '$2a$'));
    } catch (_) {}

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    const session = publicUser(user);
    session.token = signToken(user);
    return res.json({ success: true, message: 'Inicio de sesión exitoso', token: session.token, user: session });
  }

  if (action === 'register') {
    const v = validateUser(input, false);
    if (!v.is_valid) {
      return res.status(422).json({ success: false, message: 'Falló la validación del registro de usuario', errors: v.errors });
    }
    try {
      const d = v.data;
      const { rows } = await pool.query(
        `INSERT INTO usuarios(nombre, email, password_hash, rol, tipo_documento, numero_documento, nacionalidad, telefono, turno, estado, avatar, is_deleted)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE) RETURNING *`,
        [d.nombre, d.email, d.password_hash, d.rol, d.tipo_documento, d.numero_documento || null, d.nacionalidad, d.telefono || null, d.turno, d.estado, d.avatar]
      );
      const session = publicUser(rows[0]);
      session.token = signToken(rows[0]);
      return res.status(201).json({ success: true, message: '¡Cuenta registrada con éxito en Melidan!', token: session.token, user: session });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ success: false, message: 'El correo electrónico ya se encuentra registrado' });
      }
      throw e;
    }
  }

  if (action === 'request_reset') {
    const email = String(input.email || '').trim().toLowerCase();
    const u = await getUserByEmail(email);
    if (!u) {
      return res.status(404).json({ success: false, message: 'No existe ninguna cuenta asociada a este correo' });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    await pool.query(
      `INSERT INTO recuperacion_claves(id_usuario, codigo, expira_en, usado)
       VALUES($1, $2, CURRENT_TIMESTAMP + INTERVAL '15 minutes', FALSE)`,
      [u.id_usuario, code]
    );
    return res.json({ success: true, message: 'Código de recuperación generado y guardado en PostgreSQL.', email, code });
  }

  if (action === 'verify_code') {
    const { rows } = await pool.query(
      `SELECT r.id
       FROM recuperacion_claves r
       JOIN usuarios u ON r.id_usuario = u.id_usuario
       WHERE LOWER(u.email) = LOWER($1) AND r.codigo = $2 AND r.usado = FALSE AND r.expira_en > CURRENT_TIMESTAMP
       ORDER BY r.id DESC LIMIT 1`,
      [String(input.email || '').trim(), String(input.code || '').replace(/\D/g, '')]
    );
    if (!rows[0]) {
      return res.status(400).json({ success: false, message: 'El código de 6 dígitos es inválido o ya ha expirado' });
    }
    return res.json({ success: true, message: 'Código verificado correctamente' });
  }

  if (action === 'reset_password') {
    const password = String(input.password || '');
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT r.id, u.id_usuario
         FROM recuperacion_claves r
         JOIN usuarios u ON r.id_usuario = u.id_usuario
         WHERE LOWER(u.email) = LOWER($1) AND r.codigo = $2 AND r.usado = FALSE AND r.expira_en > CURRENT_TIMESTAMP
         ORDER BY r.id DESC LIMIT 1`,
        [String(input.email || '').trim(), String(input.code || '').replace(/\D/g, '')]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Código inválido o expirado' });
      }
      const hash = bcrypt.hashSync(password, 12);
      await client.query('UPDATE usuarios SET password_hash = $1, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_usuario = $2', [hash, rows[0].id_usuario]);
      await client.query('UPDATE recuperacion_claves SET usado = TRUE WHERE id = $1', [rows[0].id]);
      await client.query('COMMIT');
      return res.json({ success: true, message: 'Contraseña actualizada correctamente' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return res.status(400).json({ success: false, message: 'Acción no válida' });
}));

// ============================================================================
// 3. GESTIÓN DE PERSONAL Y USUARIOS (CRUD + SOFT DELETE)
// ============================================================================
router.get('/staff', asyncRoute(async (req, res) => {
  const { include_deleted, search = '', role = '', status = '' } = req.query;
  const cond = [];
  const params = [];

  if (!['1', 'true', 'yes'].includes(String(include_deleted))) {
    cond.push('(is_deleted = FALSE OR is_deleted IS NULL)');
  }
  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    cond.push(`(LOWER(nombre) LIKE $${params.length} OR LOWER(email) LIKE $${params.length} OR COALESCE(numero_documento,'') LIKE $${params.length} OR LOWER(COALESCE(nacionalidad,'')) LIKE $${params.length})`);
  }
  if (role && role !== 'Todos' && role !== 'todos') {
    const mappedRole = dbRoleAliases[String(role).toLowerCase().trim()] || String(role).toLowerCase().trim();
    params.push(mappedRole);
    cond.push(`rol = $${params.length}`);
  }
  if (status && status !== 'Todos' && status !== 'todos') {
    params.push(status);
    cond.push(`estado = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT * FROM usuarios ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY id_usuario`,
    params
  );
  const staff = rows.map(userDto);
  res.json({ success: true, count: staff.length, staff });
}));

router.get('/staff/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de usuario inválido' });
  }
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE id_usuario = $1', [id]);
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  res.json({ success: true, user: userDto(rows[0]) });
}));

router.post('/staff', asyncRoute(async (req, res) => {
  const v = validateUser(req.body || {}, false);
  if (!v.is_valid) {
    return res.status(422).json({ success: false, message: 'Falló la validación de datos del usuario', errors: v.errors });
  }
  const d = v.data;
  try {
    const { rows } = await pool.query(
      `INSERT INTO usuarios(nombre, email, password_hash, rol, tipo_documento, numero_documento, nacionalidad, telefono, turno, estado, avatar, is_deleted)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE) RETURNING *`,
      [d.nombre, d.email, d.password_hash, d.rol, d.tipo_documento, d.numero_documento || null, d.nacionalidad, d.telefono || null, d.turno, d.estado, d.avatar]
    );
    const u = userDto(rows[0]);
    res.status(201).json({ success: true, message: 'Usuario registrado exitosamente en la base de datos', member: u, user: u });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ success: false, message: 'Ya existe un usuario registrado con ese correo o documento' });
    }
    throw e;
  }
}));

router.put('/staff/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de usuario inválido' });
  }
  const existingRes = await pool.query('SELECT * FROM usuarios WHERE id_usuario = $1', [id]);
  if (!existingRes.rows[0]) {
    return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  }

  const v = validateUser(req.body || {}, true, existingRes.rows[0]);
  if (!v.is_valid) {
    return res.status(422).json({ success: false, message: 'Errores de validación en los datos enviados', errors: v.errors });
  }

  const d = v.data;
  const fields = [];
  const params = [id];
  const allowedCols = ['nombre', 'email', 'rol', 'tipo_documento', 'numero_documento', 'nacionalidad', 'telefono', 'turno', 'estado', 'avatar', 'password_hash'];

  for (const f of allowedCols) {
    if (Object.prototype.hasOwnProperty.call(d, f)) {
      params.push(d[f]);
      fields.push(`${f} = $${params.length}`);
    }
  }

  if (!fields.length) {
    return res.json({ success: true, member: userDto(existingRes.rows[0]), user: userDto(existingRes.rows[0]) });
  }

  fields.push('fecha_actualizacion = CURRENT_TIMESTAMP');
  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET ${fields.join(', ')} WHERE id_usuario = $1 RETURNING *`,
      params
    );
    res.json({ success: true, message: 'Usuario actualizado correctamente', member: userDto(rows[0]), user: userDto(rows[0]) });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ success: false, message: 'Ese correo electrónico ya pertenece a otro usuario' });
    }
    throw e;
  }
}));

router.delete('/staff/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de usuario inválido' });
  }
  const { rows } = await pool.query(
    `UPDATE usuarios
     SET is_deleted = TRUE, estado = 'Inactivo', fecha_eliminacion = CURRENT_TIMESTAMP, fecha_actualizacion = CURRENT_TIMESTAMP
     WHERE id_usuario = $1 RETURNING *`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  res.json({ success: true, message: `Usuario #${id} archivado (Soft Delete).`, member: userDto(rows[0]) });
}));

router.post('/staff/:id/restore', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de usuario inválido' });
  }
  const { rows } = await pool.query(
    `UPDATE usuarios
     SET is_deleted = FALSE, estado = 'Activo', fecha_eliminacion = NULL, fecha_actualizacion = CURRENT_TIMESTAMP
     WHERE id_usuario = $1 RETURNING *`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  res.json({ success: true, message: 'Usuario restaurado correctamente', member: userDto(rows[0]) });
}));

// ============================================================================
// 4. PRODUCTOS Y CATEGORÍAS (CARTA GASTRONÓMICA)
// ============================================================================
const handleGetCatalog = asyncRoute(async (req, res) => {
  await ensureCartaMarketingSchema(pool);

  const dateStr = getPeruDateString(req.query.date);
  const dayCode = resolveDayCode(req.query.day, dateStr);

  const [cats, products, promosRes] = await Promise.all([
    pool.query(
      `SELECT id_categoria, nombre, descripcion
       FROM categorias
       ORDER BY CASE nombre
         WHEN 'Menú del Día' THEN 1
         WHEN 'Combos' THEN 2
         WHEN 'Platos Criollos' THEN 3
         WHEN 'Platos Especiales' THEN 4
         WHEN 'Entradas' THEN 5
         WHEN 'Bebidas y Jarras' THEN 6
         WHEN 'Postres' THEN 7
         ELSE 8
       END, id_categoria`
    ),
    pool.query(
      `SELECT p.id_producto AS id, p.id_categoria, c.nombre AS categoria_nombre,
              p.nombre AS name, p.descripcion AS description, p.precio AS price,
              p.precio_regular, p.etiqueta_marketing, COALESCE(p.dias_disponibles, 'TODOS') AS dias_disponibles,
              p.tipo_coccion, p.tiempo_preparacion_min, p.destacado_menu, p.disponible,
              p.imagen_url AS image
       FROM productos p
       LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
       WHERE p.disponible = TRUE
       ORDER BY p.destacado_menu DESC, p.id_producto ASC`
    ),
    pool.query(
      `SELECT id_promo, codigo, titulo, subtitulo, badge_texto, dias_aplicables,
              categoria_destino, id_producto_destacado, color_acento
       FROM promociones_carta
       WHERE activa = TRUE
       ORDER BY id_promo ASC`
    )
  ]);

  const dailyShowcase = buildDailySpecials(products.rows, dateStr, req.query.day || null);
  const special = dailyShowcase.special_of_day;
  const popularRanking = await fetchWeeklyPopularRanking(pool, products.rows, WEEKLY_POPULAR_LIMIT);

  const enrichedProducts = products.rows.map((p) => {
    const idNum = Number(p.id);
    const basePrice = Number(Number(p.price).toFixed(2));
    const regularPrice = p.precio_regular ? Number(Number(p.precio_regular).toFixed(2)) : null;
    const dias = String(p.dias_disponibles || 'TODOS').trim().toUpperCase();
    const availableToday = matchesDayCode(dias, dayCode);
    const isDayExclusive = dias !== 'TODOS';
    const popStats = popularRanking.statsById.get(idNum) || { unidades_vendidas: 0, total_pedidos: 0 };
    const popularRank = popularRanking.rankMap.get(idNum) || null;
    const isPopularWeek = popularRank !== null;

    if (special && idNum === Number(special.id)) {
      return {
        ...p,
        price: special.special_price,
        original_price: special.original_price,
        precio_regular: special.original_price,
        has_promo_price: true,
        discount_percent: special.discount_percent,
        savings_amount: special.savings_amount,
        is_special_of_day: true,
        dias_disponibles: dias,
        available_today: availableToday,
        is_day_exclusive: isDayExclusive,
        is_popular_week: isPopularWeek,
        popular_rank: popularRank,
        unidades_vendidas_7d: popStats.unidades_vendidas,
        pedidos_7d: popStats.total_pedidos
      };
    }

    const hasRegularDiscount = regularPrice !== null && regularPrice > basePrice;
    const savings = hasRegularDiscount ? Number((regularPrice - basePrice).toFixed(2)) : 0;
    const discPct = hasRegularDiscount ? Math.round((savings / regularPrice) * 100) : 0;

    return {
      ...p,
      price: basePrice,
      original_price: hasRegularDiscount ? regularPrice : basePrice,
      precio_regular: regularPrice,
      has_promo_price: hasRegularDiscount,
      discount_percent: discPct,
      savings_amount: savings,
      is_special_of_day: false,
      dias_disponibles: dias,
      available_today: availableToday,
      is_day_exclusive: isDayExclusive,
      is_popular_week: isPopularWeek,
      popular_rank: popularRank,
      unidades_vendidas_7d: popStats.unidades_vendidas,
      pedidos_7d: popStats.total_pedidos
    };
  });

  const promociones = promosRes.rows
    .map((pr) => ({
      ...pr,
      active_today: matchesDayCode(pr.dias_aplicables, dayCode)
    }))
    .sort((a, b) => Number(b.active_today) - Number(a.active_today));

  // Pool de complementos con precio promocional (-20%) para selección aleatoria en el carrito
  const complementPool = enrichedProducts
    .filter((p) =>
      COMPLEMENT_CATEGORY_IDS.has(Number(p.id_categoria)) &&
      !p.is_special_of_day &&
      p.available_today !== false
    )
    .map((p) => {
      const regularPrice = Number(Number(p.price).toFixed(2));
      const complementPrice = Number((regularPrice * (1 - COMPLEMENT_DISCOUNT_PERCENT / 100)).toFixed(2));
      const savingsAmount = Number((regularPrice - complementPrice).toFixed(2));
      return {
        id: Number(p.id),
        id_categoria: Number(p.id_categoria),
        name: p.name,
        description: p.description || '',
        category: p.categoria_nombre,
        original_price: regularPrice,
        price: complementPrice,
        complement_price: complementPrice,
        discount_percent: COMPLEMENT_DISCOUNT_PERCENT,
        savings_amount: savingsAmount,
        image: p.image
      };
    });

  // Compatibilidad con upsell_suggestions (ahora con precio de complemento rebajado)
  const upsellJarra = complementPool.find((p) => Number(p.id) === 5 || Number(p.id) === 34) || complementPool.find((p) => p.id_categoria === 3);
  const upsellPostre = complementPool.find((p) => Number(p.id) === 23 || Number(p.id) === 22) || complementPool.find((p) => p.id_categoria === 4);
  const upsellEntrada = complementPool.find((p) => p.id_categoria === 5);
  const upsellSuggestions = [upsellJarra, upsellPostre, upsellEntrada].filter(Boolean);

  res.json({
    success: true,
    date: dateStr,
    day_code: dayCode,
    day_label: formatPeruDayLabel(dateStr),
    schedule_label: DAY_GROUP_LABELS[dayCode] || 'Selección de Hoy',
    categorias: cats.rows,
    productos: enrichedProducts,
    promociones,
    upsell_suggestions: upsellSuggestions,
    complement_pool: complementPool,
    complement_discount_percent: COMPLEMENT_DISCOUNT_PERCENT,
    special_of_day: special,
    popular_meta: {
      window_days: popularRanking.window_days,
      source: popularRanking.source,
      top_ids: popularRanking.top_ids
    }
  });
});

router.get('/products', handleGetCatalog);
router.get('/menu', handleGetCatalog);

// Carrusel de 4 Platos + Platillo Especial del Día con Precio Reducido (y soporte por día)
router.get('/daily-specials', asyncRoute(async (req, res) => {
  await ensureCartaMarketingSchema(pool);
  const dateStr = getPeruDateString(req.query.date);
  const rows = await fetchAvailableCatalogProducts(pool);
  const payload = buildDailySpecials(rows, dateStr, req.query.day || null);
  res.json({ success: true, ...payload });
}));

// ============================================================================
// 5. CONTROL DE MESAS Y AFORO (15 MESAS EN TIEMPO REAL)
// ============================================================================
router.get('/mesas', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id_mesa, numero_mesa, codigo_qr, capacidad, estado, tiempo_min, mozo_asignado, monto_acumulado, is_deleted
     FROM mesas WHERE is_deleted = FALSE ORDER BY numero_mesa`
  );
  const counts = { total: rows.length, libre: 0, ocupada: 0, por_limpiar: 0, cuenta: 0 };
  for (const m of rows) {
    if (m.estado === 'disponible') m.estado = 'libre';
    if (counts[m.estado] !== undefined) counts[m.estado]++;
  }
  res.json({ success: true, counts, data: rows });
}));

router.put('/mesas', asyncRoute(async (req, res) => {
  const d = req.body || {};
  const id = Number(d.numero_mesa ?? d.id_mesa);
  const estado = String(d.estado || '').toLowerCase().trim();

  if (!id || !['libre', 'ocupada', 'por_limpiar', 'cuenta', 'disponible'].includes(estado)) {
    return res.status(422).json({ success: false, message: 'Datos o estado de mesa inválidos' });
  }

  const e = estado === 'disponible' ? 'libre' : estado;
  const isReset = e === 'libre' || e === 'por_limpiar';
  const tiempo = e === 'libre' ? 0 : Number(d.tiempo_min ?? 0);

  let queryResult;
  if (isReset) {
    queryResult = await pool.query(
      `UPDATE mesas
       SET estado = $1, tiempo_min = 0, mozo_asignado = '-', monto_acumulado = 0
       WHERE numero_mesa = $2 OR id_mesa = $2
       RETURNING numero_mesa, estado, tiempo_min, mozo_asignado, monto_acumulado`,
      [e, id]
    );
  } else {
    const mozo = d.mozo_asignado !== undefined ? String(d.mozo_asignado) : null;
    const monto = d.monto_acumulado !== undefined ? Number(d.monto_acumulado) : null;
    queryResult = await pool.query(
      `UPDATE mesas
       SET estado = $1,
           tiempo_min = $2,
           mozo_asignado = COALESCE($3, mozo_asignado),
           monto_acumulado = COALESCE($4, monto_acumulado)
       WHERE numero_mesa = $5 OR id_mesa = $5
       RETURNING numero_mesa, estado, tiempo_min, mozo_asignado, monto_acumulado`,
      [e, tiempo, mozo, monto, id]
    );
  }

  if (!queryResult.rowCount) {
    return res.status(404).json({ success: false, message: 'Mesa no encontrada' });
  }
  res.json({ success: true, message: `Mesa ${id} actualizada correctamente`, mesa: queryResult.rows[0] });
}));

// ============================================================================
// 6. PEDIDOS Y COCINA KDS
// ============================================================================
router.get('/orders', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id_pedido, p.numero_comanda, p.id_mesa, m.numero_mesa, m.estado AS estado_mesa,
            p.id_usuario, p.nombre_cliente, COALESCE(p.comentarios, '') AS comentarios,
            CASE
              WHEN u.rol = 'cliente' THEN 'Pedido en Carta Digital'
              ELSE COALESCE(u.nombre, 'Mozo de Turno')
            END AS mozo_nombre,
            COALESCE((SELECT SUM(dp.cantidad * dp.precio_unitario) FROM detalle_pedidos dp WHERE dp.id_pedido = p.id_pedido), 0) AS total,
            EXISTS(SELECT 1 FROM ventas v WHERE v.id_pedido = p.id_pedido AND v.estado_pago = 'exitoso') AS pagado,
            p.estado, p.fecha_hora,
            TO_CHAR(p.fecha_hora, 'HH12:MI AM') AS hora_formato,
            GREATEST(1, ROUND(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - p.fecha_hora)) / 60))::int AS minutos_transcurridos
     FROM pedidos p
     LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
     LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
     ORDER BY p.id_pedido DESC`
  );

  if (rows.length > 0) {
    const orderIds = rows.map((o) => o.id_pedido);
    const itemsRes = await pool.query(
      `SELECT d.id_detalle, d.id_pedido, d.id_producto, pr.nombre AS nombre_plato,
              d.cantidad, d.precio_unitario, d.observaciones, pr.tipo_coccion, pr.id_categoria,
              CASE
                WHEN pr.id_categoria = 3 THEN 'Bar y Bebidas'
                WHEN pr.id_categoria = 4 THEN 'Repostería / Postres'
                WHEN pr.id_categoria = 5 THEN 'Cocina Fría / Entradas'
                WHEN pr.tipo_coccion::text = 'horno_artesanal' THEN 'Horno Artesanal'
                WHEN pr.tipo_coccion::text = 'fuego_lento' THEN 'Horno / Fuego Lento'
                ELSE 'Estación Wok'
              END AS estacion,
              pr.tiempo_preparacion_min
       FROM detalle_pedidos d
       LEFT JOIN productos pr ON d.id_producto = pr.id_producto
       WHERE d.id_pedido = ANY($1::int[])
       ORDER BY d.id_detalle`,
      [orderIds]
    );

    const byOrder = new Map();
    for (const item of itemsRes.rows) {
      if (!byOrder.has(item.id_pedido)) byOrder.set(item.id_pedido, []);
      byOrder.get(item.id_pedido).push(item);
    }

    for (const o of rows) {
      o.items = byOrder.get(o.id_pedido) || [];
      o.estaciones = [...new Set(o.items.map((i) => i.estacion).filter(Boolean))];
    }
  }

  res.json({ success: true, count: rows.length, orders: rows });
}));

router.post('/orders', asyncRoute(async (req, res) => {
  await ensureCartaMarketingSchema(pool);
  const d = req.body || {};
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) {
    return res.status(400).json({ success: false, message: 'El pedido debe contener al menos un producto' });
  }

  const tokenPayload = verifyToken(extractBearerToken(req));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tableNum = Number(d.table_num ?? d.numero_mesa ?? 4);
    const tr = await client.query(
      'SELECT id_mesa, estado, monto_acumulado, mozo_asignado FROM mesas WHERE numero_mesa = $1 LIMIT 1',
      [tableNum]
    );
    if (!tr.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Mesa no encontrada' });
    }

    const mesaRow = tr.rows[0];
    let orderingUser = null;
    const requestedUid = Number(d.id_usuario || tokenPayload?.uid || 0);
    if (requestedUid > 0) {
      const ur = await client.query('SELECT id_usuario, nombre, rol FROM usuarios WHERE id_usuario = $1 LIMIT 1', [requestedUid]);
      orderingUser = ur.rows[0] || null;
    } else if (d.waiter_name) {
      const wr = await client.query(
        `SELECT id_usuario, nombre, rol FROM usuarios WHERE LOWER(nombre) LIKE LOWER($1) AND is_deleted = FALSE LIMIT 1`,
        [`%${String(d.waiter_name).trim()}%`]
      );
      orderingUser = wr.rows[0] || null;
    }

    const cr = await client.query('SELECT COALESCE(MAX(numero_comanda), 1050) + 1 AS next FROM pedidos');
    const comanda = Number(cr.rows[0].next);

    const clientLabel = String(
      d.client_name || (orderingUser?.rol === 'cliente' ? orderingUser.nombre : 'Comensal')
    ).trim() || 'Comensal';
    const orderComments = String(d.comentarios ?? d.comments ?? d.notas ?? '').trim().slice(0, 400);

    const order = await client.query(
      `INSERT INTO pedidos(numero_comanda, id_mesa, id_usuario, nombre_cliente, comentarios, estado)
       VALUES($1, $2, $3, $4, $5, 'pendiente') RETURNING id_pedido, numero_comanda, estado, comentarios`,
      [comanda, mesaRow.id_mesa, orderingUser?.id_usuario || null, clientLabel, orderComments || null]
    );

    // Resolver precio promocional vigente del Platillo Especial del Día y de Complementos (-20%)
    const catalogRows = await fetchAvailableCatalogProducts(client);
    const todaySpecial = buildDailySpecials(catalogRows, getPeruDateString()).special_of_day;
    const hasNonComplementItem = items.some((it) => !Boolean(it.es_complemento || it.is_complement));

    let total = 0;
    for (const item of items) {
      const pid = Number(item.id_producto ?? item.id);
      const qty = Number(item.cantidad ?? item.quantity ?? item.qty);
      const pr = await client.query('SELECT precio, id_categoria FROM productos WHERE id_producto = $1 AND disponible = TRUE', [pid]);
      if (!pr.rows[0] || !Number.isInteger(qty) || qty <= 0 || qty > 500) {
        const invalidErr = new Error(`Producto o cantidad inválida: ${pid}`);
        invalidErr.status = 422;
        invalidErr.expose = true;
        throw invalidErr;
      }
      const basePrice = Number(pr.rows[0].precio);
      const catId = Number(pr.rows[0].id_categoria);
      const isComplementRequested = Boolean(item.es_complemento || item.is_complement);

      let price = basePrice;
      if (todaySpecial && Number(todaySpecial.id) === pid) {
        price = Number(todaySpecial.special_price);
      } else if (isComplementRequested && hasNonComplementItem && COMPLEMENT_CATEGORY_IDS.has(catId)) {
        price = Number((basePrice * (1 - COMPLEMENT_DISCOUNT_PERCENT / 100)).toFixed(2));
      }

      total = Number((total + price * qty).toFixed(2));
      await client.query(
        'INSERT INTO detalle_pedidos(id_pedido, id_producto, cantidad, precio_unitario, observaciones) VALUES($1,$2,$3,$4,$5)',
        [order.rows[0].id_pedido, pid, qty, price, String(item.observaciones ?? item.notes ?? '').slice(0, 250)]
      );
    }

    const isClientOrder = orderingUser?.rol === 'cliente' || (!orderingUser && !d.waiter_name);
    let waiterAssigned = mesaRow.mozo_asignado;
    if (!isClientOrder) {
      waiterAssigned = orderingUser?.nombre || String(d.waiter_name || '').trim() || mesaRow.mozo_asignado || 'Mozo de Turno';
    } else if (!waiterAssigned || waiterAssigned === '-') {
      waiterAssigned = 'Pedido en Carta';
    }

    // Calcular monto acumulado real de todos los pedidos sin pagar de la misma mesa
    const mesaUnpaidRes = await client.query(
      `SELECT COALESCE(SUM(dp.cantidad * dp.precio_unitario), 0) AS total_mesa
       FROM detalle_pedidos dp
       JOIN pedidos p ON p.id_pedido = dp.id_pedido
       WHERE p.id_mesa = $1
         AND p.estado <> 'cancelado'
         AND NOT EXISTS (SELECT 1 FROM ventas v WHERE v.id_pedido = p.id_pedido AND v.estado_pago = 'exitoso')`,
      [mesaRow.id_mesa]
    );
    const nextAmount = Number(Number(mesaUnpaidRes.rows[0]?.total_mesa || total).toFixed(2));

    await client.query(
      `UPDATE mesas
       SET estado = 'ocupada',
           tiempo_min = CASE WHEN tiempo_min > 0 THEN tiempo_min ELSE 15 END,
           mozo_asignado = $1,
           monto_acumulado = $2
       WHERE id_mesa = $3`,
      [waiterAssigned, nextAmount, mesaRow.id_mesa]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: 'Comanda creada con éxito en PostgreSQL',
      order: { ...order.rows[0], numero_mesa: tableNum, total }
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

router.patch('/orders/:id/status', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de comanda inválido' });
  }
  const raw = String(req.body?.estado ?? req.body?.status ?? '').toLowerCase().trim();
  const map = {
    nuevos: 'pendiente',
    pendiente: 'pendiente',
    cocinando: 'en_cocina',
    en_cocina: 'en_cocina',
    listos: 'listo',
    listo: 'listo',
    entregado: 'entregado',
    cancelado: 'cancelado'
  };

  if (!map[raw]) {
    return res.status(422).json({ success: false, message: `Estado '${raw}' no válido` });
  }

  let q = await pool.query('UPDATE pedidos SET estado = $1 WHERE id_pedido = $2 RETURNING id_pedido, numero_comanda, estado', [map[raw], id]);
  if (!q.rows[0]) {
    q = await pool.query('UPDATE pedidos SET estado = $1 WHERE numero_comanda = $2 RETURNING id_pedido, numero_comanda, estado', [map[raw], id]);
  }
  if (!q.rows[0]) {
    return res.status(404).json({ success: false, message: 'Comanda no encontrada en la base de datos' });
  }
  res.json({ success: true, message: 'Estado de comanda actualizado en PostgreSQL', order: q.rows[0] });
}));

// ============================================================================
// 7. DASHBOARD EJECUTIVO (VISTA INTEGRAL DE TODOS LOS MÓDULOS PARA ADMIN)
// ============================================================================
router.get('/dashboard', asyncRoute(async (req, res) => {
  const [sales, active, pendingBills, tables, staffStats, monitor, info] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(monto_total), 0) AS total FROM ventas WHERE estado_pago = 'exitoso' AND fecha_pago::date = CURRENT_DATE`),
    pool.query(`SELECT COUNT(*) AS total FROM pedidos WHERE estado IN ('pendiente', 'en_cocina', 'listo')`),
    pool.query(`SELECT COUNT(DISTINCT p.id_mesa) AS total FROM pedidos p WHERE p.estado <> 'cancelado' AND NOT EXISTS(SELECT 1 FROM ventas v WHERE v.id_pedido = p.id_pedido AND v.estado_pago = 'exitoso')`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE estado IN ('ocupada', 'cuenta')) AS ocupadas, COUNT(*) AS total FROM mesas WHERE is_deleted = FALSE`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE (is_deleted = FALSE OR is_deleted IS NULL) AND estado = 'Activo') AS activos,
                       COUNT(*) FILTER (WHERE (is_deleted = FALSE OR is_deleted IS NULL) AND LOWER(COALESCE(nacionalidad, 'peruana')) NOT IN ('peruana', 'peru', 'perú')) AS extranjeros
                FROM usuarios`),
    pool.query(
      `SELECT p.id_pedido, p.numero_comanda, m.numero_mesa,
              CASE WHEN u.rol = 'cliente' THEN 'Pedido en Carta' ELSE COALESCE(u.nombre, 'Mozo de Turno') END AS mozo_nombre,
              p.nombre_cliente, COALESCE(p.comentarios, '') AS comentarios,
              COALESCE((SELECT SUM(dp.cantidad * dp.precio_unitario) FROM detalle_pedidos dp WHERE dp.id_pedido = p.id_pedido), 0) AS total,
              p.estado,
              CASE
                WHEN p.estado = 'listo' THEN 'Listo para entregar'
                WHEN p.estado = 'en_cocina' THEN 'En cocina'
                WHEN p.estado = 'pendiente' THEN 'Pendiente'
                ELSE p.estado::text
              END AS badge_text,
              TO_CHAR(p.fecha_hora, 'HH12:MI AM') AS hora
       FROM pedidos p
       LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
       LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
       WHERE p.estado IN ('en_cocina', 'listo', 'pendiente')
       ORDER BY p.id_pedido DESC LIMIT 10`
    ),
    pool.query('SELECT nombre, slogan, ruc, direccion, telefono FROM restaurante_info WHERE id_restaurante = 1')
  ]);

  const v = Number(sales.rows[0].total || 0);
  const o = Number(active.rows[0].total || 0);
  const pb = Number(pendingBills.rows[0].total || 0);
  const occ = Number(tables.rows[0].ocupadas || 0);
  const tot = Number(tables.rows[0].total || 0);
  const actStaff = Number(staffStats.rows[0].activos || 0);
  const extStaff = Number(staffStats.rows[0].extranjeros || 0);

  res.json({
    success: true,
    database: 'PostgreSQL 18 (Melidan_db)',
    restaurante: info.rows[0] || {},
    metrics: {
      ventas_hoy: v,
      ventas_hoy_formato: `S/ ${v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      pedidos_activos: o,
      cuentas_pendientes: pb,
      mesas_ocupadas: occ,
      total_mesas: tot,
      mesas_texto: `${occ} / ${tot}`,
      personal_activo: actStaff,
      extranjeros_activos: extStaff,
      tiempo_promedio: '14 min'
    },
    salon_monitor: monitor.rows
  });
}));

// ============================================================================
// 8. CAJA, VENTAS, COMPROBANTES ELECTRÓNICOS (YAPE / PLIN / PDF / PROMO)
// ============================================================================
const RECEIPT_BASE_SELECT = `
  SELECT c.id_comprobante, c.id_venta, c.tipo_comprobante, c.numero_comprobante, c.fecha_emision,
         c.documento_cliente, c.nombre_cliente AS comprobante_cliente, c.cajero_nombre,
         c.codigo_promo, c.descripcion_promo,
         v.id_pedido, v.metodo_pago, v.canal_pago, v.referencia_pago, v.monto_total, v.estado_pago,
         p.numero_comanda, p.nombre_cliente, COALESCE(p.comentarios, '') AS comentarios,
         COALESCE(m.numero_mesa, 1) AS numero_mesa,
         COALESCE(u.nombre, 'Caja Principal') AS atendido_por,
         TO_CHAR(c.fecha_emision, 'DD/MM/YYYY HH12:MI:SS AM') AS fecha_formato
  FROM comprobantes c
  JOIN ventas v ON c.id_venta = v.id_venta
  JOIN pedidos p ON v.id_pedido = p.id_pedido
  LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
  LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
`;

async function fetchFullReceiptById(lookupId, byField = 'comprobante') {
  const rest = (await pool.query('SELECT nombre, slogan, ruc, direccion, telefono FROM restaurante_info WHERE id_restaurante = 1')).rows[0] || {};
  let whereSql = 'WHERE c.id_comprobante = $1';
  if (byField === 'pedido') whereSql = 'WHERE v.id_pedido = $1';
  if (byField === 'venta') whereSql = 'WHERE v.id_venta = $1';

  const rRes = await pool.query(`${RECEIPT_BASE_SELECT} ${whereSql} ORDER BY c.id_comprobante DESC LIMIT 1`, [lookupId]);
  const row = rRes.rows[0];
  if (!row) return null;

  const itemsRes = await pool.query(
    `SELECT d.id_detalle, d.cantidad, d.precio_unitario, (d.cantidad * d.precio_unitario) AS subtotal,
            pr.nombre AS nombre_plato, d.observaciones
     FROM detalle_pedidos d
     JOIN productos pr ON d.id_producto = pr.id_producto
     WHERE d.id_pedido = $1 ORDER BY d.id_detalle`,
    [row.id_pedido]
  );

  return enrichReceiptObject(row, itemsRes.rows, rest);
}

router.get('/billing/recent', asyncRoute(async (req, res) => {
  const limit = Math.min(30, Math.max(1, Number(req.query.limit || 12)));
  const [restRes, rowsRes] = await Promise.all([
    pool.query('SELECT nombre, slogan, ruc, direccion, telefono FROM restaurante_info WHERE id_restaurante = 1'),
    pool.query(`${RECEIPT_BASE_SELECT} WHERE v.estado_pago = 'exitoso' ORDER BY c.fecha_emision DESC, c.id_comprobante DESC LIMIT $1`, [limit])
  ]);
  const rest = restRes.rows[0] || {};
  const rows = rowsRes.rows;

  let byOrder = new Map();
  if (rows.length > 0) {
    const orderIds = rows.map((r) => r.id_pedido);
    const itemsRes = await pool.query(
      `SELECT d.id_detalle, d.id_pedido, d.cantidad, d.precio_unitario, (d.cantidad * d.precio_unitario) AS subtotal,
              pr.nombre AS nombre_plato, d.observaciones
       FROM detalle_pedidos d
       JOIN productos pr ON d.id_producto = pr.id_producto
       WHERE d.id_pedido = ANY($1::int[]) ORDER BY d.id_detalle`,
      [orderIds]
    );
    for (const it of itemsRes.rows) {
      if (!byOrder.has(it.id_pedido)) byOrder.set(it.id_pedido, []);
      byOrder.get(it.id_pedido).push(it);
    }
  }

  const receipts = rows.map((r) => enrichReceiptObject(r, byOrder.get(r.id_pedido) || [], rest));
  res.json({ success: true, count: receipts.length, receipts });
}));

router.get('/billing/:id/pdf', asyncRoute(async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ success: false, message: 'ID de comprobante inválido' });

  let receipt = await fetchFullReceiptById(id, 'comprobante');
  if (!receipt) receipt = await fetchFullReceiptById(id, 'pedido');
  if (!receipt) return res.status(404).json({ success: false, message: 'Comprobante no encontrado para descargar' });

  const pdfBuffer = generateReceiptPdf(receipt);
  const prefix = receipt.tipo_comprobante === 'factura' ? 'Factura' : 'Boleta';
  const safeNum = String(receipt.numero_comprobante || id).replace(/[^A-Za-z0-9_-]/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${prefix}_${safeNum}.pdf"`);
  res.setHeader('Content-Length', pdfBuffer.length);
  res.send(pdfBuffer);
}));

router.get('/billing', asyncRoute(async (req, res) => {
  const oid = Number(req.query.id_pedido || 0);
  const cid = Number(req.query.id_comprobante || 0);
  const rest = (await pool.query('SELECT nombre, slogan, ruc, direccion, telefono FROM restaurante_info WHERE id_restaurante = 1')).rows[0] || {};

  let receipt = null;
  if (cid) {
    receipt = await fetchFullReceiptById(cid, 'comprobante');
  } else if (oid) {
    receipt = await fetchFullReceiptById(oid, 'pedido');
  } else {
    const latest = (await pool.query('SELECT id_comprobante FROM comprobantes ORDER BY id_comprobante DESC LIMIT 1')).rows[0];
    if (latest) receipt = await fetchFullReceiptById(latest.id_comprobante, 'comprobante');
  }

  if (!receipt) {
    if (oid) {
      const order = (await pool.query(
        `SELECT p.id_pedido, p.numero_comanda, p.nombre_cliente, COALESCE(p.comentarios, '') AS comentarios, m.numero_mesa,
                COALESCE((SELECT SUM(dp.cantidad * dp.precio_unitario) FROM detalle_pedidos dp WHERE dp.id_pedido = p.id_pedido), 0) AS total
         FROM pedidos p LEFT JOIN mesas m ON p.id_mesa = m.id_mesa WHERE p.id_pedido = $1`,
        [oid]
      )).rows[0];
      if (order) return res.json({ success: true, has_receipt: false, restaurante: rest, order });
    }
    return res.status(404).json({ success: false, message: 'Comprobante no encontrado' });
  }

  res.json({ success: true, receipt });
}));

router.post('/billing', asyncRoute(async (req, res) => {
  const oid = Number(req.body?.id_pedido || 0);
  if (!oid) return res.status(400).json({ success: false, message: 'ID de pedido requerido' });

  const resolvedPay = resolvePaymentChannel(req.body?.metodo_pago, req.body?.canal_pago);
  const type = ['boleta', 'factura'].includes(req.body?.tipo_comprobante)
    ? req.body.tipo_comprobante
    : 'boleta';
  const refPago = String(req.body?.referencia_pago || '').trim().slice(0, 80);
  const docCliente = String(req.body?.documento_cliente || (type === 'factura' ? '20601234567' : '74589632')).trim().slice(0, 20);
  const nombreClienteInput = String(req.body?.nombre_cliente || '').trim().slice(0, 120);
  const tokenPayload = verifyToken(extractBearerToken(req));
  const cajeroNombre = String(req.body?.cajero_nombre || tokenPayload?.name || 'Caja Principal').trim().slice(0, 120);

  const client = await pool.connect();
  let compId = 0;
  try {
    await client.query('BEGIN');
    const orderInfoRes = await client.query(
      `SELECT id_pedido, id_mesa, numero_comanda, nombre_cliente, COALESCE(comentarios, '') AS comentarios
       FROM pedidos WHERE id_pedido = $1 LIMIT 1`,
      [oid]
    );
    if (!orderInfoRes.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Pedido no encontrado para facturar' });
    }

    const baseOrder = orderInfoRes.rows[0];
    // Bloquear fila de la mesa dentro de la transacción para serializar cobros simultáneos y evitar boletas duplicadas
    if (baseOrder.id_mesa) {
      await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [baseOrder.id_mesa]);
    }
    const alreadyPaidRes = await client.query(
      `SELECT id_venta FROM ventas WHERE id_pedido = $1 AND estado_pago = 'exitoso' LIMIT 1`,
      [oid]
    );

    let targetOrderId = oid;
    let consolidatedOrdersCount = 1;
    let comandasUnificadas = [baseOrder.numero_comanda];
    let resolvedDefaultClient = baseOrder.nombre_cliente || 'Cliente General';

    // Si aún no está pagado, consolidar TODOS los pedidos sin pagar de la MISMA MESA en UNA SOLA BOLETA
    if (!alreadyPaidRes.rows[0]) {
      const unpaidMesaOrders = await client.query(
        `SELECT p.id_pedido, p.numero_comanda, p.nombre_cliente, COALESCE(p.comentarios, '') AS comentarios
         FROM pedidos p
         WHERE p.id_mesa = $1
           AND p.estado <> 'cancelado'
           AND NOT EXISTS (SELECT 1 FROM ventas v WHERE v.id_pedido = p.id_pedido AND v.estado_pago = 'exitoso')
         ORDER BY p.id_pedido ASC`,
        [baseOrder.id_mesa]
      );

      if (unpaidMesaOrders.rows.length > 0) {
        const primary = unpaidMesaOrders.rows[0];
        targetOrderId = primary.id_pedido;
        consolidatedOrdersCount = unpaidMesaOrders.rows.length;
        comandasUnificadas = unpaidMesaOrders.rows.map((r) => r.numero_comanda);

        const bestName = unpaidMesaOrders.rows
          .map((r) => String(r.nombre_cliente || '').trim())
          .find((n) => n && n.toLowerCase() !== 'comensal');
        if (bestName) resolvedDefaultClient = bestName;

        const secondaryIds = unpaidMesaOrders.rows.slice(1).map((r) => r.id_pedido);
        if (secondaryIds.length > 0) {
          const allOrderIds = unpaidMesaOrders.rows.map((r) => r.id_pedido);

          // Unificar líneas idénticas de detalle_pedidos en el pedido principal (una sola boleta limpia)
          const allDetailsRes = await client.query(
            `SELECT id_producto, cantidad, precio_unitario, COALESCE(observaciones, '') AS observaciones
             FROM detalle_pedidos
             WHERE id_pedido = ANY($1::int[])
             ORDER BY id_detalle ASC`,
            [allOrderIds]
          );

          const mergedLines = new Map();
          for (const row of allDetailsRes.rows) {
            const obsClean = String(row.observaciones || '').trim();
            const key = `${row.id_producto}|${Number(row.precio_unitario).toFixed(2)}|${obsClean.toLowerCase()}`;
            if (mergedLines.has(key)) {
              mergedLines.get(key).cantidad += Number(row.cantidad || 0);
            } else {
              mergedLines.set(key, {
                id_producto: Number(row.id_producto),
                cantidad: Number(row.cantidad || 0),
                precio_unitario: Number(row.precio_unitario),
                observaciones: obsClean
              });
            }
          }

          await client.query('DELETE FROM detalle_pedidos WHERE id_pedido = ANY($1::int[])', [allOrderIds]);
          for (const line of mergedLines.values()) {
            await client.query(
              `INSERT INTO detalle_pedidos(id_pedido, id_producto, cantidad, precio_unitario, observaciones)
               VALUES($1, $2, $3, $4, $5)`,
              [targetOrderId, line.id_producto, line.cantidad, line.precio_unitario, line.observaciones]
            );
          }

          const mergedComments = [...new Set(
            unpaidMesaOrders.rows.map((r) => String(r.comentarios || '').trim()).filter(Boolean)
          )].join(' | ').slice(0, 400);

          await client.query(
            `UPDATE pedidos SET comentarios = $1, nombre_cliente = $2 WHERE id_pedido = $3`,
            [mergedComments || null, nombreClienteInput || resolvedDefaultClient, targetOrderId]
          );

          // Eliminar posibles intentos fallidos/pendientes de venta en los pedidos secundarios y limpiar pedidos absorbidos
          await client.query(`DELETE FROM ventas WHERE id_pedido = ANY($1::int[]) AND estado_pago <> 'exitoso'`, [secondaryIds]);
          await client.query(`DELETE FROM pedidos WHERE id_pedido = ANY($1::int[])`, [secondaryIds]);
        }
      }
    }

    const finalClientName = nombreClienteInput || resolvedDefaultClient || 'Cliente General';
    const totalR = await client.query('SELECT COALESCE(SUM(cantidad * precio_unitario), 0) AS total FROM detalle_pedidos WHERE id_pedido = $1', [targetOrderId]);
    const total = Number(Number(totalR.rows[0].total || 0).toFixed(2));

    const sale = await client.query(
      `INSERT INTO ventas(id_pedido, metodo_pago, canal_pago, referencia_pago, monto_total, estado_pago)
       VALUES($1, $2, $3, $4, $5, 'exitoso')
       ON CONFLICT(id_pedido) DO UPDATE
       SET metodo_pago = EXCLUDED.metodo_pago,
           canal_pago = EXCLUDED.canal_pago,
           referencia_pago = EXCLUDED.referencia_pago,
           monto_total = EXCLUDED.monto_total,
           estado_pago = 'exitoso',
           fecha_pago = CURRENT_TIMESTAMP
       RETURNING id_venta`,
      [targetOrderId, resolvedPay.dbMethod, resolvedPay.label, refPago || null, total]
    );

    const num = await getNextVoucherNumber(client, type);
    const promo = buildNextPurchasePromo(num, total);

    const comp = await client.query(
      `INSERT INTO comprobantes(id_venta, tipo_comprobante, numero_comprobante, documento_cliente, nombre_cliente, cajero_nombre, codigo_promo, descripcion_promo)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(id_venta) DO UPDATE
       SET tipo_comprobante = EXCLUDED.tipo_comprobante,
           numero_comprobante = EXCLUDED.numero_comprobante,
           documento_cliente = EXCLUDED.documento_cliente,
           nombre_cliente = EXCLUDED.nombre_cliente,
           cajero_nombre = EXCLUDED.cajero_nombre,
           codigo_promo = EXCLUDED.codigo_promo,
           descripcion_promo = EXCLUDED.descripcion_promo,
           fecha_emision = CURRENT_TIMESTAMP
       RETURNING id_comprobante, numero_comprobante, TO_CHAR(fecha_emision, 'DD/MM/YYYY HH12:MI:SS AM') AS fecha_formato`,
      [sale.rows[0].id_venta, type, num, docCliente, finalClientName, cajeroNombre, promo.codigo_promo, promo.descripcion_promo]
    );
    compId = comp.rows[0].id_comprobante;

    await client.query(
      `UPDATE mesas
       SET estado = 'por_limpiar', tiempo_min = 0, mozo_asignado = '-', monto_acumulado = 0
       WHERE id_mesa = $1`,
      [baseOrder.id_mesa]
    );
    await client.query(`UPDATE pedidos SET estado = 'entregado' WHERE id_pedido = $1`, [targetOrderId]);
    await client.query('COMMIT');

    const fullReceipt = await fetchFullReceiptById(compId, 'comprobante');
    res.status(201).json({
      success: true,
      message: consolidatedOrdersCount > 1
        ? `Pago registrado en 1 sola boleta consolidando ${consolidatedOrdersCount} pedidos de la mesa`
        : 'Pago registrado y comprobante emitido con éxito en PostgreSQL',
      id_pedido: targetOrderId,
      consolidated_orders: consolidatedOrdersCount,
      comandas_unificadas: comandasUnificadas,
      id_venta: sale.rows[0].id_venta,
      id_comprobante: compId,
      numero_comprobante: comp.rows[0].numero_comprobante,
      fecha_formato: comp.rows[0].fecha_formato,
      monto_total: total,
      canal_pago: resolvedPay.label,
      pdf_url: `/api/billing/${compId}/pdf`,
      receipt: fullReceipt
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// ============================================================================
// 9. HISTORIAL Y REGISTRO DE COMPRAS ANTERIORES (EXCLUSIVO PARA ADMIN)
// ============================================================================
router.get('/purchases-history', requireAdmin, asyncRoute(async (req, res) => {
  const { search = '', metodo_pago = '', tipo_comprobante = '' } = req.query;
  const cond = [`v.estado_pago = 'exitoso'`];
  const params = [];

  if (search) {
    params.push(`%${String(search).toLowerCase().trim()}%`);
    cond.push(
      `(LOWER(COALESCE(p.nombre_cliente, '')) LIKE $${params.length}
        OR LOWER(COALESCE(c.numero_comprobante, '')) LIKE $${params.length}
        OR CAST(p.numero_comanda AS TEXT) LIKE $${params.length}
        OR LOWER(COALESCE(u.nombre, '')) LIKE $${params.length})`
    );
  }
  if (metodo_pago && metodo_pago !== 'todos') {
    params.push(String(metodo_pago).trim());
    cond.push(`v.metodo_pago = $${params.length}`);
  }
  if (tipo_comprobante && tipo_comprobante !== 'todos') {
    params.push(String(tipo_comprobante).trim());
    cond.push(`c.tipo_comprobante = $${params.length}`);
  }

  const [kpiRes, rowsRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total_compras,
         COALESCE(SUM(monto_total), 0)::numeric(12,2) AS monto_acumulado,
         COALESCE(AVG(monto_total), 0)::numeric(10,2) AS ticket_promedio,
         COUNT(*) FILTER (WHERE fecha_pago::date = CURRENT_DATE)::int AS compras_hoy,
         COALESCE(SUM(monto_total) FILTER (WHERE fecha_pago::date = CURRENT_DATE), 0)::numeric(12,2) AS monto_hoy
       FROM ventas
       WHERE estado_pago = 'exitoso'`
    ),
    pool.query(
      `SELECT
         v.id_venta,
         v.id_pedido,
         v.metodo_pago,
         COALESCE(v.canal_pago, CASE WHEN v.metodo_pago = 'efectivo_caja' THEN 'Efectivo' WHEN v.metodo_pago = 'tarjeta_caja' THEN 'Tarjeta POS' ELSE 'Yape' END) AS canal_pago,
         v.monto_total,
         v.estado_pago,
         v.fecha_pago,
         TO_CHAR(v.fecha_pago, 'DD/MM/YYYY HH12:MI AM') AS fecha_formato,
         p.numero_comanda,
         COALESCE(c.nombre_cliente, p.nombre_cliente) AS nombre_cliente,
         p.estado AS estado_pedido,
         COALESCE(m.numero_mesa, 1) AS numero_mesa,
         CASE WHEN u.rol = 'cliente' THEN 'Pedido en Carta' ELSE COALESCE(u.nombre, 'Caja / Gerencia') END AS atendido_por,
         c.id_comprobante,
         COALESCE(c.tipo_comprobante::text, 'boleta') AS tipo_comprobante,
         COALESCE(c.numero_comprobante, 'SIN-COMP') AS numero_comprobante,
         COALESCE(c.codigo_promo, '') AS codigo_promo
       FROM ventas v
       JOIN pedidos p ON v.id_pedido = p.id_pedido
       LEFT JOIN comprobantes c ON c.id_venta = v.id_venta
       LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
       LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
       WHERE ${cond.join(' AND ')}
       ORDER BY v.fecha_pago DESC, v.id_venta DESC`,
      params
    )
  ]);

  const history = rowsRes.rows;
  if (history.length > 0) {
    const orderIds = history.map((r) => r.id_pedido);
    const itemsRes = await pool.query(
      `SELECT d.id_pedido, d.cantidad, d.precio_unitario,
              (d.cantidad * d.precio_unitario)::numeric(10,2) AS subtotal,
              pr.nombre AS nombre_plato, d.observaciones
       FROM detalle_pedidos d
       JOIN productos pr ON d.id_producto = pr.id_producto
       WHERE d.id_pedido = ANY($1::int[])
       ORDER BY d.id_detalle`,
      [orderIds]
    );
    const byOrder = new Map();
    for (const item of itemsRes.rows) {
      if (!byOrder.has(item.id_pedido)) byOrder.set(item.id_pedido, []);
      byOrder.get(item.id_pedido).push(item);
    }
    for (const row of history) {
      row.items = byOrder.get(row.id_pedido) || [];
    }
  }

  const k = kpiRes.rows[0] || {};
  res.json({
    success: true,
    summary: {
      total_compras: Number(k.total_compras || 0),
      monto_acumulado: Number(k.monto_acumulado || 0),
      ticket_promedio: Number(k.ticket_promedio || 0),
      compras_hoy: Number(k.compras_hoy || 0),
      monto_hoy: Number(k.monto_hoy || 0)
    },
    count: history.length,
    history
  });
}));

router.post('/purchases-history', requireAdmin, asyncRoute(async (req, res) => {
  const d = req.body || {};
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) {
    return res.status(422).json({ success: false, message: 'Agrega al menos un producto para registrar la compra.' });
  }

  const resolvedPay = resolvePaymentChannel(d.metodo_pago, d.canal_pago);
  const voucherType = ['boleta', 'factura'].includes(d.tipo_comprobante)
    ? d.tipo_comprobante
    : 'boleta';
  const tableNum = Number(d.numero_mesa || 1);
  const clientName = String(d.nombre_cliente || 'Comensal Histórico').trim() || 'Comensal Histórico';

  let purchaseDate = new Date();
  if (d.fecha_compra) {
    const parsed = new Date(d.fecha_compra);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(422).json({ success: false, message: 'La fecha de compra ingresada no es válida.' });
    }
    purchaseDate = parsed;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tr = await client.query('SELECT id_mesa FROM mesas WHERE numero_mesa = $1 LIMIT 1', [tableNum]);
    const idMesa = tr.rows[0]?.id_mesa || (await client.query('SELECT id_mesa FROM mesas ORDER BY numero_mesa LIMIT 1')).rows[0].id_mesa;

    const cr = await client.query('SELECT COALESCE(MAX(numero_comanda), 1050) + 1 AS next FROM pedidos');
    const comanda = Number(cr.rows[0].next);

    const pRes = await client.query(
      `INSERT INTO pedidos(numero_comanda, id_mesa, id_usuario, nombre_cliente, estado, fecha_hora)
       VALUES($1, $2, $3, $4, 'entregado', $5)
       RETURNING id_pedido, numero_comanda`,
      [comanda, idMesa, req.authUser?.uid || 1, clientName, purchaseDate.toISOString()]
    );
    const idPedido = pRes.rows[0].id_pedido;

    let total = 0;
    for (const item of items) {
      const pid = Number(item.id_producto ?? item.id);
      const qty = Number(item.cantidad ?? item.quantity ?? 1);
      const pr = await client.query('SELECT precio FROM productos WHERE id_producto = $1', [pid]);
      if (!pr.rows[0] || !Number.isInteger(qty) || qty <= 0) {
        const invalidErr = new Error('Producto o cantidad inválida en el registro de compra.');
        invalidErr.status = 422;
        invalidErr.expose = true;
        throw invalidErr;
      }
      const unitPrice = Number(pr.rows[0].precio);
      total = Number((total + unitPrice * qty).toFixed(2));
      await client.query(
        `INSERT INTO detalle_pedidos(id_pedido, id_producto, cantidad, precio_unitario, observaciones)
         VALUES($1, $2, $3, $4, $5)`,
        [idPedido, pid, qty, unitPrice, String(item.observaciones || '').slice(0, 250)]
      );
    }

    const vRes = await client.query(
      `INSERT INTO ventas(id_pedido, metodo_pago, canal_pago, monto_total, estado_pago, fecha_pago)
       VALUES($1, $2, $3, $4, 'exitoso', $5)
       RETURNING id_venta`,
      [idPedido, resolvedPay.dbMethod, resolvedPay.label, total, purchaseDate.toISOString()]
    );

    const voucherNumber = await getNextVoucherNumber(client, voucherType);
    const promo = buildNextPurchasePromo(voucherNumber, total);
    const cRes = await client.query(
      `INSERT INTO comprobantes(id_venta, tipo_comprobante, numero_comprobante, nombre_cliente, cajero_nombre, codigo_promo, descripcion_promo, fecha_emision)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id_comprobante, numero_comprobante, TO_CHAR(fecha_emision, 'DD/MM/YYYY HH12:MI AM') AS fecha_formato`,
      [vRes.rows[0].id_venta, voucherType, voucherNumber, clientName, req.authUser?.name || 'Administración', promo.codigo_promo, promo.descripcion_promo, purchaseDate.toISOString()]
    );

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: `Compra histórica registrada con comprobante ${cRes.rows[0].numero_comprobante}`,
      purchase: {
        id_venta: vRes.rows[0].id_venta,
        id_pedido: idPedido,
        numero_comanda: comanda,
        id_comprobante: cRes.rows[0].id_comprobante,
        numero_comprobante: cRes.rows[0].numero_comprobante,
        fecha_formato: cRes.rows[0].fecha_formato,
        monto_total: Number(total.toFixed(2))
      }
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

// ============================================================================
// 10. REPORTE EXCEL DETALLADO DE VENTAS (.XLSX CON TABLAS, BARRAS Y PASTEL)
// ============================================================================
router.get('/reports/sales-excel', requireAdmin, asyncRoute(async (req, res) => {
  const [restRes, salesRes, itemsRes] = await Promise.all([
    pool.query('SELECT nombre, slogan, ruc, direccion, telefono FROM restaurante_info WHERE id_restaurante = 1'),
    pool.query(
      `SELECT
         v.id_venta,
         v.id_pedido,
         v.metodo_pago,
         COALESCE(v.canal_pago, CASE WHEN v.metodo_pago = 'efectivo_caja' THEN 'Efectivo' WHEN v.metodo_pago = 'tarjeta_caja' THEN 'Tarjeta POS' ELSE 'Yape' END) AS canal_pago,
         COALESCE(v.referencia_pago, '') AS referencia_pago,
         v.monto_total,
         v.fecha_pago,
         TO_CHAR(v.fecha_pago, 'DD/MM/YYYY HH12:MI AM') AS fecha_formato,
         p.numero_comanda,
         COALESCE(c.nombre_cliente, p.nombre_cliente, 'Cliente General') AS nombre_cliente,
         COALESCE(c.documento_cliente, '-') AS documento_cliente,
         COALESCE(c.cajero_nombre, CASE WHEN u.rol = 'cliente' THEN 'Pedido en Carta' ELSE COALESCE(u.nombre, 'Caja Principal') END) AS cajero_nombre,
         COALESCE(m.numero_mesa, 1) AS numero_mesa,
         COALESCE(c.tipo_comprobante::text, 'boleta') AS tipo_comprobante,
         COALESCE(c.numero_comprobante, 'SIN-COMP') AS numero_comprobante,
         COALESCE(c.codigo_promo, '') AS codigo_promo
       FROM ventas v
       JOIN pedidos p ON v.id_pedido = p.id_pedido
       LEFT JOIN comprobantes c ON c.id_venta = v.id_venta
       LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
       LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
       WHERE v.estado_pago = 'exitoso'
       ORDER BY v.fecha_pago DESC, v.id_venta DESC`
    ),
    pool.query(
      `SELECT
         v.id_venta,
         v.id_pedido,
         TO_CHAR(v.fecha_pago, 'DD/MM/YYYY HH12:MI AM') AS fecha_formato,
         COALESCE(c.numero_comprobante, 'SIN-COMP') AS numero_comprobante,
         COALESCE(m.numero_mesa, 1) AS numero_mesa,
         COALESCE(c.nombre_cliente, p.nombre_cliente, 'Cliente General') AS nombre_cliente,
         COALESCE(v.canal_pago, CASE WHEN v.metodo_pago = 'efectivo_caja' THEN 'Efectivo' WHEN v.metodo_pago = 'tarjeta_caja' THEN 'Tarjeta POS' ELSE 'Yape' END) AS canal_pago,
         dp.cantidad,
         dp.precio_unitario,
         (dp.cantidad * dp.precio_unitario)::numeric(10,2) AS subtotal,
         COALESCE(dp.observaciones, '') AS observaciones,
         pr.nombre AS nombre_plato,
         COALESCE(cat.nombre, 'Otros') AS categoria_nombre,
         CASE
           WHEN pr.id_categoria = 3 THEN 'Bar y Bebidas'
           WHEN pr.id_categoria = 4 THEN 'Repostería / Postres'
           WHEN pr.id_categoria = 5 THEN 'Cocina Fría / Entradas'
           WHEN pr.tipo_coccion::text = 'horno_artesanal' THEN 'Horno Artesanal'
           WHEN pr.tipo_coccion::text = 'fuego_lento' THEN 'Horno / Fuego Lento'
           ELSE 'Estación Wok'
         END AS estacion
       FROM ventas v
       JOIN pedidos p ON v.id_pedido = p.id_pedido
       JOIN detalle_pedidos dp ON dp.id_pedido = p.id_pedido
       JOIN productos pr ON pr.id_producto = dp.id_producto
       LEFT JOIN categorias cat ON cat.id_categoria = pr.id_categoria
       LEFT JOIN comprobantes c ON c.id_venta = v.id_venta
       LEFT JOIN mesas m ON p.id_mesa = m.id_mesa
       WHERE v.estado_pago = 'exitoso'
       ORDER BY v.fecha_pago DESC, dp.id_detalle ASC`
    )
  ]);

  const dateStr = getPeruDateString();
  const xlsxBuffer = generateSalesExcel({
    restaurante: restRes.rows[0] || {},
    sales: salesRes.rows,
    itemLines: itemsRes.rows,
    generatedAt: `${formatPeruDayLabel(dateStr)} (${dateStr})`
  });

  const fileName = `Reporte_Ventas_Melidan_${dateStr}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', xlsxBuffer.length);
  res.setHeader('Cache-Control', 'no-store');
  res.send(xlsxBuffer);
}));

module.exports = router;
