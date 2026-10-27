const env = require('../../config/env');
const logger = require('../../config/logger');

class ProviderError extends Error {
  constructor(provider, message, { status, retryable = true } = {}) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Small TTL cache to avoid hammering free public APIs with identical requests. */
class TtlCache {
  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.map.size >= this.maxEntries) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
  }

  clear() {
    this.map.clear();
  }
}

/** Serialises calls so a provider sees at most one request every `intervalMs`. */
function createThrottle(intervalMs) {
  let chain = Promise.resolve();
  let last = 0;
  return (fn) => {
    const run = chain.then(async () => {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  };
}

// Back off from a provider for a while after it rate-limits or fails repeatedly.
const circuit = new Map();
const CIRCUIT_OPEN_MS = 60 * 1000;

async function fetchJson(provider, url, { method = 'GET', headers = {}, body, timeoutMs = env.externalTimeoutMs } = {}) {
  const state = circuit.get(provider);
  if (state && state.openUntil > Date.now()) {
    throw new ProviderError(provider, `${provider} is temporarily unavailable (backing off after errors)`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': env.providerUserAgent, Accept: 'application/json', ...headers },
      body,
      signal: controller.signal,
    });
    if (res.status === 429 || res.status >= 500) {
      const failures = (state?.failures || 0) + 1;
      circuit.set(provider, { failures, openUntil: failures >= 3 || res.status === 429 ? Date.now() + CIRCUIT_OPEN_MS : 0 });
      throw new ProviderError(provider, `${provider} responded with HTTP ${res.status}`, { status: res.status });
    }
    if (res.status === 401 || res.status === 403) {
      // Bad or inactive API key: stop calling for a while instead of failing every request.
      circuit.set(provider, { failures: 1, openUntil: Date.now() + 10 * CIRCUIT_OPEN_MS });
      logger.warn('External provider rejected the API key', { provider, status: res.status });
      throw new ProviderError(provider, `${provider} rejected the API key (HTTP ${res.status})`, { status: res.status, retryable: false });
    }
    if (!res.ok) {
      throw new ProviderError(provider, `${provider} responded with HTTP ${res.status}`, { status: res.status, retryable: false });
    }
    circuit.delete(provider);
    return await res.json();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const failures = (state?.failures || 0) + 1;
    circuit.set(provider, { failures, openUntil: failures >= 3 ? Date.now() + CIRCUIT_OPEN_MS : 0 });
    const message = err.name === 'AbortError' ? `${provider} timed out` : `${provider} request failed: ${err.message}`;
    logger.warn('External provider error', { provider, error: message });
    throw new ProviderError(provider, message);
  } finally {
    clearTimeout(timer);
  }
}

function resetCircuits() {
  circuit.clear();
}

module.exports = { fetchJson, ProviderError, TtlCache, createThrottle, resetCircuits };
