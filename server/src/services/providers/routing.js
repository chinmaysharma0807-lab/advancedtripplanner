const env = require('../../config/env');
const { AVERAGE_SPEED_KMH } = require('../../config/constants');
const { haversine, straightLine } = require('../../utils/geo');
const { fetchJson, TtlCache, ProviderError } = require('./http');

/**
 * Routing adapter interface
 *   route(points: {lat,lng}[], mode, { departAt?: Date }) -> {
 *     distance: meters, duration: seconds, geometry: [[lat,lng]],
 *     legs: [{ distance, duration, trafficDelay? }],
 *     source, isDemo, isEstimate,
 *     trafficAware,            // true only when the provider applied traffic to this route
 *     trafficKind,             // 'live' (departing now) | 'predicted' (future departure) | null
 *     trafficDelay,            // seconds traffic adds versus empty roads (traffic-aware routes only)
 *     incidentDelay,           // part of that caused by live incidents/jams (TomTom trafficDelayInSeconds)
 *     noTrafficDuration        // seconds without traffic, when the provider reports it
 *   }
 * Adapters throw ProviderError when the provider cannot answer; callers decide how to degrade.
 */

const cache = new TtlCache(300);
const ROUTE_TTL = 10 * 60 * 1000;
const TRAFFIC_ROUTE_TTL = 2 * 60 * 1000; // traffic changes quickly; keep live answers fresh

const pointsKey = (points) => points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');

/** Departure times in the near future are treated as "now"; later ones are bucketed for caching. */
function normaliseDeparture(departAt) {
  if (!departAt) return null;
  const t = new Date(departAt).getTime();
  if (!Number.isFinite(t) || t <= Date.now() + 5 * 60 * 1000) return null;
  return new Date(Math.round(t / (15 * 60 * 1000)) * 15 * 60 * 1000);
}

// ---------------------------------------------------------------- OSRM
// FOSSGIS instance by default – free, keyless, no traffic.
const OSRM_PROFILES = { driving: 'routed-car', mixed: 'routed-car', walking: 'routed-foot', cycling: 'routed-bike' };

const osrm = {
  name: 'osrm',
  supportsTraffic: false,
  supports: (mode) => Boolean(OSRM_PROFILES[mode]),
  async route(points, mode) {
    const profile = OSRM_PROFILES[mode];
    if (!profile) throw new ProviderError('osrm', `OSRM does not support ${mode} routing`, { retryable: false });
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${env.osrmBaseUrl}/${profile}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const json = await fetchJson('osrm', url);
    if (json.code !== 'Ok' || !json.routes?.length) {
      throw new ProviderError('osrm', `OSRM could not find a route (${json.code})`, { retryable: false });
    }
    const r = json.routes[0];
    return {
      distance: r.distance,
      duration: r.duration,
      geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      legs: r.legs.map((l) => ({ distance: l.distance, duration: l.duration })),
      source: 'osrm',
      isDemo: false,
      isEstimate: false,
      trafficAware: false,
      trafficKind: null,
    };
  },
};

// ---------------------------------------------------------------- TomTom
// Calculate Route API with live traffic (car modes) — needs TOMTOM_API_KEY.
// Docs: https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route
const TOMTOM_MODES = { driving: 'car', mixed: 'car', walking: 'pedestrian', cycling: 'bicycle' };
const TOMTOM_TRAFFIC_MODES = new Set(['car']);
const TOMTOM_MAX_POINTS = 150;

const tomtom = {
  name: 'tomtom',
  supportsTraffic: true,
  supports: (mode) => Boolean(TOMTOM_MODES[mode]),
  async route(points, mode, { departAt } = {}) {
    const travelMode = TOMTOM_MODES[mode];
    if (!travelMode) throw new ProviderError('tomtom', `TomTom does not route ${mode}`, { retryable: false });
    if (points.length > TOMTOM_MAX_POINTS) throw new ProviderError('tomtom', `TomTom accepts at most ${TOMTOM_MAX_POINTS} points`, { retryable: false });
    const withTraffic = TOMTOM_TRAFFIC_MODES.has(travelMode);
    const locations = points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(':');
    const params = new URLSearchParams({
      key: env.tomtomApiKey,
      travelMode,
      traffic: String(withTraffic),
      routeType: 'fastest',
      routeRepresentation: 'polyline',
      computeTravelTimeFor: 'all',
      departAt: departAt ? departAt.toISOString() : 'now',
    });
    const json = await fetchJson('tomtom', `${env.tomtomBaseUrl}/routing/1/calculateRoute/${locations}/json?${params}`);
    const r = json.routes?.[0];
    if (!r) throw new ProviderError('tomtom', 'TomTom could not find a route', { retryable: false });
    const s = r.summary;
    // TomTom's trafficDelayInSeconds only counts live incidents. What a traveller feels is the whole
    // difference between the live travel time and free-flow (empty-road) travel time.
    const congestion = (sum) =>
      Number.isFinite(sum.noTrafficTravelTimeInSeconds)
        ? Math.max(0, sum.travelTimeInSeconds - sum.noTrafficTravelTimeInSeconds, sum.trafficDelayInSeconds || 0)
        : sum.trafficDelayInSeconds || 0;
    return {
      distance: s.lengthInMeters,
      duration: s.travelTimeInSeconds,
      geometry: (r.legs || []).flatMap((leg, i) => (leg.points || []).slice(i === 0 ? 0 : 1).map((p) => [p.latitude, p.longitude])),
      legs: (r.legs || []).map((l) => ({
        distance: l.summary.lengthInMeters,
        duration: l.summary.travelTimeInSeconds,
        trafficDelay: withTraffic ? congestion(l.summary) : 0,
      })),
      source: 'tomtom',
      isDemo: false,
      isEstimate: false,
      trafficAware: withTraffic,
      trafficKind: withTraffic ? (departAt ? 'predicted' : 'live') : null,
      trafficDelay: withTraffic ? congestion(s) : 0,
      incidentDelay: withTraffic ? s.trafficDelayInSeconds || 0 : 0,
      noTrafficDuration: s.noTrafficTravelTimeInSeconds ?? null,
      arrivalTime: s.arrivalTime || null,
    };
  },
};

