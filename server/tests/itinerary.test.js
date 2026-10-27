const { registeredAgent, createTrip, minutesFromNow, tripWithMember } = require('./helpers');
const { analyzeSchedule, reflow } = require('../src/services/scheduleService');

const itemBody = (overrides = {}) => ({
  title: 'Activity',
  scheduledStart: minutesFromNow(60),
  scheduledEnd: minutesFromNow(120),
  coordinates: { lat: 48.8606, lng: 2.3376 },
  ...overrides,
});

describe('itinerary API', () => {
  let agent;
  let trip;

  beforeAll(async () => {
    ({ agent } = await registeredAgent());
    trip = await createTrip(agent);
  });

  test('creates items with derived day, order, duration and travel time', async () => {
    const a = await agent.post(`/api/trips/${trip._id}/itinerary`).send(itemBody({ title: 'Louvre' })).expect(201);
    expect(a.body.data).toMatchObject({ title: 'Louvre', day: 1, order: 0, estimatedDuration: 60, status: 'upcoming' });

    const b = await agent
      .post(`/api/trips/${trip._id}/itinerary`)
      .send(itemBody({ title: 'Eiffel Tower', scheduledStart: minutesFromNow(180), scheduledEnd: minutesFromNow(240), coordinates: { lat: 48.8584, lng: 2.2945 } }))
      .expect(201);
    expect(b.body.data.order).toBe(1);
    expect(b.body.data.estimatedTravelTime).toBeGreaterThan(20);
    expect(b.body.data.travelSource).toBe('demo');
  });

  test('rejects end before start', async () => {
    const res = await agent.post(`/api/trips/${trip._id}/itinerary`).send(itemBody({ scheduledEnd: minutesFromNow(30) })).expect(422);
    expect(res.body.error.details[0].path).toBe('body.scheduledEnd');
  });

  test('blocks overlapping activities unless the conflict is confirmed', async () => {
    const clash = itemBody({ title: 'Clash', scheduledStart: minutesFromNow(90), scheduledEnd: minutesFromNow(150) });
    const res = await agent.post(`/api/trips/${trip._id}/itinerary`).send(clash).expect(409);
    expect(res.body.error.code).toBe('SCHEDULE_CONFLICT');
    expect(res.body.error.details.conflicts.map((c) => c.title)).toContain('Louvre');

    const ok = await agent.post(`/api/trips/${trip._id}/itinerary`).send({ ...clash, confirmConflict: true }).expect(201);
    expect(ok.body.data.conflictAcknowledged).toBe(true);
    const list = await agent.get(`/api/trips/${trip._id}/itinerary`).expect(200);
    expect(list.body.data.warnings.some((w) => w.type === 'overlap' && w.acknowledged)).toBe(true);
    await agent.delete(`/api/itinerary/${ok.body.data._id}`).expect(204);
  });

  test('reorders a day and re-times flexible activities', async () => {
    const list = await agent.get(`/api/trips/${trip._id}/itinerary`).expect(200);
    const [first, second] = list.body.data.items;
    const res = await agent
      .patch(`/api/trips/${trip._id}/itinerary/reorder`)
      .send({ day: 1, orderedIds: [second._id, first._id] })
      .expect(200);
    const [nowFirst, nowSecond] = res.body.data.items;
    expect(nowFirst.title).toBe('Eiffel Tower');
    expect(new Date(nowFirst.scheduledStart).getTime()).toBe(new Date(first.scheduledStart).getTime());
    expect(new Date(nowSecond.scheduledStart).getTime()).toBe(
      new Date(nowFirst.scheduledEnd).getTime() + nowSecond.estimatedTravelTime * 60000
    );
    await agent.patch(`/api/trips/${trip._id}/itinerary/reorder`).send({ day: 1, orderedIds: [first._id] }).expect(400);
  });

  test('records status changes and edits in the activity log', async () => {
    const list = await agent.get(`/api/trips/${trip._id}/itinerary`).expect(200);
    const item = list.body.data.items[0];
    await agent.patch(`/api/itinerary/${item._id}/status`).send({ status: 'skipped', reason: 'Too crowded' }).expect(200);
    await agent.patch(`/api/itinerary/${item._id}`).send({ notes: 'Try tomorrow', priority: 'high' }).expect(200);
    // Status cannot be changed through the generic edit endpoint (unknown fields are dropped).
    const edited = await agent.patch(`/api/itinerary/${item._id}`).send({ status: 'completed' }).expect(200);
    expect(edited.body.data.status).toBe('skipped');

    const log = await agent.get(`/api/trips/${trip._id}/activity-log`).expect(200);
    const statusEntry = log.body.data.find((e) => e.changeType === 'status_changed');
    expect(statusEntry).toMatchObject({ previousValues: { status: 'upcoming' }, newValues: { status: 'skipped' }, reason: 'Too crowded', source: 'user' });
    expect(statusEntry.changedBy.name).toBeDefined();
    expect(log.body.data.find((e) => e.changeType === 'updated').newValues).toEqual({ priority: 'high' });
  });

  test('generates an editable draft without saving it, then bulk-saves it', async () => {
    const draft = await agent.post(`/api/trips/${trip._id}/itinerary/generate`).send({ days: 2, pace: 'relaxed' }).expect(200);
    expect(draft.body.data.isDemo).toBe(true);
    expect(draft.body.data.items.length).toBeGreaterThanOrEqual(10);
    const before = await agent.get(`/api/trips/${trip._id}/itinerary`).expect(200);

    const items = draft.body.data.items.slice(0, 4).map((i) => ({ ...i, title: `${i.title} (edited)` }));
    const saved = await agent.post(`/api/trips/${trip._id}/itinerary/bulk`).send({ items, replaceExisting: false }).expect(201);
    expect(saved.body.data.items.length).toBe(before.body.data.items.length + 4);
  });

  test('viewers cannot change the itinerary', async () => {
    const { member, trip: shared } = await tripWithMember('viewer');
    await member.agent.post(`/api/trips/${shared._id}/itinerary`).send(itemBody()).expect(403);
    await member.agent.get(`/api/trips/${shared._id}/itinerary`).expect(200);
  });
});

