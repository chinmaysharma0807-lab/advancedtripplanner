const env = require('../../config/env');
const { haversine } = require('../../utils/geo');
const { fetchJson, TtlCache, createThrottle } = require('./http');

/**
 * Places adapter interface
 *   nearby({lat,lng}, category, radiusMeters) -> [{
 *     id, name, category, coordinates, address, distance, openingHours, cuisine, tags, source, isDemo
 *   }]
 */

const CATEGORIES = {
  food: { label: 'Restaurants & cafés', overpass: ['nwr["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]'] },
  attractions: {
    label: 'Attractions',
    overpass: ['nwr["tourism"~"^(attraction|museum|viewpoint|gallery|zoo|theme_park|aquarium)$"]', 'nwr["historic"~"^(monument|castle|memorial|ruins|fort)$"]'],
  },
  transit: {
    label: 'Public transport',
    overpass: ['nwr["railway"~"^(station|halt)$"]', 'nwr["amenity"="bus_station"]', 'nwr["public_transport"="station"]'],
  },
  hotels: { label: 'Hotels & stays', overpass: ['nwr["tourism"~"^(hotel|hostel|guest_house|motel|apartment)$"]'] },
  essentials: {
    label: 'Fuel & essentials',
    overpass: ['nwr["amenity"~"^(fuel|pharmacy|hospital|atm|toilets|police)$"]'],
  },
  indoor: {
    label: 'Indoor alternatives',
    overpass: ['nwr["tourism"~"^(museum|gallery|aquarium)$"]', 'nwr["amenity"~"^(cinema|theatre|library|arts_centre)$"]', 'nwr["shop"="mall"]'],
  },
};

const cache = new TtlCache(300);
const overpassThrottle = createThrottle(1000);

function categoryOf(tags) {
  if (/restaurant|cafe|fast_food|food_court/.test(tags.amenity || '')) return 'food';
  if (tags.tourism && /hotel|hostel|guest_house|motel|apartment/.test(tags.tourism)) return 'hotels';
  if (tags.railway || tags.public_transport || tags.amenity === 'bus_station') return 'transit';
  if (/fuel|pharmacy|hospital|atm|toilets|police/.test(tags.amenity || '')) return 'essentials';
  return 'attractions';
}

const overpass = {
  name: 'overpass',
  async nearby(center, category, radius) {
    const selectors = (CATEGORIES[category] || CATEGORIES.attractions).overpass;
    const around = `(around:${Math.round(radius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)})`;
    const query = `[out:json][timeout:20];(${selectors.map((s) => `${s}${around};`).join('')});out center tags 60;`;
    const json = await overpassThrottle(() =>
      fetchJson('overpass', env.overpassBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: Math.max(env.externalTimeoutMs, 25000),
      })
    );
    return (json.elements || [])
      .filter((e) => e.tags?.name)
      .map((e) => {
        const lat = e.lat ?? e.center?.lat;
        const lng = e.lon ?? e.center?.lon;
        const t = e.tags;
        const address = [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ');
        return {
          id: `osm:${e.type}/${e.id}`,
          name: t.name,
          category: category === 'indoor' ? 'indoor' : categoryOf(t),
          kind: t.amenity || t.tourism || t.historic || t.railway || t.shop || 'place',
          coordinates: { lat, lng },
          address: address || undefined,
          openingHours: t.opening_hours || null,
          cuisine: t.cuisine || null,
          diet: Object.fromEntries(
            Object.entries(t)
              .filter(([k]) => k.startsWith('diet:'))
              .map(([k, v]) => [k.slice(5), v])
          ),
          website: t.website || t['contact:website'] || null,
          wheelchair: t.wheelchair || null,
          fee: t.fee || null,
          indoor: category === 'indoor' || ['museum', 'gallery', 'aquarium', 'cinema', 'theatre', 'library', 'mall'].includes(t.tourism || t.amenity || t.shop),
          source: 'openstreetmap',
          isDemo: false,
        };
      })
      .filter((p) => Number.isFinite(p.coordinates.lat) && Number.isFinite(p.coordinates.lng));
  },
};

const DEMO_NAMES = {
  food: ['Demo Bistro', 'Demo Café', 'Demo Street Kitchen', 'Demo Veggie House', 'Demo Noodle Bar'],
  attractions: ['Demo City Museum', 'Demo Old Fort', 'Demo Viewpoint', 'Demo Botanical Garden', 'Demo Art Gallery'],
  transit: ['Demo Central Station', 'Demo Bus Terminal', 'Demo Metro Stop'],
  hotels: ['Demo Grand Hotel', 'Demo Backpackers Hostel', 'Demo Guest House'],
  essentials: ['Demo Fuel Station', 'Demo Pharmacy', 'Demo ATM'],
  indoor: ['Demo Science Museum', 'Demo Cinema', 'Demo Library', 'Demo Aquarium'],
};

const demo = {
  name: 'demo',
  async nearby(center, category, radius) {
    const names = DEMO_NAMES[category] || DEMO_NAMES.attractions;
    return names.map((name, i) => {
      const angle = (i / names.length) * 2 * Math.PI;
      const dist = radius * (0.2 + 0.15 * i);
      const lat = center.lat + (dist / 111320) * Math.cos(angle);
      const lng = center.lng + (dist / (111320 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle);
      return {
        id: `demo:${category}:${i}`,
        name,
        category,
        kind: category,
        coordinates: { lat, lng },
        openingHours: null,
        cuisine: category === 'food' ? (i % 2 ? 'vegetarian' : 'local') : null,
        diet: category === 'food' && i === 3 ? { vegetarian: 'yes' } : {},
        indoor: category === 'indoor',
        source: 'demo',
        isDemo: true,
      };
    });
  },
};

const selectAdapter = () => (env.providerMode === 'demo' || env.providers.places === 'demo' ? demo : overpass);

async function nearby(center, category = 'attractions', radius = 1500) {
  const adapter = selectAdapter();
  const cacheKey = `${adapter.name}:${category}:${radius}:${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  let results = cache.get(cacheKey);
  if (!results) {
    results = await adapter.nearby(center, category, radius);
    cache.set(cacheKey, results, 60 * 60 * 1000);
  }
  return results
    .map((p) => ({ ...p, distance: Math.round(haversine(center, p.coordinates)) }))
    .sort((a, b) => a.distance - b.distance);
}

module.exports = { nearby, CATEGORIES, selectAdapter, adapters: { overpass, demo } };
