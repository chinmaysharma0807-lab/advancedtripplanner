const env = require('../src/config/env');
const providers = require('../src/services/providers');
const { resetCircuits } = require('../src/services/providers/http');
const { checkTraffic } = require('../src/jobs/progressJobs');
const { ItineraryItem, Notification } = require('../src/models');
const { registeredAgent, createTrip, minutesFromNow } = require('./helpers');

const A = { lat: 28.6139, lng: 77.209 };
const B = { lat: 28.5562, lng: 77.1 };

const tomtomResponse = {
  routes: [
    {
      summary: { lengthInMeters: 15200, travelTimeInSeconds: 1980, trafficDelayInSeconds: 540, trafficLengthInMeters: 3100, noTrafficTravelTimeInSeconds: 1440, arrivalTime: '2026-10-26T10:33:00+05:30' },
      legs: [
        {
          summary: { lengthInMeters: 15200, travelTimeInSeconds: 1980, trafficDelayInSeconds: 540 },
          points: [
            { latitude: A.lat, longitude: A.lng },
            { latitude: 28.59, longitude: 77.16 },
            { latitude: B.lat, longitude: B.lng },
          ],
        },
      ],
    },
  ],
};

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const trafficRoute = (overrides = {}) => ({
  distance: 6000,
  duration: 1800,
  geometry: [
    [A.lat, A.lng],
    [B.lat, B.lng],
  ],
  legs: [{ distance: 6000, duration: 1800, trafficDelay: 720 }],
  source: 'tomtom',
  isDemo: false,
  isEstimate: false,
  trafficAware: true,
  trafficKind: 'live',
  trafficDelay: 720,
  noTrafficDuration: 1080,
  ...overrides,
});

const saved = {};
beforeEach(() => {
  Object.assign(saved, { mode: env.providerMode, routing: env.providers.routing, key: env.tomtomApiKey });
});
afterEach(() => {
  env.providerMode = saved.mode;
  env.providers.routing = saved.routing;
  env.tomtomApiKey = saved.key;
  jest.restoreAllMocks();
  providers.routing.cache.clear();
  resetCircuits();
});

function useTomTom() {
  env.providerMode = 'live';
  env.providers.routing = 'tomtom';
  env.tomtomApiKey = 'test-tomtom-key';
}

describe('TomTom adapter', () => {
  test('requests live traffic and parses the route, legs and traffic delay', async () => {
    useTomTom();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok(tomtomResponse));
    const r = await providers.routing.route([A, B], 'driving');

    const url = new URL(fetchSpy.mock.calls[0][0]);
    expect(url.pathname).toBe(`/routing/1/calculateRoute/${A.lat.toFixed(6)},${A.lng.toFixed(6)}:${B.lat.toFixed(6)},${B.lng.toFixed(6)}/json`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ key: 'test-tomtom-key', travelMode: 'car', traffic: 'true', departAt: 'now', computeTravelTimeFor: 'all' });
    expect(r).toMatchObject({ source: 'tomtom', distance: 15200, duration: 1980, trafficAware: true, trafficKind: 'live', trafficDelay: 540, noTrafficDuration: 1440, isEstimate: false });
    expect(r.geometry).toHaveLength(3);
    expect(r.legs[0]).toEqual({ distance: 15200, duration: 1980, trafficDelay: 540 });
    expect(providers.describeProviders()).toMatchObject({ routing: 'tomtom', trafficAware: true });
  });

  test('walking routes are not traffic-aware and future departures are labelled predicted', async () => {
    useTomTom();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(ok(tomtomResponse));
    const walk = await providers.routing.route([A, B], 'walking');
    expect(walk).toMatchObject({ trafficAware: false, trafficKind: null, trafficDelay: 0 });
    expect(new URL(fetchSpy.mock.calls[0][0]).searchParams.get('travelMode')).toBe('pedestrian');

    const later = await providers.routing.route([A, B], 'driving', { departAt: new Date(Date.now() + 6 * 3600000) });
    expect(later.trafficKind).toBe('predicted');
    expect(new URL(fetchSpy.mock.calls[1][0]).searchParams.get('departAt')).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test('falls back to OSRM when TomTom rejects the key, without leaking the key', async () => {
    useTomTom();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('api.tomtom.com')) return { ok: false, status: 403, json: async () => ({}) };
      return ok({ code: 'Ok', routes: [{ distance: 14000, duration: 1500, geometry: { coordinates: [[A.lng, A.lat], [B.lng, B.lat]] }, legs: [{ distance: 14000, duration: 1500 }] }] });
    });
    const r = await providers.routing.route([A, B], 'driving');
    expect(r).toMatchObject({ source: 'osrm', trafficAware: false });
    expect(r.note).toMatch(/Fell back to osrm: tomtom rejected the API key \(HTTP 403\)/);
    expect(r.note).not.toContain('test-tomtom-key');

    // The bad key opens the circuit: the next route skips TomTom without calling it.
    providers.routing.cache.clear();
    fetchSpy.mockClear();
    await providers.routing.route([A, B], 'driving');
    expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes('api.tomtom.com'))).toBe(true);
  });

  test('without a key the default stays on keyless OSRM', () => {
    env.providerMode = 'live';
    env.providers.routing = 'tomtom';
    env.tomtomApiKey = '';
    expect(providers.routing.selectAdapter().name).toBe('osrm');
    expect(providers.routing.supportsTraffic()).toBe(false);
  });
});

