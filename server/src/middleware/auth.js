const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { User } = require('../models');
const { unauthorized } = require('../utils/errors');

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), tv: user.tokenVersion || 0 }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction || env.crossSiteCookies,
    sameSite: env.crossSiteCookies ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/** Resolve the user for a raw JWT, honouring token revocation. Returns null when invalid. */
async function userFromToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const user = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || (user.tokenVersion || 0) !== payload.tv) return null;
  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await userFromToken(req.cookies?.[env.cookieName]);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function optionalAuth(req, res, next) {
  try {
    req.user = (await userFromToken(req.cookies?.[env.cookieName])) || null;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { signToken, cookieOptions, userFromToken, requireAuth, optionalAuth };
