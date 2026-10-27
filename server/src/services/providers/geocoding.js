const env = require('../../config/env');
const { fetchJson, TtlCache, createThrottle } = require('./http');

/**
 * Geocoding adapter interface
 *   search(query) -> [{ name, address, coordinates: {lat,lng}, source, isDemo }]
 */

const cache = new TtlCache(500);
const nominatimThrottle = createThrottle(1100); // Nominatim usage policy: max 1 request/second

const nominatim = {
  name: 'nominatim',
  async search(query) {
    const url = `${env.nominatimBaseUrl}/search?format=jsonv2&limit=6&addressdetails=0&q=${encodeURIComponent(query)}`;
    const json = await nominatimThrottle(() => fetchJson('nominatim', url));
    return (json || []).map((r) => ({
      name: r.name || r.display_name.split(',')[0],
      address: r.display_name,
      coordinates: { lat: Number(r.lat), lng: Number(r.lon) },
      type: r.type,
      source: 'nominatim',
      isDemo: false,
    }));
  },
};

// A handful of well-known places so the app is usable offline. Results are labelled demo.
const DEMO_PLACES = [
  ['Paris, France', 48.8566, 2.3522],
  ['Eiffel Tower, Paris', 48.8584, 2.2945],
  ['Louvre Museum, Paris', 48.8606, 2.3376],
  ['London, United Kingdom', 51.5074, -0.1278],
  ['British Museum, London', 51.5194, -0.127],
  ['Rome, Italy', 41.9028, 12.4964],
  ['Colosseum, Rome', 41.8902, 12.4922],
  ['Barcelona, Spain', 41.3874, 2.1686],
  ['New York, USA', 40.7128, -74.006],
  ['Central Park, New York', 40.7812, -73.9665],
  ['Tokyo, Japan', 35.6762, 139.6503],
  ['Kyoto, Japan', 35.0116, 135.7681],
  ['New Delhi, India', 28.6139, 77.209],
  ['Agra, India', 27.1767, 78.0081],
  ['Taj Mahal, Agra', 27.1751, 78.0421],
  ['Jaipur, India', 26.9124, 75.7873],
  ['Mumbai, India', 19.076, 72.8777],
  ['Goa, India', 15.2993, 74.124],
  ['Bengaluru, India', 12.9716, 77.5946],
  ['Singapore', 1.3521, 103.8198],
  ['Dubai, UAE', 25.2048, 55.2708],
  ['Sydney, Australia', -33.8688, 151.2093],
];

const demo = {
  name: 'demo',
  async search(query) {
    const q = query.trim().toLowerCase();
    return DEMO_PLACES.filter(([name]) => name.toLowerCase().includes(q))
      .slice(0, 6)
      .map(([name, lat, lng]) => ({
        name: name.split(',')[0],
        address: name,
        coordinates: { lat, lng },
        source: 'demo',
        isDemo: true,
      }));
  },
};

const selectAdapter = () =>
  env.providerMode === 'demo' || env.providers.geocoding === 'demo' ? demo : nominatim;

async function search(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const adapter = selectAdapter();
  const cacheKey = `${adapter.name}:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const results = await adapter.search(q);
  cache.set(cacheKey, results, 24 * 60 * 60 * 1000);
  return results;
}

module.exports = { search, selectAdapter, adapters: { nominatim, demo } };
