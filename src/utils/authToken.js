/**
 * src/utils/authToken.js - Tokens firmados HMAC-SHA256 y Middleware RBAC Backend
 */
const crypto = require('crypto');

const TOKEN_SECRET = process.env.AUTH_SECRET || 'melidan-hmac-secret-2026-pg18';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

function signToken(userRow) {
  const payload = {
    uid: Number(userRow.id_usuario || userRow.db_id || 0),
    rol: String(userRow.rol || userRow.raw_role || '').toLowerCase().trim(),
    name: String(userRow.nombre || userRow.name || ''),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function extractBearerToken(req) {
  const auth = String(req.headers?.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function requireRoles(...allowedRoles) {
  const normalizedAllowed = allowedRoles.map((r) => String(r).toLowerCase().trim());
  return (req, res, next) => {
    const token = extractBearerToken(req);
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: 'No autenticado. Inicia sesión para acceder a este recurso.'
      });
    }
    if (!normalizedAllowed.includes(payload.rol)) {
      return res.status(403).json({
        success: false,
        message: 'Acceso denegado: este recurso es exclusivo para el rol autorizado.'
      });
    }
    req.authUser = payload;
    next();
  };
}

const requireAdmin = requireRoles('administrador');

module.exports = {
  signToken,
  verifyToken,
  extractBearerToken,
  requireRoles,
  requireAdmin
};

