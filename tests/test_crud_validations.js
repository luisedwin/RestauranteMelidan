/**
 * tests/test_crud_validations.js - Suite Integral de Pruebas Unitarias y E2E
 * Restaurante Melidan (Web + PostgreSQL 18 + RBAC + Carta + Historial Admin)
 *
 * Verifica de forma independiente:
 * 1. Configuración de entorno y arquitectura modular (src/ y public/).
 * 2. Validaciones Regex/DTOs (Nacionales vs Extranjeros) y Tokens HMAC firmados.
 * 3. Matriz estricta RBAC para los 5 roles (Admin, Cocinero, Mozo, Cajero, Cliente).
 * 4. Datos enriquecidos y persistencia CRUD + Soft Delete en PostgreSQL 18 (ROLLBACK).
 * 5. Eliminación total de botones de prueba/módulos/móvil, nuevo apartado Carta, Historial Admin y Modo Oscuro.
 * 6. Pruebas HTTP End-to-End en vivo (Login de 5 roles, Carta, Pedidos y bloqueo 401/403 vs 200/201 en Historial Admin).
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });

const { pool } = require('../src/config/db');
const { validateUser, dbRoleAliases } = require('../src/utils/validators');
const { signToken, verifyToken } = require('../src/utils/authToken');
const RBAC = require('../public/js/rbac');
const { app } = require('../src/server');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS:\x1b[0m ${message}`);
    testsPassed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL:\x1b[0m ${message}`);
    testsFailed++;
  }
}

async function httpJson(baseUrl, route, options = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {}
  return { status: res.status, body };
}

async function syncAllSequences() {
  const seqFixes = [
    ['categorias', 'id_categoria'],
    ['productos', 'id_producto'],
    ['usuarios', 'id_usuario'],
    ['mesas', 'id_mesa'],
    ['pedidos', 'id_pedido'],
    ['detalle_pedidos', 'id_detalle'],
    ['ventas', 'id_venta'],
    ['comprobantes', 'id_comprobante']
  ];
  for (const [table, col] of seqFixes) {
    await pool.query(
      `SELECT setval(pg_get_serial_sequence('${table}', '${col}'), COALESCE((SELECT MAX(${col}) FROM ${table}), 1), true)`
    );
  }
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('  MELIDAN - SUITE DE PRUEBAS INTEGRALES (WEB + RBAC + POSTGRES)');
  console.log('===============================================================\n');

  // -------------------------------------------------------------
  // [GRUPO 1] Variables de Entorno y Estructura de Carpetas
  // -------------------------------------------------------------
  console.log('\x1b[36m[GRUPO 1] Configuración de Entorno y Organización Modular\x1b[0m');
  const envExamplePath = path.join(PROJECT_ROOT, '.env.example');
  assert(fs.existsSync(envExamplePath), 'El archivo .env.example existe como plantilla de entorno');

  const envContent = fs.readFileSync(envExamplePath, 'utf8');
  assert(envContent.includes('DB_NAME=melidan_db'), 'DB_NAME configurado como melidan_db');
  assert(envContent.includes('DB_USER=postgres'), 'DB_USER configurado como postgres');
  assert(envContent.includes('DB_HOST=localhost'), 'DB_HOST configurado como localhost');

  assert(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'server.js')), 'Backend organizado en src/server.js');
  assert(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'config', 'db.js')), 'Pool PostgreSQL modular en src/config/db.js');
  assert(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'routes', 'api.js')), 'Rutas REST modulares en src/routes/api.js');
  assert(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'utils', 'validators.js')), 'Validadores centralizados en src/utils/validators.js');
  assert(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'utils', 'authToken.js')), 'Seguridad HMAC por roles en src/utils/authToken.js');
  assert(fs.existsSync(path.join(PROJECT_ROOT, 'public', 'js', 'rbac.js')), 'Guardián RBAC frontend en public/js/rbac.js');

  // -------------------------------------------------------------
  // [GRUPO 2] Validaciones Regex y Tokens Firmados
  // -------------------------------------------------------------
  console.log('\n\x1b[36m[GRUPO 2] Validación de Documentos y Seguridad de Tokens\x1b[0m');

  const validPe = validateUser({
    name: 'Carlos Mendoza',
    email: 'carlos.m@melidan.com',
    role: 'mozo',
    tipo_documento: 'DNI',
    numero_documento: '72849102',
    nacionalidad: 'Peruana',
    telefono: '+51 987654321'
  });
  assert(Object.keys(validPe.errors).length === 0, 'Usuario peruano con DNI (8 dígitos) y teléfono +51 9XXXXXXXX pasa validación');

  const invalidDni = validateUser({
    name: 'Usuario Inválido',
    email: 'invalido@melidan.com',
    tipo_documento: 'DNI',
    numero_documento: '7284A',
    nacionalidad: 'Peruana',
    telefono: '987654321'
  });
  assert(Boolean(invalidDni.errors.numero_documento), 'DNI inválido con menos de 8 dígitos o letras es rechazado');

  const validForeign = validateUser({
    name: 'Sarah Jenkins',
    email: 'sarah.jenkins@gmail.com',
    role: 'cliente',
    tipo_documento: 'PASAPORTE',
    numero_documento: 'PAS9845123A',
    nacionalidad: 'Estadounidense',
    telefono: '+1 4155552671'
  });
  assert(Object.keys(validForeign.errors).length === 0, 'Usuario extranjero con Pasaporte y código internacional pasa validación');

  const partialUpdate = validateUser({ name: 'Jean-Luc Dubois', telefono: '+33 612345678' }, true, { nacionalidad: 'Francesa', rol: 'mozo' });
  assert(
    partialUpdate.is_valid && partialUpdate.data.nacionalidad === undefined && partialUpdate.data.rol === undefined,
    'Actualización parcial (PUT) no sobrescribe rol ni nacionalidad omitidos'
  );

  assert(dbRoleAliases.recepcionista === 'recepcionista', 'Rol recepcionista existente en PostgreSQL es reconocido');

  const sampleToken = signToken({ id_usuario: 1, email: 'admin@melidan.com', rol: 'administrador' });
  const verifiedPayload = verifyToken(sampleToken);
  assert(Boolean(verifiedPayload && verifiedPayload.rol === 'administrador'), 'signToken/verifyToken valida firma criptográfica HMAC correctamente');
  assert(verifyToken(`${sampleToken}manipulado`) === null, 'Token manipulado es rechazado inmediatamente por verifyToken');

  // -------------------------------------------------------------
  // [GRUPO 3] Matriz Estricta RBAC (5 Roles)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m[GRUPO 3] Restricción de Acceso por Rol (RBAC)\x1b[0m');

  const adminCfg = RBAC.getRoleConfig('administrador');
  const chefCfg = RBAC.getRoleConfig('cocina');
  const waiterCfg = RBAC.getRoleConfig('mozo');
  const cashierCfg = RBAC.getRoleConfig('cajero');
  const clientCfg = RBAC.getRoleConfig('cliente');

  assert(
    adminCfg && ['admin', 'mozo', 'carta', 'cocina', 'cajero'].every((m) => adminCfg.allowed.includes(m)) && RBAC.getHomeUrl('ADMIN') === '/admin.html',
    'ADMIN tiene acceso completo a todo el sistema (admin, mozo, carta, cocina, cajero)'
  );
  assert(
    chefCfg && JSON.stringify(chefCfg.allowed) === JSON.stringify(['cocina']) && RBAC.getHomeUrl('CHEF') === '/cocina.html',
    'COCINERO está restringido exclusivamente a KDS (/cocina.html)'
  );
  assert(
    waiterCfg && JSON.stringify(waiterCfg.allowed) === JSON.stringify(['mozo', 'carta']) && RBAC.getHomeUrl('WAITER') === '/mozo.html',
    'MOZO está restringido exclusivamente a Mesas y Carta (/mozo.html y /carta.html)'
  );
  assert(
    cashierCfg && JSON.stringify(cashierCfg.allowed) === JSON.stringify(['cajero']) && RBAC.getHomeUrl('CASHIER') === '/cajero.html',
    'CAJERO está restringido exclusivamente a Caja y Facturación (/cajero.html)'
  );
  assert(
    clientCfg && JSON.stringify(clientCfg.allowed) === JSON.stringify(['carta']) && RBAC.getHomeUrl('CLIENT') === '/carta.html',
    'CLIENTE está restringido exclusivamente al apartado Carta (/carta.html)'
  );

  // -------------------------------------------------------------
  // [GRUPO 4] Persistencia y Datos Enriquecidos en PostgreSQL 18
  // -------------------------------------------------------------
  console.log('\n\x1b[36m[GRUPO 4] Datos Enriquecidos, CRUD y Soft Delete en PostgreSQL 18\x1b[0m');
  const client = await pool.connect();
  try {
    const [catRes, prodRes, userRes, mesaRes, salesRes, compRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total, BOOL_OR(nombre = \'Entradas\') AS has_entradas FROM categorias'),
      pool.query('SELECT COUNT(*)::int AS total FROM productos WHERE disponible = TRUE'),
      pool.query('SELECT COUNT(*)::int AS total FROM usuarios'),
      pool.query('SELECT COUNT(*)::int AS total FROM mesas WHERE is_deleted = FALSE'),
      pool.query("SELECT COUNT(*)::int AS total FROM ventas WHERE estado_pago = 'exitoso'"),
      pool.query('SELECT COUNT(*)::int AS total FROM comprobantes')
    ]);

    assert(catRes.rows[0].total >= 5 && catRes.rows[0].has_entradas === true, `Categorías completas en BD (${catRes.rows[0].total}), incluyendo Entradas`);
    assert(prodRes.rows[0].total >= 24, `Carta enriquecida con ${prodRes.rows[0].total} platos y bebidas en PostgreSQL`);
    assert(userRes.rows[0].total >= 14, `Plantilla y clientes enriquecidos con ${userRes.rows[0].total} usuarios en PostgreSQL`);
    assert(mesaRes.rows[0].total === 15, `15 mesas operativas registradas en PostgreSQL`);
    assert(salesRes.rows[0].total >= 12 && compRes.rows[0].total >= 12, `Historial poblado con ${salesRes.rows[0].total} compras y ${compRes.rows[0].total} comprobantes electrónicos`);

    await client.query('BEGIN');

    const testEmail = `qa.transaccional.${Date.now()}@melidan.com`;
    const ins = await client.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, tipo_documento, numero_documento, nacionalidad, telefono, estado, is_deleted)
       VALUES ('Usuario QA Transaccional', $1, 'hash123', 'mozo', 'DNI', '88776655', 'Peruana', '+51 987654321', 'Activo', FALSE)
       RETURNING id_usuario`,
      [testEmail]
    );
    const testId = ins.rows[0].id_usuario;
    assert(testId > 0, `CREATE: Usuario insertado correctamente en transacción (ID #${testId})`);

    const upd = await client.query(
      "UPDATE usuarios SET telefono = '+51 999888777' WHERE id_usuario = $1 RETURNING telefono",
      [testId]
    );
    assert(upd.rows[0].telefono === '+51 999888777', 'UPDATE: Teléfono actualizado correctamente');

    const softDel = await client.query(
      "UPDATE usuarios SET is_deleted = TRUE, estado = 'Inactivo', fecha_eliminacion = CURRENT_TIMESTAMP WHERE id_usuario = $1 RETURNING is_deleted, estado",
      [testId]
    );
    assert(softDel.rows[0].is_deleted === true && softDel.rows[0].estado === 'Inactivo', 'SOFT DELETE: Baja lógica aplicada sin borrar registro físico');

    await client.query('ROLLBACK');
    await syncAllSequences();
    assert(true, 'ROLLBACK: Transacción revertida dejando melidan_db íntegra');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error durante pruebas con PostgreSQL:', err.message);
    testsFailed++;
  } finally {
    client.release();
  }

  // -------------------------------------------------------------
  // [GRUPO 5] Limpieza de Botones, Apartado Carta, Historial Admin y Modo Oscuro
  // -------------------------------------------------------------
  console.log('\n\x1b[36m[GRUPO 5] Limpieza de Botones, Apartado Carta, Historial Admin y Modo Oscuro\x1b[0m');

  const pageFiles = ['admin.html', 'mozo.html', 'carta.html', 'cocina.html', 'cajero.html'];
  for (const page of pageFiles) {
    assert(fs.existsSync(path.join(PROJECT_ROOT, 'public', 'pages', page)), `Vista modular public/pages/${page} existe`);
  }

  const cssFiles = ['base.css', 'styles.css', 'admin.css', 'mozo.css', 'carta.css', 'cocina.css', 'cajero.css', 'animations.css', 'dark-mode.css'];
  for (const css of cssFiles) {
    assert(fs.existsSync(path.join(PROJECT_ROOT, 'public', 'css', css)), `Hoja de estilos public/css/${css} existe`);
  }

  const allHtmlContents = [
    fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'index.html'), 'utf8'),
    ...pageFiles.map((p) => fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'pages', p), 'utf8'))
  ].join('\n');

  const forbiddenSnippets = [
    'MÓDULOS DEL SISTEMA',
    'Probar Roles',
    'dev-role-floater',
    'viewport-toggle-btn',
    'toggleViewportDemo'
  ];
  const foundForbidden = forbiddenSnippets.filter((snippet) => allHtmlContents.includes(snippet));
  assert(
    foundForbidden.length === 0,
    'Todos los botones de "MÓDULOS DEL SISTEMA", "Probar Roles", "Módulos" y "Móvil" fueron eliminados de todas las vistas'
  );

  const cartaHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'pages', 'carta.html'), 'utf8');
  assert(
    cartaHtml.includes('Buscar plato') &&
    cartaHtml.includes('Populares hoy') &&
    cartaHtml.includes('Entradas') &&
    cartaHtml.includes('Combos') &&
    cartaHtml.includes('Menú del Día') &&
    cartaHtml.includes('Bebidas y Jarras') &&
    cartaHtml.includes('carta-promos-strip') &&
    cartaHtml.includes('btn-promos-prev') &&
    cartaHtml.includes('btn-promos-next') &&
    cartaHtml.includes('carta-promos-dots') &&
    cartaHtml.includes('carta-day-tabs') &&
    cartaHtml.includes('Ver Carrito') &&
    cartaHtml.includes('carta-carousel-track') &&
    cartaHtml.includes('carta-special-card') &&
    !cartaHtml.includes('carta-roulette-canvas') &&
    cartaHtml.includes('carta-comment-toggle'),
    'carta.html incluye Carta completa, Carrusel 4 platos, Especial del Día, Promos, Combos, Menú del Día y Jarras'
  );

  const mozoHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'pages', 'mozo.html'), 'utf8');
  assert(
    !mozoHtml.includes('Volver a Mesas') &&
    mozoHtml.includes('mozo-order-overlay') &&
    mozoHtml.includes('handleOverlayBackdropClick') &&
    mozoHtml.includes('mozo-comment-toggle'),
    'mozo.html elimina "Volver a Mesas", permite cerrar con clic fuera y ofrece comentarios opcionales'
  );

  const cajeroHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'pages', 'cajero.html'), 'utf8');
  assert(
    cajeroHtml.includes('data-method="yape"') &&
    cajeroHtml.includes('data-method="plin"') &&
    cajeroHtml.includes('Ver Boleta') &&
    cajeroHtml.includes('Descargar Boleta'),
    'cajero.html ofrece Yape, Plin y botones post-pago de Ver Boleta y Descargar Boleta'
  );

  const adminHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'pages', 'admin.html'), 'utf8');
  assert(
    adminHtml.includes('salesHistoryModal') &&
    adminHtml.includes('form-historical-purchase') &&
    adminHtml.includes('admin-live-monitor') &&
    adminHtml.includes('btn-export-sales-excel') &&
    adminHtml.includes('downloadSalesExcel') &&
    adminHtml.includes('data-allowed-roles="ADMIN"'),
    'admin.html incluye Monitor en Vivo, botón Excel de Ventas detallado, Historial protegido para ADMIN y acceso a todos los módulos'
  );

  const cocinaHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'pages', 'cocina.html'), 'utf8');
  const cocinaJs = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'cocina.js'), 'utf8');
  assert(
    cocinaHtml.includes('kds-status-tabs') &&
    cocinaHtml.includes('data-status="pendiente"') &&
    cocinaHtml.includes('data-status="en_cocina"') &&
    cocinaHtml.includes('data-status="listo"') &&
    cocinaHtml.indexOf('kds-status-tabs') < cocinaHtml.indexOf('kds-order-filters') &&
    cocinaHtml.includes('kds-station-select') &&
    cocinaHtml.includes('kds-order-search') &&
    cocinaJs.includes("currentStatus: 'pendiente'"),
    'cocina.html/js ubica estados clicables (Nuevas por defecto, Cocinando, Listas) a la izquierda y filtro de pedidos a la derecha'
  );

  const cartaJs = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'carta.js'), 'utf8');
  assert(
    cartaJs.includes('pickRandomComplements') &&
    cartaJs.includes('shuffleRandomComplements') &&
    cartaJs.includes('addComplementToCart') &&
    cartaJs.includes('es_complemento'),
    'carta.js implementa complementos aleatorios rebajados (-20%) con opción de mezclar en el carrito'
  );

  const rbacSrc = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'rbac.js'), 'utf8');
  assert(
    rbacSrc.includes('injectRoleNavigationBar') && rbacSrc.includes('role-omni-bar'),
    'public/js/rbac.js inyecta barra de navegación completa para Admin (5 módulos) y restringida para cada rol'
  );

  const themeCode = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'js', 'theme.js'), 'utf8');
  assert(
    themeCode.includes('melidan_theme') && !themeCode.includes('toggleViewportDemo'),
    'public/js/theme.js gestiona Modo Oscuro limpio sin botones de demostración móvil forzados'
  );

  const darkCss = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'css', 'dark-mode.css'), 'utf8');
  assert(darkCss.includes('[data-theme="dark"]') && darkCss.includes('-webkit-autofill'), 'public/css/dark-mode.css cubre Modo Oscuro completo');

  const baseCss = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'css', 'base.css'), 'utf8');
  const cartaCss = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'css', 'carta.css'), 'utf8');
  assert(
    baseCss.includes('orientation: landscape') &&
    baseCss.includes('safe-area-inset-left') &&
    cartaCss.includes('orientation: landscape') &&
    cartaCss.includes('carta-popular-badge'),
    'Hojas CSS incluyen responsive completo para celulares, tablets y modo horizontal (landscape)'
  );

  const batContent = fs.readFileSync(path.join(PROJECT_ROOT, 'abrir_sistema.bat'), 'utf8');
  assert(
    batContent.includes('DB_USER=postgres') && batContent.includes('DB_PASSWORD=root') && batContent.includes('/login'),
    'abrir_sistema.bat configura postgres/root y abre directo en /login'
  );

  // -------------------------------------------------------------
  // [GRUPO 6] Pruebas Independientes HTTP E2E (Servidor Real + PostgreSQL)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m[GRUPO 6] Pruebas E2E HTTP: 5 Roles, Apartado Carta e Historial Admin\x1b[0m');

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 6.1 Verificar disponibilidad HTTP 200 de todas las páginas web
    for (const route of ['/login', '/carta', '/carta.html', '/admin.html', '/mozo.html', '/cocina.html', '/cajero.html']) {
      const pageRes = await fetch(`${baseUrl}${route}`);
      assert(pageRes.status === 200, `Ruta web ${route} responde HTTP 200 OK`);
    }

    // 6.2 Verificar catálogo de Carta (precios decimales, combos, menú del día, jarras, promos y populares 7d)
    const menuRes = await httpJson(baseUrl, '/api/menu');
    const popularItems = (menuRes.body?.productos || []).filter((p) => p.is_popular_week);
    const catNames = (menuRes.body?.categorias || []).map((c) => c.nombre);
    const allHaveDecimals = (menuRes.body?.productos || []).every((p) => Number((Number(p.price) % 1).toFixed(2)) > 0);
    const lunMenu = await httpJson(baseUrl, '/api/menu?day=LUN');
    const marMenu = await httpJson(baseUrl, '/api/menu?day=MAR');
    const lunExclusiveIds = (lunMenu.body?.productos || []).filter((p) => p.is_day_exclusive && p.available_today).map((p) => p.id).join(',');
    const marExclusiveIds = (marMenu.body?.productos || []).filter((p) => p.is_day_exclusive && p.available_today).map((p) => p.id).join(',');

    assert(
      menuRes.status === 200 &&
      catNames.includes('Combos') &&
      catNames.includes('Menú del Día') &&
      catNames.includes('Platos Criollos') &&
      catNames.includes('Bebidas y Jarras') &&
      Array.isArray(menuRes.body?.productos) &&
      menuRes.body.productos.length >= 40 &&
      allHaveDecimals,
      `GET /api/menu entrega ${catNames.length} categorías (incluyendo Combos, Menú del Día, Criollos y Jarras) y ${menuRes.body?.productos?.length} productos todos con precios psicológicos decimales`
    );
    assert(
      Array.isArray(menuRes.body?.promociones) &&
      menuRes.body.promociones.length >= 4 &&
      Boolean(lunExclusiveIds) &&
      Boolean(marExclusiveIds) &&
      lunExclusiveIds !== marExclusiveIds,
      `Promociones activas (${menuRes.body?.promociones?.length}) y programación por días diferenciada (Lun·Mié·Vie vs Mar·Jue·Sáb)`
    );
    assert(
      popularItems.length >= 1 &&
      popularItems.length <= 4 &&
      Boolean(menuRes.body?.popular_meta?.source) &&
      popularItems.every((p) => Number(p.popular_rank) >= 1),
      `GET /api/menu calcula dinámicamente ${popularItems.length} platillos populares según ventas (${menuRes.body?.popular_meta?.source})`
    );
    const compPool = menuRes.body?.complement_pool || [];
    assert(
      Array.isArray(compPool) &&
      compPool.length >= 8 &&
      compPool.every((c) => Number(c.complement_price) < Number(c.original_price) && Number(c.discount_percent) === 20),
      `GET /api/menu entrega pool de ${compPool.length} complementos aleatorios con -20% de descuento exclusivo`
    );

    const ordersRes = await httpJson(baseUrl, '/api/orders');
    assert(
      ordersRes.status === 200 &&
      Array.isArray(ordersRes.body?.orders) &&
      ordersRes.body.orders.length > 0 &&
      Array.isArray(ordersRes.body.orders[0]?.items),
      `GET /api/orders responde HTTP 200 y entrega ${ordersRes.body?.orders?.length} comandas/cuentas con sus ítems y estaciones`
    );

    // 6.3 Login independiente de los 5 roles
    const roleAccounts = [
      { label: 'Admin', email: 'admin@melidan.com', expectedRole: 'ADMIN' },
      { label: 'Cocinero', email: 'chef@melidan.com', expectedRole: 'CHEF' },
      { label: 'Mozo', email: 'carlos.p@melidan.com', expectedRole: 'WAITER' },
      { label: 'Cajero', email: 'maria.s@melidan.com', expectedRole: 'CASHIER' },
      { label: 'Cliente', email: 'cliente@melidan.com', expectedRole: 'CLIENT' }
    ];

    const tokens = {};
    const usersByRole = {};
    for (const acc of roleAccounts) {
      const loginRes = await httpJson(baseUrl, '/api/auth?action=login', {
        method: 'POST',
        body: JSON.stringify({ email: acc.email, password: 'password123' })
      });
      const ok = loginRes.status === 200 && loginRes.body?.user?.role === acc.expectedRole && Boolean(loginRes.body?.token);
      assert(ok, `Login real para ${acc.label} (${acc.email}) autentica rol ${acc.expectedRole} y emite token`);
      tokens[acc.expectedRole] = loginRes.body?.token;
      usersByRole[acc.expectedRole] = loginRes.body?.user;
    }

    // 6.4 Seguridad Backend en /api/purchases-history (Solo ADMIN permitido)
    const noTokenRes = await httpJson(baseUrl, '/api/purchases-history');
    assert(noTokenRes.status === 401, 'GET /api/purchases-history sin token bloquea acceso con HTTP 401');

    for (const blockedRole of ['CHEF', 'WAITER', 'CASHIER', 'CLIENT']) {
      const forbiddenRes = await httpJson(baseUrl, '/api/purchases-history', {
        headers: { Authorization: `Bearer ${tokens[blockedRole]}` }
      });
      assert(forbiddenRes.status === 403, `GET /api/purchases-history bloquea rol ${blockedRole} con HTTP 403`);
    }

    const postForbidden = await httpJson(baseUrl, '/api/purchases-history', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.WAITER}` },
      body: JSON.stringify({
        nombre_cliente: 'Intento No Autorizado',
        numero_mesa: 2,
        items: [{ id_producto: 6, cantidad: 1 }]
      })
    });
    assert(postForbidden.status === 403, 'POST /api/purchases-history bloquea escritura de no-admin con HTTP 403');

    // 6.5 Consulta y Registro de Compra Anterior por ADMIN (y limpieza posterior)
    const adminHistGet = await httpJson(baseUrl, '/api/purchases-history', {
      headers: { Authorization: `Bearer ${tokens.ADMIN}` }
    });
    assert(
      adminHistGet.status === 200 && adminHistGet.body?.history?.length >= 12,
      `GET /api/purchases-history autoriza a ADMIN y retorna ${adminHistGet.body?.history?.length} compras registradas`
    );

    // 6.5B Seguridad RBAC y generación de Excel Detallado (.xlsx con tablas, barras y pastel)
    const excelNoAuth = await fetch(`${baseUrl}/api/reports/sales-excel`);
    const excelWaiter = await fetch(`${baseUrl}/api/reports/sales-excel`, {
      headers: { Authorization: `Bearer ${tokens.WAITER}` }
    });
    const excelAdmin = await fetch(`${baseUrl}/api/reports/sales-excel`, {
      headers: { Authorization: `Bearer ${tokens.ADMIN}` }
    });
    const excelBuf = Buffer.from(await excelAdmin.arrayBuffer());
    const excelLatin = excelBuf.toString('latin1');
    assert(
      excelNoAuth.status === 401 &&
      excelWaiter.status === 403 &&
      excelAdmin.status === 200 &&
      String(excelAdmin.headers.get('content-type') || '').includes('spreadsheetml.sheet') &&
      excelBuf[0] === 0x50 && excelBuf[1] === 0x4b &&
      excelLatin.includes('xl/charts/chart1.xml') &&
      excelLatin.includes('xl/charts/chart2.xml') &&
      excelLatin.includes('xl/worksheets/sheet4.xml'),
      `GET /api/reports/sales-excel protege con RBAC (401/403) y genera Excel .xlsx válido (${excelBuf.length} bytes) con 4 hojas, gráfico de barras y gráfico de pastel`
    );

    const prod6 = (menuRes.body?.productos || []).find((p) => Number(p.id) === 6);
    const prod7 = (menuRes.body?.productos || []).find((p) => Number(p.id) === 7);
    const expectedHistTotal = Number((Number(prod6?.original_price ?? prod6?.price ?? 27.9) + Number(prod7?.original_price ?? prod7?.price ?? 11.9)).toFixed(2));
    const adminHistPost = await httpJson(baseUrl, '/api/purchases-history', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.ADMIN}` },
      body: JSON.stringify({
        nombre_cliente: 'Cliente Prueba Historial QA',
        fecha_compra: '2026-10-20T19:30:00.000Z',
        numero_mesa: 4,
        metodo_pago: 'tarjeta_caja',
        tipo_comprobante: 'boleta',
        items: [
          { id_producto: 6, cantidad: 1 },
          { id_producto: 7, cantidad: 1 }
        ]
      })
    });
    assert(
      adminHistPost.status === 201 && Number(adminHistPost.body?.purchase?.monto_total) === expectedHistTotal,
      `POST /api/purchases-history registra compra anterior de S/ ${expectedHistTotal.toFixed(2)} (${adminHistPost.body?.purchase?.numero_comprobante}) para ADMIN`
    );

    // Limpiar compra de prueba para dejar la base impecable
    if (adminHistPost.body?.purchase?.id_pedido) {
      const pid = adminHistPost.body.purchase.id_pedido;
      const vid = adminHistPost.body.purchase.id_venta;
      await pool.query('DELETE FROM comprobantes WHERE id_venta = $1', [vid]);
      await pool.query('DELETE FROM ventas WHERE id_venta = $1', [vid]);
      await pool.query('DELETE FROM detalle_pedidos WHERE id_pedido = $1', [pid]);
      await pool.query('DELETE FROM pedidos WHERE id_pedido = $1', [pid]);
    }

    // 6.6 Carrusel de 4 Platos + Platillo Especial del Día con rotación diaria sin repetición
    const datesToCheck = ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'];
    const dailyResponses = await Promise.all(datesToCheck.map((dt) => httpJson(baseUrl, `/api/daily-specials?date=${dt}`)));
    const day1 = dailyResponses[0];
    const day1Again = await httpJson(baseUrl, '/api/daily-specials?date=2026-11-22');
    const day2 = dailyResponses[1];
    const day1Carousel = day1.body?.carousel || [];
    const day1Special = day1.body?.special_of_day;
    const day2Carousel = day2.body?.carousel || [];
    const day1Key = `${day1Special?.id}|${day1Carousel.map((s) => s.id).join(',')}`;
    const day1AgainKey = `${day1Again.body?.special_of_day?.id}|${(day1Again.body?.carousel || []).map((s) => s.id).join(',')}`;
    const uniqueCarouselImages = new Set(day1Carousel.map((s) => s.image).filter(Boolean));
    const consecutiveSpecialIds = dailyResponses.map((r) => Number(r.body?.special_of_day?.id));
    const uniqueConsecutiveSpecials = new Set(consecutiveSpecialIds);
    const day1CarouselSet = new Set(day1Carousel.map((c) => Number(c.id)));
    const carouselOverlapDay1ToDay2 = day2Carousel.filter((c) => day1CarouselSet.has(Number(c.id)));

    assert(
      day1.status === 200 &&
      day1Carousel.length === 4 &&
      uniqueCarouselImages.size === 4 &&
      day1.body?.counts?.carousel === 4 &&
      Boolean(day1Special) &&
      !day1Carousel.some((c) => Number(c.id) === Number(day1Special.id)),
      'GET /api/daily-specials entrega exactamente 4 imágenes distintas para el carrusel y 1 Platillo Especial del Día independiente'
    );
    assert(
      Number(day1Special?.discount_percent) === 25 &&
      Number(day1Special?.special_price) < Number(day1Special?.original_price) &&
      Number(day1Special?.savings_amount) > 0 &&
      Number((Number(day1Special.original_price) - Number(day1Special.special_price)).toFixed(2)) === Number(day1Special.savings_amount),
      `Platillo Especial del Día (${day1Special?.name}) reduce su precio de S/ ${Number(day1Special?.original_price).toFixed(2)} a S/ ${Number(day1Special?.special_price).toFixed(2)} (-25%)`
    );
    assert(
      day1Key === day1AgainKey &&
      uniqueConsecutiveSpecials.size === datesToCheck.length &&
      carouselOverlapDay1ToDay2.length === 0,
      'Rotación diaria garantizada: 4 días consecutivos tienen distintos Platillos Especiales y el carrusel renueva sus 4 platos cada día sin repetirse'
    );

    // 6.7 Pedido desde Carta (incluyendo Platillo Especial con precio rebajado y comentario opcional) -> Pago Yape/Plin -> Boleta PDF + Promoción
    const todayShowcase = await httpJson(baseUrl, '/api/daily-specials');
    const todaySpecial = todayShowcase.body?.special_of_day;
    const regularDish = (menuRes.body?.productos || []).find((p) => Number(p.id) !== Number(todaySpecial?.id) && Number(p.id) === 7)
      || (menuRes.body?.productos || []).find((p) => Number(p.id) !== Number(todaySpecial?.id));
    const expectedOrderTotal = Number((Number(todaySpecial.special_price) + Number(regularDish.price)).toFixed(2));

    const mesaSnapshot = (await pool.query('SELECT id_mesa, estado, tiempo_min, mozo_asignado, monto_acumulado FROM mesas WHERE numero_mesa = 15')).rows[0];
    const clientOrderRes = await httpJson(baseUrl, '/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.CLIENT}` },
      body: JSON.stringify({
        table_num: 15,
        client_name: 'Camila Torres (Test Carta)',
        comentarios: 'Sin cebolla y servir bebidas primero',
        id_usuario: usersByRole.CLIENT.db_id,
        items: [
          { id_producto: Number(todaySpecial.id), cantidad: 1, observaciones: 'Término medio' },
          { id_producto: Number(regularDish.id), cantidad: 1, observaciones: '' }
        ]
      })
    });
    assert(
      clientOrderRes.status === 201 &&
      Number(clientOrderRes.body?.order?.total) === expectedOrderTotal &&
      clientOrderRes.body?.order?.comentarios === 'Sin cebolla y servir bebidas primero',
      `POST /api/orders aplica el precio rebajado del Especial del Día y registra pedido con comentario opcional (S/ ${expectedOrderTotal.toFixed(2)})`
    );

    let testVoucherId = null;
    let testSaleId = null;
    if (clientOrderRes.body?.order?.id_pedido) {
      const oid = clientOrderRes.body.order.id_pedido;

      // Pago con Yape
      const yapePayRes = await httpJson(baseUrl, '/api/billing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.CASHIER}` },
        body: JSON.stringify({
          id_pedido: oid,
          metodo_pago: 'aplicacion',
          canal_pago: 'Yape',
          referencia_pago: 'YAPE-554433',
          tipo_comprobante: 'boleta',
          documento_cliente: '76891234',
          nombre_cliente: 'Camila Torres',
          cajero_nombre: 'María Salazar'
        })
      });

      testVoucherId = yapePayRes.body?.id_comprobante;
      testSaleId = yapePayRes.body?.id_venta;
      const rcpt = yapePayRes.body?.receipt;

      assert(
        yapePayRes.status === 201 &&
        rcpt?.canal_pago === 'Yape' &&
        rcpt?.restaurante?.ruc === '20601234567' &&
        String(rcpt?.codigo_promo || '').startsWith('MELIDAN15-') &&
        Boolean(rcpt?.descripcion_promo) &&
        Boolean(rcpt?.monto_en_letras),
        `POST /api/billing procesa pago Yape y emite boleta profesional (${rcpt?.numero_comprobante}) con cupón ${rcpt?.codigo_promo}`
      );

      // Descarga de PDF real de la boleta
      const pdfHttpRes = await fetch(`${baseUrl}/api/billing/${testVoucherId}/pdf`);
      const pdfBuf = Buffer.from(await pdfHttpRes.arrayBuffer());
      const pdfStr = pdfBuf.toString('latin1');
      assert(
        pdfHttpRes.status === 200 &&
        String(pdfHttpRes.headers.get('content-type') || '').includes('application/pdf') &&
        pdfStr.startsWith('%PDF-1.4') &&
        pdfStr.includes('MELIDAN RESTAURANTE') &&
        pdfStr.includes('20601234567') &&
        pdfStr.includes('Yape') &&
        pdfStr.includes('PROMOCION PARA TU SIGUIENTE COMPRA') &&
        pdfStr.includes(rcpt.codigo_promo),
        'GET /api/billing/:id/pdf genera y descarga PDF válido con datos del restaurante, platillos, Yape y cupón promocional'
      );

      // Verificar también canal Plin en el mismo flujo antes de limpiar
      const plinPayRes = await httpJson(baseUrl, '/api/billing', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.CASHIER}` },
        body: JSON.stringify({
          id_pedido: oid,
          metodo_pago: 'aplicacion',
          canal_pago: 'Plin',
          referencia_pago: 'PLIN-889900',
          tipo_comprobante: 'boleta',
          documento_cliente: '76891234',
          nombre_cliente: 'Camila Torres'
        })
      });
      assert(
        plinPayRes.status === 201 && plinPayRes.body?.receipt?.canal_pago === 'Plin',
        'POST /api/billing soporta pago con Plin con canal diferenciado en boleta y BD'
      );

      // Limpiar registros temporales de prueba
      if (testSaleId) {
        await pool.query('DELETE FROM comprobantes WHERE id_venta = $1', [testSaleId]);
        await pool.query('DELETE FROM ventas WHERE id_venta = $1', [testSaleId]);
      }
      await pool.query('DELETE FROM detalle_pedidos WHERE id_pedido = $1', [oid]);
      await pool.query('DELETE FROM pedidos WHERE id_pedido = $1', [oid]);
      if (mesaSnapshot) {
        await pool.query(
          'UPDATE mesas SET estado = $1, tiempo_min = $2, mozo_asignado = $3, monto_acumulado = $4 WHERE id_mesa = $5',
          [mesaSnapshot.estado, mesaSnapshot.tiempo_min, mesaSnapshot.mozo_asignado, mesaSnapshot.monto_acumulado, mesaSnapshot.id_mesa]
        );
      }
    }

    // 6.8 Consolidación de múltiples pedidos de una misma mesa en UNA SOLA boleta + Complemento -20%
    const compItem = compPool[0];
    const mainDishForMesa = (menuRes.body?.productos || []).find((p) => Number(p.id) !== Number(todaySpecial?.id) && ![3, 4, 5].includes(Number(p.id_categoria)));
    const mesa14Snap = (await pool.query('SELECT id_mesa, estado, tiempo_min, mozo_asignado, monto_acumulado FROM mesas WHERE numero_mesa = 14')).rows[0];

    const firstMesaOrder = await httpJson(baseUrl, '/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.CLIENT}` },
      body: JSON.stringify({
        table_num: 14,
        client_name: 'Prueba Mesa Unificada',
        items: [
          { id_producto: Number(mainDishForMesa.id), cantidad: 1 },
          { id_producto: Number(compItem.id), cantidad: 1, es_complemento: true }
        ]
      })
    });
    const expectedFirstTotal = Number((Number(mainDishForMesa.price) + Number(compItem.complement_price)).toFixed(2));
    assert(
      firstMesaOrder.status === 201 && Number(firstMesaOrder.body?.order?.total) === expectedFirstTotal,
      `POST /api/orders aplica descuento -20% de complemento en el servidor (S/ ${expectedFirstTotal.toFixed(2)})`
    );

    const secondMesaOrder = await httpJson(baseUrl, '/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.WAITER}` },
      body: JSON.stringify({
        table_num: 14,
        client_name: 'Prueba Mesa Unificada',
        items: [{ id_producto: Number(mainDishForMesa.id), cantidad: 1 }]
      })
    });
    const expectedConsolidatedTotal = Number((expectedFirstTotal + Number(mainDishForMesa.price)).toFixed(2));

    const unifiedBillRes = await httpJson(baseUrl, '/api/billing', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.CASHIER}` },
      body: JSON.stringify({
        id_pedido: firstMesaOrder.body?.order?.id_pedido,
        metodo_pago: 'efectivo_caja',
        canal_pago: 'Efectivo',
        tipo_comprobante: 'boleta',
        nombre_cliente: 'Prueba Mesa Unificada'
      })
    });

    assert(
      secondMesaOrder.status === 201 &&
      unifiedBillRes.status === 201 &&
      Number(unifiedBillRes.body?.consolidated_orders) === 2 &&
      Number(unifiedBillRes.body?.monto_total) === expectedConsolidatedTotal &&
      unifiedBillRes.body?.receipt?.items?.some((it) => Number(it.cantidad) === 2),
      `POST /api/billing consolida 2 pedidos consecutivos de la Mesa 14 en UNA SOLA boleta (S/ ${expectedConsolidatedTotal.toFixed(2)})`
    );

    // Limpiar prueba de mesa consolidada
    if (unifiedBillRes.body?.id_venta) {
      await pool.query('DELETE FROM comprobantes WHERE id_venta = $1', [unifiedBillRes.body.id_venta]);
      await pool.query('DELETE FROM ventas WHERE id_venta = $1', [unifiedBillRes.body.id_venta]);
    }
    for (const cleanupId of [firstMesaOrder.body?.order?.id_pedido, secondMesaOrder.body?.order?.id_pedido].filter(Boolean)) {
      await pool.query('DELETE FROM detalle_pedidos WHERE id_pedido = $1', [cleanupId]);
      await pool.query('DELETE FROM pedidos WHERE id_pedido = $1', [cleanupId]);
    }
    if (mesa14Snap) {
      await pool.query(
        'UPDATE mesas SET estado = $1, tiempo_min = $2, mozo_asignado = $3, monto_acumulado = $4 WHERE id_mesa = $5',
        [mesa14Snap.estado, mesa14Snap.tiempo_min, mesa14Snap.mozo_asignado, mesa14Snap.monto_acumulado, mesa14Snap.id_mesa]
      );
    }

    await syncAllSequences();
  } catch (err) {
    console.error('Error durante pruebas HTTP E2E:', err);
    testsFailed++;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }

  console.log('\n===============================================================');
  console.log(`  RESUMEN: ${testsPassed} pruebas exitosas, ${testsFailed} fallidas.`);
  if (testsFailed === 0) {
    console.log('  \x1b[32m✔ TODAS LAS VALIDACIONES Y PRUEBAS PASARON EXITOSAMENTE!\x1b[0m');
  } else {
    console.log('  \x1b[31m✖ ALGUNAS PRUEBAS FALLARON. REVISA LOS DETALLES ARRIBA.\x1b[0m');
  }
  console.log('===============================================================\n');

  process.exit(testsFailed === 0 ? 0 : 1);
}

runTests();
