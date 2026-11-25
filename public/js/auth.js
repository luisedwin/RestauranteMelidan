/**
 * auth.js - Servicio de Autenticación contra PostgreSQL 18 vía API Node.js.
 * LocalStorage conserva la sesión autenticada y el token firmado HMAC del rol activo.
 */
class AuthService {
  static SESSION_KEY = 'melidan_auth_user';
  static API_URL = '/api/auth';

  static async parseJsonSafe(response) {
    try {
      return await response.json();
    } catch (_) {
      return {};
    }
  }

  static saveSession(user) {
    if (!user) return;
    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
    } catch (_) {}
  }

  static async login(email, password) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) throw new Error('Ingresa un correo electrónico.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Ingresa un correo electrónico válido, por ejemplo: usuario@gmail.com');
    }
    if (!password) throw new Error('Ingresa tu contraseña.');

    const response = await fetch(`${this.API_URL}?action=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });
    const result = await this.parseJsonSafe(response);
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Error de autenticación');
    }

    this.saveSession(result.user);
    if (window.db) {
      window.db.isPostgresConnected = true;
      window.db.updateConnectionBadge(true);
    }
    return result.user;
  }

  static getCurrentUser() {
    try {
      const data = localStorage.getItem(this.SESSION_KEY);
      return data ? JSON.parse(data) : null;
    } catch (_) {
      return null;
    }
  }

  static logout() {
    try {
      localStorage.removeItem(this.SESSION_KEY);
      localStorage.removeItem('melidan_session_user');
    } catch (_) {}
  }

  static async sendOtpCode(email) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) throw new Error('Ingresa un correo electrónico.');
    const response = await fetch(`${this.API_URL}?action=request_reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail })
    });
    const result = await this.parseJsonSafe(response);
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Error solicitando código');
    }
    return { code: result.code, message: result.message };
  }

  static async verifyOtp(email, code) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').replace(/\D/g, '');
    const response = await fetch(`${this.API_URL}?action=verify_code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, code: cleanCode })
    });
    const result = await this.parseJsonSafe(response);
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Código incorrecto o expirado');
    }
    return true;
  }

  static async resetPassword(email, code, newPassword, confirmPassword) {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('La contraseña debe tener mínimo 6 caracteres.');
    }
    if (newPassword !== confirmPassword) {
      throw new Error('Las contraseñas no coinciden.');
    }
    const response = await fetch(`${this.API_URL}?action=reset_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: String(email || '').trim().toLowerCase(),
        code: String(code || '').replace(/\D/g, ''),
        password: newPassword
      })
    });
    const result = await this.parseJsonSafe(response);
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Error al cambiar contraseña');
    }
    return true;
  }
}

window.AuthService = AuthService;
