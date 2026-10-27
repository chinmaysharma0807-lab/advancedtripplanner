const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const handler = (req, res, next, options) =>
  res.status(options.statusCode).json({
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
  });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimit.authMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.rateLimit.apiMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

// Location fixes are keyed per user so a shared NAT does not throttle a whole group.
const locationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.rateLimit.locationMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `user:${req.user._id}` : req.ip),
  handler,
});

module.exports = { authLimiter, apiLimiter, locationLimiter };
