// Strips keys that could be interpreted as MongoDB operators or dotted paths
// ("$where", "a.b") from request bodies and query strings, and trims control characters.

function clean(value, depth = 0) {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      out[key] = clean(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }
  return value;
}

function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  if (req.query && typeof req.query === 'object') {
    const cleaned = clean(req.query);
    // Express 4 allows reassigning req.query; keep a copy for safety.
    for (const key of Object.keys(req.query)) delete req.query[key];
    Object.assign(req.query, cleaned);
  }
  next();
}

module.exports = { sanitizeRequest, clean };
