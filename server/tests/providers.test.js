const providers = require('../src/services/providers');
const { ProviderError, resetCircuits } = require('../src/services/providers/http');
const weatherService = require('../src/services/weatherService');
const recommendationService = require('../src/services/recommendationService');
const { registeredAgent, createTrip, minutesFromNow } = require('./helpers');
const { ItineraryItem } = require('../src/models');

const A = { lat: 48.8606, lng: 2.3376 };
const B = { lat: 48.8584, lng: 2.2945 };

afterEach(() => {
  jest.restoreAllMocks();
  providers.routing.cache.clear();
  providers.weather.cache.clear();
  resetCircuits();
});

describe('external API failure handling', () => {
  test('real adapters surface timeouts and HTTP errors as ProviderError', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(providers.routing.adapters.osrm.route([A, B], 'walking')).rejects.toThrow(ProviderError);
    await expect(providers.routing.adapters.osrm.route([A, B], 'walking')).rejects.toThrow(/timed out/);

    global.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    resetCircuits();
    await expect(providers.weather.adapters.openMeteo.forecast(A)).rejects.toThrow(/HTTP 429/);
    // The circuit is now open: the next call fails fast without hitting the network.
    global.fetch.mockClear();
    await expect(providers.weather.adapters.openMeteo.forecast(A)).rejects.toThrow(/temporarily unavailable/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('OSRM refuses modes it cannot route instead of guessing', async () => {
    await expect(providers.routing.adapters.osrm.route([A, B], 'transit')).rejects.toThrow(/does not support/);
  });

  test('routing falls back to a clearly labelled straight-line estimate', async () => {
    jest.spyOn(providers.routing.adapters.demo, 'route').mockRejectedValue(new ProviderError('demo', 'boom'));
    const r = await providers.routing.route([A, B], 'walking');
    expect(r).toMatchObject({ source: 'straight-line-estimate', isEstimate: true, isDemo: false });
    expect(r.note).toMatch(/Routing provider unavailable/);
    await expect(providers.routing.route([A, B], 'walking', { allowEstimate: false })).rejects.toThrow('boom');
  });

  test('weather outages are reported, not invented, and existing flags are left untouched', async () => {
    const { agent } = await registeredAgent();
    const trip = await createTrip(agent);
    const item = (
      await agent
        .post(`/api/trips/${trip._id}/itinerary`)
        .send({ title: 'Picnic', isOutdoor: true, coordinates: A, scheduledStart: minutesFromNow(120), scheduledEnd: minutesFromNow(180) })
        .expect(201)
    ).body.data;
    await ItineraryItem.updateOne({ _id: item._id }, { $set: { weatherFlag: { severity: 'warning', summary: 'Rain', source: 'open-meteo' } } });
    jest.spyOn(providers.weather.adapters.demo, 'forecast').mockRejectedValue(new ProviderError('demo', 'down'));

    const res = await agent.get(`/api/trips/${trip._id}/weather`).expect(200);
    expect(res.body.data.destinations[0]).toMatchObject({ available: false });
    expect(res.body.data.destinations[0].reason).toMatch(/Weather unavailable/);
    expect(res.body.data.flags).toMatchObject({ checked: 1, failed: 1 });
    expect((await ItineraryItem.findById(item._id)).weatherFlag.summary).toBe('Rain');
  });

  test('demo weather is labelled as demo data', async () => {
    const f = await providers.weather.forecast(A);
    expect(f).toMatchObject({ source: 'demo', isDemo: true });
    expect(weatherService.assess({ weatherCode: 95, precipitationProbability: 80, windSpeed: 10 }).severity).toBe('severe');
    expect(weatherService.assess({ weatherCode: 1, precipitationProbability: 5, windSpeed: 5 })).toBeNull();
  });

  test('recommendations degrade gracefully when the places provider fails', async () => {
    jest.spyOn(providers.places.adapters.demo, 'nearby').mockRejectedValue(new ProviderError('demo', 'overloaded'));
    const r = await recommendationService.recommend({ timezone: 'UTC', interests: [] }, { travelPreferences: {} }, { lat: 1.234, lng: 5.678, category: 'food', radius: 999 });
    expect(r).toMatchObject({ available: false, items: [] });
    expect(r.reason).toMatch(/overloaded/);
  });

  test('parses only simple opening hours', () => {
    expect(recommendationService.parseSimpleHours('Mo-Su 09:00-18:00')).toMatchObject({ open: '09:00', close: '18:00' });
    expect(recommendationService.parseSimpleHours('24/7')).toMatchObject({ open: '00:00' });
    expect(recommendationService.parseSimpleHours('Mo-Fr 09:00-12:00; Sa off')).toBeNull();
  });

  test('provider status endpoint reports demo mode so the UI can label data', async () => {
    const { agent } = await registeredAgent();
    const res = await agent.get('/api/providers').expect(200);
    expect(res.body.data).toMatchObject({ mode: 'demo', routing: 'demo', weather: 'demo', trafficAware: false });
  });
});
