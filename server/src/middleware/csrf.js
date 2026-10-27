const crypto = require('crypto');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

// Double-submit CSRF protection for cookie-authenticated requests.
// GET /api/auth/csrf issues a random token both as a cookie and in the response body;
// state-changing requests must echo it in the X-CSRF-Token header.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: env.isProduction || env.crossSiteCookies,
    sameSite: env.crossSiteCookies ? 'none' : 'lax',
    path: '/',
  };
}

function issueCsrfToken(req, res) {
  const existing = req.cookies?.[env.csrfCookieName];
  const token = existing && /^[a-f0-9]{64}$/.test(existing) ? existing : crypto.randomBytes(32).toString('hex');
  res.cookie(env.csrfCookieName, token, csrfCookieOptions());
  return token;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies?.[env.csrfCookieName];
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token. Refresh the page and try again.'));
  }
  return next();
}

module.exports = { csrfProtection, issueCsrfToken };