describe('traffic_delay notifications', () => {
  test('tracking warns once per delay bucket when live traffic slows the leg', async () => {
    const { agent, user } = await registeredAgent();
    const trip = await createTrip(agent, { transportMode: 'driving' });
    await agent
      .post(`/api/trips/${trip._id}/itinerary`)
      .send({ title: 'Qutub Minar', scheduledStart: minutesFromNow(90), scheduledEnd: minutesFromNow(150), coordinates: B, transportMode: 'driving' })
      .expect(201);
    jest.spyOn(providers.routing.adapters.demo, 'route').mockResolvedValue(trafficRoute());
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);

    const res = await agent.post(`/api/trips/${trip._id}/location`).send({ ...A, accuracy: 10 }).expect(201);
    expect(res.body.data.events.map((e) => e.type)).toContain('traffic_delay');
    expect(res.body.data.session.progress).toMatchObject({ trafficAware: true, trafficDelaySeconds: 720, source: 'tomtom' });
    await agent.post(`/api/trips/${trip._id}/location`).send({ lat: A.lat + 0.0005, lng: A.lng, accuracy: 10 }).expect(201);

    const notes = await Notification.find({ userId: user.id, type: 'traffic_delay' });
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/Traffic adds about 12 min \(tomtom live traffic\)\. You should still arrive on time/);
  });

  test('routes without traffic data never produce traffic notifications', async () => {
    const { agent, user } = await registeredAgent();
    const trip = await createTrip(agent, { transportMode: 'driving' });
    await agent
      .post(`/api/trips/${trip._id}/itinerary`)
      .send({ title: 'Lodhi Garden', scheduledStart: minutesFromNow(90), scheduledEnd: minutesFromNow(150), coordinates: B, transportMode: 'driving' })
      .expect(201);
    jest.spyOn(providers.routing.adapters.demo, 'route').mockResolvedValue(trafficRoute({ source: 'osrm', trafficAware: false, trafficKind: null, trafficDelay: 0 }));
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    await agent.post(`/api/trips/${trip._id}/location`).send({ ...A, accuracy: 10 }).expect(201);
    expect(await Notification.countDocuments({ userId: user.id, type: 'traffic_delay' })).toBe(0);
  });

  test('the traffic job refreshes the next leg and tells members when to leave', async () => {
    const { agent, user } = await registeredAgent();
    const trip = await createTrip(agent, { transportMode: 'driving' });
    await agent.post(`/api/trips/${trip._id}/itinerary`).send({ title: 'India Gate', scheduledStart: minutesFromNow(-60), scheduledEnd: minutesFromNow(-10), coordinates: A }).expect(201);
    const next = (
      await agent.post(`/api/trips/${trip._id}/itinerary`).send({ title: 'Hauz Khas', scheduledStart: minutesFromNow(20), scheduledEnd: minutesFromNow(80), coordinates: B, transportMode: 'driving' }).expect(201)
    ).body.data;

    expect(await checkTraffic()).toMatchObject({ skipped: expect.any(String) }); // demo routing has no traffic

    jest.spyOn(providers.routing, 'supportsTraffic').mockReturnValue(true);
    jest.spyOn(providers.routing.adapters.demo, 'route').mockResolvedValue(trafficRoute());
    providers.routing.cache.clear(); // drop the non-traffic route cached while creating the items
    const stats = await checkTraffic();
    expect(stats).toMatchObject({ checked: 1, notified: 1 });

    const item = await ItineraryItem.findById(next._id);
    expect(item).toMatchObject({ estimatedTravelTime: 30, trafficDelayMinutes: 12, trafficKind: 'live', travelSource: 'tomtom' });
    const [note] = await Notification.find({ userId: user.id, type: 'traffic_delay' });
    expect(note.severity).toBe('warning'); // a 30 min drive for a stop 20 min away: leaving now is already late
    expect(note.message).toMatch(/Live traffic adds about 12 min from "India Gate"/);

    await checkTraffic();
    expect(await Notification.countDocuments({ userId: user.id, type: 'traffic_delay' })).toBe(1);
  });
});