// ---------------------------------------------------------------- OpenRouteService
// Used when ROUTING_PROVIDER=ors and MAPS_API_KEY are set. No traffic.
const ORS_PROFILES = { driving: 'driving-car', mixed: 'driving-car', walking: 'foot-walking', cycling: 'cycling-regular' };

const ors = {
  name: 'openrouteservice',
  supportsTraffic: false,
  supports: (mode) => Boolean(ORS_PROFILES[mode]),
  async route(points, mode) {
    const profile = ORS_PROFILES[mode];
    if (!profile) throw new ProviderError('openrouteservice', `ORS does not support ${mode}`, { retryable: false });
    const json = await fetchJson('openrouteservice', `https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: 'POST',
      headers: { Authorization: env.mapsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: points.map((p) => [p.lng, p.lat]) }),
    });
    const feature = json.features?.[0];
    if (!feature) throw new ProviderError('openrouteservice', 'No route found', { retryable: false });
    const summary = feature.properties.summary || {};
    return {
      distance: summary.distance || 0,
      duration: summary.duration || 0,
      geometry: feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      legs: (feature.properties.segments || []).map((s) => ({ distance: s.distance, duration: s.duration })),
      source: 'openrouteservice',
      isDemo: false,
      isEstimate: false,
      trafficAware: false,
      trafficKind: null,
    };
  },
};

// ---------------------------------------------------------------- estimates
// Straight-line estimate. Used in demo mode, and as a clearly-labelled last-resort fallback.
function straightLineRoute(points, mode, { source, isDemo }) {
  const speed = (AVERAGE_SPEED_KMH[mode] || AVERAGE_SPEED_KMH.driving) / 3.6; // m/s
  const detour = mode === 'flight' ? 1 : 1.3;
  const legs = [];
  const geometry = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const distance = haversine(points[i], points[i + 1]) * detour;
    legs.push({ distance, duration: distance / speed });
    const seg = straightLine(points[i], points[i + 1]);
    geometry.push(...(i === 0 ? seg : seg.slice(1)));
  }
  return {
    distance: legs.reduce((s, l) => s + l.distance, 0),
    duration: legs.reduce((s, l) => s + l.duration, 0),
    geometry,
    legs,
    source,
    isDemo,
    isEstimate: true,
    trafficAware: false,
    trafficKind: null,
  };
}

const demo = {
  name: 'demo',
  supportsTraffic: false,
  supports: () => true,
  async route(points, mode) {
    return straightLineRoute(points, mode, { source: 'demo', isDemo: true });
  },
};

function selectAdapter() {
  if (env.providerMode === 'demo' || env.providers.routing === 'demo') return demo;
  if (env.providers.routing === 'tomtom' && env.tomtomApiKey) return tomtom;
  if (env.providers.routing === 'ors' && env.mapsApiKey) return ors;
  return osrm;
}

/** Whether the active routing provider can apply traffic (used to skip traffic-only work). */
const supportsTraffic = () => Boolean(selectAdapter().supportsTraffic);

/**
 * Route through `points`. Tries the configured provider, then OSRM, then a straight-line
 * estimate labelled `isEstimate: true`. Never presents an estimate as live routing data, and
 * only routes that really came back with traffic are marked `trafficAware`.
 */
async function route(points, mode = 'driving', { allowEstimate = true, departAt } = {}) {
  const valid = points.filter(Boolean);
  if (valid.length < 2) throw new ProviderError('routing', 'At least two points are required', { retryable: false });
  const primary = selectAdapter();
  const chain = [primary];
  if (primary !== osrm && primary !== demo) chain.push(osrm);

  const departure = normaliseDeparture(departAt);
  const cacheKey = `${primary.name}:${mode}:${departure ? departure.toISOString() : 'now'}:${pointsKey(valid)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const errors = [];
  for (const adapter of chain) {
    if (!adapter.supports(mode)) {
      errors.push(`${adapter.name} cannot route ${mode}`);
      continue;
    }
    try {
      const result = await adapter.route(valid, mode, { departAt: departure });
      if (errors.length) result.note = `Fell back to ${adapter.name}: ${errors.join('; ')}.`;
      cache.set(cacheKey, result, result.trafficAware ? TRAFFIC_ROUTE_TTL : ROUTE_TTL);
      return result;
    } catch (err) {
      if (!allowEstimate && adapter === chain[chain.length - 1]) throw err;
      errors.push(err.message);
    }
  }

  if (!allowEstimate) throw new ProviderError(primary.name, errors.join('; '), { retryable: false });
  const estimate = straightLineRoute(valid, mode, { source: 'straight-line-estimate', isDemo: false });
  const unsupportedOnly = errors.every((e) => / cannot route /.test(e));
  estimate.note = unsupportedOnly
    ? `${primary.name} cannot route ${mode}; distances are straight-line estimates.`
    : `Routing provider unavailable (${errors.join('; ')}); showing a straight-line estimate.`;
  if (!unsupportedOnly) estimate.providerError = errors.join('; ');
  else cache.set(cacheKey, estimate, ROUTE_TTL);
  // Failures are not cached: the circuit breaker already limits retries against a failing provider.
  return estimate;
}

module.exports = { route, selectAdapter, supportsTraffic, straightLineRoute, cache, adapters: { osrm, tomtom, ors, demo } };