describe('schedule analysis', () => {
  const at = (h, m = 0) => new Date(Date.UTC(2026, 5, 1, h, m));

  test('flags insufficient transfers, unrealistic travel and opening hours', () => {
    const items = [
      { _id: 'a', title: 'A', scheduledStart: at(9), scheduledEnd: at(10), coordinates: { lat: 48.86, lng: 2.33 }, status: 'upcoming' },
      { _id: 'b', title: 'B', scheduledStart: at(10, 10), scheduledEnd: at(11), estimatedTravelTime: 25, status: 'upcoming' },
      { _id: 'c', title: 'C', scheduledStart: at(11, 5), scheduledEnd: at(12), coordinates: { lat: 48.95, lng: 2.6 }, transportMode: 'walking', status: 'upcoming' },
      { _id: 'd', title: 'D', scheduledStart: at(17), scheduledEnd: at(19), operatingHours: { open: '09:00', close: '18:00' }, status: 'upcoming' },
    ];
    items[1].coordinates = { lat: 48.861, lng: 2.331 };
    const types = analyzeSchedule(items, { timezone: 'UTC' }).map((w) => `${w.type}:${w.itemId}`);
    expect(types).toEqual(expect.arrayContaining(['insufficient_transfer:b', 'unrealistic_travel:c', 'outside_hours:d']));
  });

  test('ignores cancelled items and keeps fixed bookings in place when reflowing', () => {
    const ordered = [
      { _id: '1', scheduledStart: at(9), scheduledEnd: at(10), status: 'upcoming' },
      { _id: '2', scheduledStart: at(14), scheduledEnd: at(15), status: 'upcoming', isFixedTime: true },
      { _id: '3', scheduledStart: at(11), scheduledEnd: at(12), status: 'upcoming', estimatedTravelTime: 15 },
    ];
    const plan = reflow(ordered);
    expect(plan[1].scheduledStart).toEqual(at(14));
    expect(plan[2].scheduledStart).toEqual(at(15, 15));
    expect(analyzeSchedule([{ ...ordered[0] }, { ...ordered[0], _id: 'x', status: 'cancelled' }])).toHaveLength(0);
  });
});
