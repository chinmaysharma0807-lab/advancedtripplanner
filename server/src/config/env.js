const path = require('path');
const dotenv = require('dotenv');

// The single .env file lives at the repository root (tripsync/.env).
// A server-local .env is also honoured for deployments that only ship /server.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) {
    throw new Error('JWT_SECRET must be set in production');
  }
  jwtSecret = 'tripsync-insecure-development-secret-change-me';
  if (!isTest) {
    // eslint-disable-next-line no-console
    console.warn('[config] JWT_SECRET is not set; using an insecure development secret.');
  }
}

const providerMode = (process.env.PROVIDER_MODE || 'live').toLowerCase();

const env = {
  nodeEnv,
  isProduction,
  isTest,
  port: int(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tripsync',
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieName: 'ts_token',
  csrfCookieName: 'ts_csrf',
  // Set CROSS_SITE_COOKIES=true when the client and API are served from different sites
  // (requires HTTPS). SameSite=None is then used together with the CSRF double-submit check.
  crossSiteCookies: bool(process.env.CROSS_SITE_COOKIES, false),
  // Render sets RENDER_EXTERNAL_URL; when the API serves the built client this is the app's own URL.
  clientUrls: (process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  // Behind Render/Railway/Heroku-style proxies this must be true so rate limits see real client IPs.
  trustProxy: bool(process.env.TRUST_PROXY, Boolean(process.env.RENDER)),

  providerMode, // 'live' | 'demo'
  providers: {
    // TomTom (live traffic) is picked automatically when TOMTOM_API_KEY is set.
    routing: (process.env.ROUTING_PROVIDER || (process.env.TOMTOM_API_KEY ? 'tomtom' : 'osrm')).toLowerCase(),
    geocoding: (process.env.GEOCODING_PROVIDER || 'nominatim').toLowerCase(),
    weather: (process.env.WEATHER_PROVIDER || 'open-meteo').toLowerCase(),
    places: (process.env.PLACES_PROVIDER || 'overpass').toLowerCase(),
    ai: (process.env.AI_PROVIDER || 'anthropic').toLowerCase(),
  },
  mapsApiKey: process.env.MAPS_API_KEY || '',
  tomtomApiKey: process.env.TOMTOM_API_KEY || '',
  tomtomBaseUrl: process.env.TOMTOM_BASE_URL || 'https://api.tomtom.com',
  weatherApiKey: process.env.WEATHER_API_KEY || '',
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'claude-opus-5-5',
  osrmBaseUrl: process.env.OSRM_BASE_URL || 'https://routing.openstreetmap.de',
  nominatimBaseUrl: process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
  overpassBaseUrl: process.env.OVERPASS_BASE_URL || 'https://overpass-api.de/api/interpreter',
  openMeteoBaseUrl: process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com/v1/forecast',
  // Public OSM services require an identifying User-Agent; add your contact URL or email here.
  providerUserAgent: process.env.PROVIDER_USER_AGENT || 'TripSync/1.0 (self-hosted trip planner)',
  externalTimeoutMs: int(process.env.EXTERNAL_TIMEOUT_MS, 8000),

  // Traffic must add at least this many minutes (and 15% of the no-traffic time) to notify.
  trafficDelayNotifyMinutes: int(process.env.TRAFFIC_DELAY_NOTIFY_MINUTES, 5),

  locationRetentionDays: int(process.env.LOCATION_RETENTION_DAYS, 30),
  allowDemoSimulation: bool(process.env.ALLOW_DEMO_SIMULATION, !isProduction),
  enableJobs: bool(process.env.ENABLE_JOBS, !isTest),

  rateLimit: {
    authMax: int(process.env.RATE_LIMIT_AUTH_MAX, isTest ? 1000 : 20),
    apiMax: int(process.env.RATE_LIMIT_API_MAX, isTest ? 100000 : 600),
    locationMax: int(process.env.RATE_LIMIT_LOCATION_MAX, isTest ? 100000 : 120),
  },
};

module.exports = env;
