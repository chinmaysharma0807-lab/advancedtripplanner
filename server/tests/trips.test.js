const { registeredAgent, createTrip, tripPayload, tripWithMember, today, newAgent } = require('./helpers');
const { computeStatus } = require('../src/services/tripService');

const DAY = 86400000;

describe('trip CRUD', () => {
  test('creates, reads, updates, duplicates and deletes a trip', async () => {
    const { agent } = await registeredAgent();
    const trip = await createTrip(agent, { name: 'Weekend', intermediateStops: [{ name: 'Versailles' }] });
    expect(trip).toMatchObject({ name: 'Weekend', myRole: 'owner', status: 'active', currency: 'EUR' });

    const list = await agent.get('/api/trips').expect(200);
    expect(list.body.data.map((t) => t._id)).toContain(trip._id);
    expect(list.body.meta).toMatchObject({ page: 1, total: 1 });

    const detail = await agent.get(`/api/trips/${trip._id}`).expect(200);
    expect(detail.body.data.intermediateStops[0].name).toBe('Versailles');

    const updated = await agent.patch(`/api/trips/${trip._id}`).send({ name: 'Long weekend', budget: 1500.555 }).expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Long weekend', budget: 1500.56 });

    const copy = await agent.post(`/api/trips/${trip._id}/duplicate`).send({}).expect(201);
    expect(copy.body.data.name).toBe('Long weekend (copy)');

    await agent.delete(`/api/trips/${trip._id}`).expect(204);
    await agent.get(`/api/trips/${trip._id}`).expect(404);
  });

  test('validates trip input', async () => {
    const { agent } = await registeredAgent();
    const res = await agent
      .post('/api/trips')
      .send(tripPayload({ endDate: new Date(today().getTime() - DAY).toISOString(), currency: 'EURO', travelers: 0 }))
      .expect(422);
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['body.endDate', 'body.currency', 'body.travelers']));
    await agent.post('/api/trips').send(tripPayload({ timezone: 'Mars/Olympus' })).expect(422);
  });

  test('classifies trips as upcoming, active or completed, honouring overrides', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const base = { startDate: new Date('2026-06-12'), endDate: new Date('2026-06-14'), statusOverride: null };
    expect(computeStatus(base, { now })).toBe('upcoming');
    expect(computeStatus(base, { now, activeTracking: true })).toBe('active');
    expect(computeStatus({ ...base, startDate: new Date('2026-06-09') }, { now })).toBe('active');
    expect(computeStatus({ ...base, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-05') }, { now })).toBe('completed');
    expect(computeStatus({ ...base, startDate: new Date('2026-06-09') }, { now, itemStats: { total: 3, open: 0 } })).toBe('completed');
    expect(computeStatus({ ...base, statusOverride: 'completed' }, { now })).toBe('completed');
  });
});

describe('ownership and collaboration', () => {
  test('strangers cannot see or modify a trip, and ids cannot be probed', async () => {
    const owner = await registeredAgent();
    const stranger = await registeredAgent();
    const trip = await createTrip(owner.agent);
    await stranger.agent.get(`/api/trips/${trip._id}`).expect(404);
    await stranger.agent.patch(`/api/trips/${trip._id}`).send({ name: 'mine now' }).expect(404);
    await stranger.agent.delete(`/api/trips/${trip._id}`).expect(404);
    await stranger.agent.get(`/api/trips/${trip._id}/itinerary`).expect(404);
    await stranger.agent.get('/api/trips/not-an-id').expect(400);
    const list = await stranger.agent.get('/api/trips').expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  test('pending invitations grant no access until accepted', async () => {
    const owner = await registeredAgent();
    const guest = await registeredAgent();
    const trip = await createTrip(owner.agent);
    await owner.agent.post(`/api/trips/${trip._id}/invitations`).send({ email: guest.credentials.email, role: 'viewer' }).expect(201);
    await guest.agent.get(`/api/trips/${trip._id}`).expect(404);
    const pending = await guest.agent.get('/api/invitations').expect(200);
    expect(pending.body.data[0]).toMatchObject({ name: 'Test Trip', role: 'viewer' });
    await guest.agent.post(`/api/invitations/${trip._id}/accept`).expect(200);
    const detail = await guest.agent.get(`/api/trips/${trip._id}`).expect(200);
    expect(detail.body.data.myRole).toBe('viewer');
  });

  test('viewers are read-only; editors edit but cannot change owner-only settings', async () => {
    const { owner, member: viewer, trip } = await tripWithMember('viewer');
    await viewer.agent.patch(`/api/trips/${trip._id}`).send({ name: 'x' }).expect(403);
    await viewer.agent.delete(`/api/trips/${trip._id}`).expect(403);

    const editor = await registeredAgent();
    await owner.agent.post(`/api/trips/${trip._id}/invitations`).send({ email: editor.credentials.email, role: 'editor' }).expect(201);
    await editor.agent.post(`/api/invitations/${trip._id}/accept`).expect(200);
    await editor.agent.patch(`/api/trips/${trip._id}`).send({ description: 'Updated by editor' }).expect(200);
    await editor.agent.patch(`/api/trips/${trip._id}`).send({ visibility: 'private' }).expect(403);
    await editor.agent.delete(`/api/trips/${trip._id}`).expect(403);
    await editor.agent.post(`/api/trips/${trip._id}/invitations`).send({ email: 'x@example.test' }).expect(403);
  });

  test('removing a participant revokes access', async () => {
    const { owner, member, trip } = await tripWithMember('editor');
    await owner.agent.delete(`/api/trips/${trip._id}/participants/${member.user.id}`).expect(204);
    await member.agent.get(`/api/trips/${trip._id}`).expect(404);
  });

  test('share links expose a read-only itinerary and can be joined or revoked', async () => {
    const owner = await registeredAgent();
    const trip = await createTrip(owner.agent);
    const link = await owner.agent.post(`/api/trips/${trip._id}/share-links`).send({ role: 'viewer', expiresInDays: 7 }).expect(201);
    const { token } = link.body.data;
    expect(token).toHaveLength(32);

    const anon = await newAgent();
    const view = await anon.get(`/api/share/${token}`).expect(200);
    expect(view.body.data.trip.name).toBe('Test Trip');
    expect(JSON.stringify(view.body.data)).not.toContain('participants');

    const joiner = await registeredAgent();
    const joined = await joiner.agent.post(`/api/share/${token}/join`).expect(200);
    expect(joined.body.data.role).toBe('viewer');
    await joiner.agent.get(`/api/trips/${trip._id}`).expect(200);

    await owner.agent.delete(`/api/trips/${trip._id}/share-links/${link.body.data._id}`).expect(204);
    await anon.get(`/api/share/${token}`).expect(404);
    await anon.get('/api/share/not-a-real-token-at-all').expect(404);
  });
});
