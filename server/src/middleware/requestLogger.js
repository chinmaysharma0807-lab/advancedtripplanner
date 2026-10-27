const logger = require('../config/logger');

// Logs method, route and status only. Bodies, cookies and query strings are never logged
// because they can contain credentials or precise locations.
function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    logger.info('request', {
      method: req.method,
      path: req.baseUrl + (typeof req.route?.path === 'string' ? req.route.path : req.path),
      status: res.statusCode,
      durationMs: Math.round(ms),
      userId: req.user?._id?.toString(),
    });
  });
  next();
}

module.exports = { requestLogger };
