const env = require('./env');

// Minimal structured JSON logger. Never pass passwords, tokens, cookies or raw
// coordinates in `meta`; use `redact()` for objects that may contain them.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? (env.isTest ? -1 : env.isProduction ? 2 : 3);

const SENSITIVE_KEYS = /pass(word)?|token|secret|cookie|authorization|^(lat|lng|latitude|longitude|coordinates|location|accuracy)$/i;

function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function write(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(meta ? redact(meta) : {}),
  });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

module.exports = {
  error: (msg, meta) => write('error', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  debug: (msg, meta) => write('debug', msg, meta),
  redact,
};
