/**
 * src/server.js - Servidor Principal Node.js + Express (Restaurante Melidan)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const { pool, dbConfig } = require('./config/db');
const apiRouter = require('./routes/api');

const app = express();
const PORT = Number(process.env.PORT || 8000);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PAGES_DIR = path.join(PUBLIC_DIR, 'pages');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS para compatibilidad local y red móvil (PWA)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Rutas REST API (/api/*)
app.use('/api', apiRouter);

// Ruta directa al Login (usada por abrir_sistema.bat para ir directo al inicio de sesión)
app.get('/login', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Archivos estáticos principales (public/) y módulos organizados (public/pages/)
app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));
app.use(express.static(PAGES_DIR));

// Rutas amigables sin extensión
const cleanModuleRoutes = ['admin', 'mozo', 'cocina', 'cajero', 'carta'];
for (const mod of cleanModuleRoutes) {
  app.get(`/${mod}`, (req, res) => {
    res.sendFile(path.join(PAGES_DIR, `${mod}.html`));
  });
}

// 404 para rutas API inexistentes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Ruta API no encontrada' });
  }
  next();
});

// Manejador centralizado de errores
app.use((err, req, res, _next) => {
  console.error('[Melidan API Error]', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.expose ? err.message : 'Error interno del servidor al procesar la solicitud'
  });
});

function startServer(port = PORT) {
  const server = app.listen(port, () => {
    const actualPort = server.address()?.port || port;
    console.log(`\n  ✔ Melidan Web activa en: http://localhost:${actualPort}/login`);
    console.log(`  ✔ PostgreSQL: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  [Aviso] El puerto ${port} ya está en uso por otra instancia de Melidan.\n`);
      process.exit(0);
    }
    console.error('[Servidor] Error crítico al iniciar:', err);
    process.exit(1);
  });

  async function shutdown() {
    server.close(async () => {
      try { await pool.end(); } catch (_) {}
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  startServer(PORT);
}

module.exports = { app, startServer };

