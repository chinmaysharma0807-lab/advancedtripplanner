const { registeredAgent, createTrip, minutesFromNow, tripWithMember } = require('./helpers');
const { Notification, ItineraryItem, LocationUpdate, RescheduleProposal } = require('../src/models');

const TARGET = { lat: 48.8606, lng: 2.3376 };
const north = (meters) => ({ lat: TARGET.lat + meters / 111320, lng: TARGET.lng });
const fix = (meters, minutesAgo = 0, extra = {}) => ({ ...north(meters), accuracy: 10, timestamp: minutesFromNow(-minutesAgo), ...extra });

async function setup(items) {
  const { agent, user } = await registeredAgent();
  const trip = await createTrip(agent);
  const created = [];
  for (const body of items) {
    const res = await agent.post(`/api/trips/${trip._id}/itinerary`).send(body).expect(201);
    created.push(res.body.data);
  }
  return { agent, user, trip, items: created };
}

describe('live tracking', () => {
  test('requires explicit consent and an active session', async () => {
    const { agent, trip } = await setup([]);
    await agent.post(`/api/trips/${trip._id}/location`).send(fix(100)).expect(409);
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({}).expect(422);
    const start = await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    expect(start.body.data.status).toBe('active');
    await agent.post(`/api/trips/${trip._id}/tracking/pause`).expect(200);
    await agent.post(`/api/trips/${trip._id}/location`).send(fix(100)).expect(409);
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    await agent.post(`/api/trips/${trip._id}/tracking/stop`).expect(200);
    await agent.post(`/api/trips/${trip._id}/location`).send(fix(100)).expect(409);
  });

  test('validates fixes and rejects future timestamps', async () => {
    const { agent, trip } = await setup([]);
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    await agent.post(`/api/trips/${trip._id}/location`).send({ lat: 123, lng: 0 }).expect(422);
    await agent.post(`/api/trips/${trip._id}/location`).send({ ...north(10), timestamp: minutesFromNow(30) }).expect(400);
  });

  test('persists fixes, computes ETA and walks the activity through approaching → in progress', async () => {
    const { agent, user, trip, items } = await setup([
      { title: 'Louvre', scheduledStart: minutesFromNow(60), scheduledEnd: minutesFromNow(180), coordinates: TARGET, transportMode: 'walking' },
    ]);
    const [louvre] = items;
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);

    const far = await agent.post(`/api/trips/${trip._id}/location`).send(fix(2000, 20)).expect(201);
    const progress = far.body.data.session.progress;
    expect(progress).toMatchObject({ source: 'demo', isDemo: true, percent: 0 });
    expect(progress.distanceRemaining).toBeGreaterThan(2000);
    expect(new Date(progress.eta).getTime()).toBeGreaterThan(Date.now() - 20 * 60000);
    expect((await ItineraryItem.findById(louvre._id)).status).toBe('upcoming');

    const near = await agent.post(`/api/trips/${trip._id}/location`).send(fix(600, 15)).expect(201);
    expect(near.body.data.session.progress.percent).toBeGreaterThan(50);
    expect((await ItineraryItem.findById(louvre._id)).status).toBe('approaching');

    const arrived = await agent.post(`/api/trips/${trip._id}/location`).send(fix(40, 6)).expect(201);
    expect(arrived.body.data.events.map((e) => e.type)).toContain('arrival_detected');
    expect((await ItineraryItem.findById(louvre._id)).status).toBe('approaching'); // proximity alone never starts it

    // Low-accuracy fixes never drive geofence decisions.
    await agent.post(`/api/trips/${trip._id}/location`).send(fix(40, 5, { accuracy: 900 })).expect(201);

    await agent.post(`/api/trips/${trip._id}/location`).send(fix(30, 0)).expect(201);
    const started = await ItineraryItem.findById(louvre._id);
    expect(started.status).toBe('in_progress');
    expect(started.statusSource).toBe('rule');

    // Leaving does not complete the activity (autoCompleteOnDeparture is off by default).
    await agent.post(`/api/trips/${trip._id}/location`).send(fix(1000, 0)).expect(201);
    expect((await ItineraryItem.findById(louvre._id)).status).toBe('in_progress');
    expect(await Notification.exists({ userId: user.id, type: 'completion_prompt' })).toBeTruthy();

    expect(await LocationUpdate.countDocuments({ tripId: trip._id })).toBe(6);
    const latest = await agent.get(`/api/trips/${trip._id}/location/latest`).expect(200);
    expect(latest.body.data.travellers[0].lastLocation.coordinates.lat).toBeCloseTo(north(1000).lat, 5);
    const history = await agent.get(`/api/trips/${trip._id}/location/history?limit=2`).expect(200);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.meta).toMatchObject({ total: 6, totalPages: 3 });

    const stored = await LocationUpdate.findOne({ tripId: trip._id });
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400000 - 3600000);

    const del = await agent.delete('/api/users/me/location-history').expect(200);
    expect(del.body.data.deleted).toBe(6);
  });

  test('auto-completes on departure only when the owner enabled that rule', async () => {
    const { agent, trip, items } = await setup([
      { title: 'Museum', scheduledStart: minutesFromNow(-30), scheduledEnd: minutesFromNow(60), coordinates: TARGET },
    ]);
    await agent.patch(`/api/trips/${trip._id}`).send({ trackingSettings: { autoCompleteOnDeparture: true } }).expect(200);
    await agent.patch(`/api/itinerary/${items[0]._id}/status`).send({ status: 'in_progress' }).expect(200);
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    await agent.post(`/api/trips/${trip._id}/location`).send(fix(800)).expect(201);
    const item = await ItineraryItem.findById(items[0]._id);
    expect(item.status).toBe('completed');
    expect(item.statusSource).toBe('rule');
  });

  test('detects delays, proposes a revised schedule that preserves bookings, and applies it on approval', async () => {
    const { agent, trip, items } = await setup([
      { title: 'Gallery', scheduledStart: minutesFromNow(10), scheduledEnd: minutesFromNow(70), coordinates: TARGET, priority: 'medium' },
      { title: 'Coffee', scheduledStart: minutesFromNow(80), scheduledEnd: minutesFromNow(140), coordinates: north(100), priority: 'low' },
      { title: 'Booked dinner', scheduledStart: minutesFromNow(150), scheduledEnd: minutesFromNow(210), coordinates: north(200), isFixedTime: true, priority: 'must' },
    ]);
    const [gallery, coffee, dinner] = items;
    await agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    const res = await agent.post(`/api/trips/${trip._id}/location`).send(fix(5000)).expect(201);
    expect(res.body.data.session.progress.delayMinutes).toBeGreaterThan(60);
    expect((await ItineraryItem.findById(gallery._id)).status).toBe('delayed');

    const proposals = await agent.get(`/api/trips/${trip._id}/proposals`).expect(200);
    expect(proposals.body.data).toHaveLength(1);
    const proposal = proposals.body.data[0];
    const action = (id) => proposal.changes.find((c) => c.itemId === id)?.action;
    expect(action(gallery._id)).toBe('shift');
    expect(action(coffee._id)).toBe('skip');
    expect(action(dinner._id)).toBe('keep');
    expect(proposal.explanation).toMatch(/Nothing changes until you approve/);

    // A second fix with a similar delay reuses the pending proposal instead of creating a new one.
    await agent.post(`/api/trips/${trip._id}/location`).send(fix(4990)).expect(201);
    expect(await RescheduleProposal.countDocuments({ tripId: trip._id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'reschedule_proposed' })).toBe(1);

    await agent.post(`/api/trips/${trip._id}/proposals/${proposal._id}/apply`).send({}).expect(200);
    const [g, c, d] = await Promise.all([gallery, coffee, dinner].map((i) => ItineraryItem.findById(i._id)));
    expect(g.scheduledStart.getTime()).toBeGreaterThan(new Date(gallery.scheduledStart).getTime() + 50 * 60000);
    expect(c.status).toBe('skipped');
    expect(d.scheduledStart.toISOString()).toBe(new Date(dinner.scheduledStart).toISOString());
    await agent.post(`/api/trips/${trip._id}/proposals/${proposal._id}/apply`).send({}).expect(409);

    const log = await agent.get(`/api/trips/${trip._id}/activity-log?limit=50`).expect(200);
    const rescheduled = log.body.data.find((e) => e.changeType === 'rescheduled');
    expect(rescheduled).toMatchObject({ itemTitle: 'Gallery', source: 'gps' });
    expect(rescheduled.previousValues.scheduledStart).toBeDefined();
    expect(rescheduled.reason).toMatch(/later because of the delay/);
  });

  test('travellers can report a delay manually', async () => {
    const { agent, trip } = await setup([
      { title: 'Tour', scheduledStart: minutesFromNow(30), scheduledEnd: minutesFromNow(90), coordinates: TARGET },
      { title: 'Lunch', scheduledStart: minutesFromNow(100), scheduledEnd: minutesFromNow(160), coordinates: north(300) },
    ]);
    const res = await agent.post(`/api/trips/${trip._id}/itinerary/delay`).send({ minutes: 45 }).expect(200);
    expect(res.body.data).toMatchObject({ source: 'user', delayMinutes: 45, status: 'pending' });
    await agent.post(`/api/trips/${trip._id}/proposals/${res.body.data._id}/reject`).expect(200);
  });

  test('members of another trip cannot follow this one', async () => {
    const { member } = await tripWithMember('viewer');
    const { trip } = await tripWithMember('viewer');
    await member.agent.get(`/api/trips/${trip._id}/location/latest`).expect(404);
  });

  test('viewer role cannot start tracking or post fixes', async () => {
    const { member, trip } = await tripWithMember('viewer');
    await member.agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(403);
    await member.agent.post(`/api/trips/${trip._id}/location`).send(fix(10)).expect(403);
    await member.agent.get(`/api/trips/${trip._id}/location/latest`).expect(200);
  });
});
