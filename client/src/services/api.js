import axios from 'axios';

// All requests go to the same origin (Vite proxies /api in development). The session lives in
// an HTTP-only cookie; state-changing requests also carry the CSRF double-submit token.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 30000,
});

let csrfToken = null;
let csrfPromise = null;

export async function ensureCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise || force) {
    csrfPromise = api.get('/auth/csrf').then((res) => {
      csrfToken = res.data.data.csrfToken;
      return csrfToken;
    });
  }
  try {
    return await csrfPromise;
  } finally {
    csrfPromise = null;
  }
}

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

api.interceptors.request.use(async (config) => {
  if (MUTATING.has((config.method || 'get').toLowerCase())) {
    config.headers['X-CSRF-Token'] = await ensureCsrf();
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 403 && response.data?.error?.code === 'CSRF_INVALID' && !config.__csrfRetried) {
      config.__csrfRetried = true;
      config.headers['X-CSRF-Token'] = await ensureCsrf(true);
      return api.request(config);
    }
    return Promise.reject(error);
  }
);

/** Normalise an axios error into { status, code, message, details }. */
export function toApiError(error) {
  if (!error?.response) {
    return {
      status: 0,
      code: 'NETWORK',
      message: navigator.onLine === false ? 'You are offline. Changes will need to be retried when you reconnect.' : 'Could not reach the TripSync server.',
    };
  }
  const body = error.response.data?.error || {};
  return { status: error.response.status, code: body.code || 'ERROR', message: body.message || 'Something went wrong', details: body.details };
}

export default api;
