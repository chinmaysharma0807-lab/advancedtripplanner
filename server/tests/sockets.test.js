const http = require('http');
const { io: ioClient } = require('socket.io-client');
const { app, tripWithMember, registeredAgent, createTrip, minutesFromNow } = require('./helpers');
const { createSocketServer } = require('../src/sockets');
const { User } = require('../src/models');

let server;
let io;
let url;
const clients = [];

beforeAll(async () => {
  server = http.createServer(app);
  io = createSocketServer(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  while (clients.length) clients.pop().close();
});

afterAll(async () => {
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

/** Pull the session cookie out of a supertest agent's jar. */
function cookieFor(agent) {
  const cookie = agent.jar.getCookie('ts_token', { domain: '127.0.0.1', path: '/', script: false, secure: false });
  return `ts_token=${cookie.value}`;
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], extraHeaders: cookie ? { Cookie: cookie } : {}, reconnection: false, forceNew: true });
    clients.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

const emit = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const nextEvent = (socket, event, timeout = 3000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

describe('Socket.IO authorization and delivery', () => {
  test('rejects unauthenticated connections', async () => {
    await expect(connect()).rejects.toThrow('unauthorized');
    await expect(connect('ts_token=bogus')).rejects.toThrow('unauthorized');
  });

  test('only members can join a trip room; payloads are validated', async () => {
    const { owner, trip } = await tripWithMember('viewer');
    const stranger = await registeredAgent();
    const ownerSocket = await connect(cookieFor(owner.agent));
    const strangerSocket = await connect(cookieFor(stranger.agent));

    expect(await emit(ownerSocket, 'join_trip', { tripId: trip._id })).toMatchObject({ ok: true, data: { role: 'owner' } });
    expect(await emit(strangerSocket, 'join_trip', { tripId: trip._id })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await emit(strangerSocket, 'join_trip', { tripId: { $ne: null } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  test('broadcasts persisted location updates to members, never to outsiders', async () => {
    const { owner, member, trip } = await tripWithMember('viewer');
    const stranger = await registeredAgent();
    const strangerTrip = await createTrip(stranger.agent);

    const memberSocket = await connect(cookieFor(member.agent));
    const strangerSocket = await connect(cookieFor(stranger.agent));
    await emit(memberSocket, 'join_trip', { tripId: trip._id });
    await emit(strangerSocket, 'join_trip', { tripId: strangerTrip._id });
    let strangerSaw = false;
    strangerSocket.on('trip_location_updated', () => {
      strangerSaw = true;
    });

    await owner.agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    const received = nextEvent(memberSocket, 'trip_location_updated');
    await owner.agent.post(`/api/trips/${trip._id}/location`).send({ lat: 48.86, lng: 2.33, accuracy: 12 }).expect(201);
    const update = await received;
    expect(update).toMatchObject({ tripId: trip._id, userId: owner.user.id, coordinates: { lat: 48.86, lng: 2.33 }, isDemo: false });
    await new Promise((r) => setTimeout(r, 200));
    expect(strangerSaw).toBe(false);
  });

  test('respects a traveller who does not share their location', async () => {
    const { owner, member, trip } = await tripWithMember('viewer');
    await owner.agent.patch('/api/users/me').send({ privacy: { shareLocationWithParticipants: false } }).expect(200);
    const memberSocket = await connect(cookieFor(member.agent));
    await emit(memberSocket, 'join_trip', { tripId: trip._id });
    let saw = false;
    memberSocket.on('trip_location_updated', () => {
      saw = true;
    });
    await owner.agent.post(`/api/trips/${trip._id}/tracking/start`).send({ consent: true }).expect(200);
    await owner.agent.post(`/api/trips/${trip._id}/location`).send({ lat: 48.86, lng: 2.33 }).expect(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(saw).toBe(false);
    const latest = await member.agent.get(`/api/trips/${trip._id}/location/latest`).expect(200);
    expect(latest.body.data.travellers).toHaveLength(0);
  });

  test('status updates over sockets are authorized per event and broadcast to the room', async () => {
    const { owner, member: viewer, trip } = await tripWithMember('viewer');
    const item = (
      await owner.agent
        .post(`/api/trips/${trip._id}/itinerary`)
        .send({ title: 'Museum', scheduledStart: minutesFromNow(30), scheduledEnd: minutesFromNow(90) })
        .expect(201)
    ).body.data;

    const ownerSocket = await connect(cookieFor(owner.agent));
    const viewerSocket = await connect(cookieFor(viewer.agent));
    await emit(ownerSocket, 'join_trip', { tripId: trip._id });
    await emit(viewerSocket, 'join_trip', { tripId: trip._id });

    const denied = await emit(viewerSocket, 'activity_status_update', { tripId: trip._id, itemId: item._id, status: 'completed' });
    expect(denied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const broadcast = nextEvent(viewerSocket, 'activity_status_changed');
    const okReply = await emit(ownerSocket, 'activity_status_update', { tripId: trip._id, itemId: item._id, status: 'in_progress' });
    expect(okReply).toMatchObject({ ok: true, data: { status: 'in_progress' } });
    expect(await broadcast).toMatchObject({ itemId: item._id, status: 'in_progress', previousStatus: 'upcoming' });

    const request = nextEvent(ownerSocket, 'itinerary_change_requested');
    expect(await emit(viewerSocket, 'itinerary_change_request', { tripId: trip._id, itemId: item._id, message: 'Can we go later?' })).toMatchObject({ ok: true });
    expect((await request).message).toBe('Can we go later?');
  });

  test('a removed participant can no longer act through an open socket', async () => {
    const { owner, member, trip } = await tripWithMember('editor');
    const socket = await connect(cookieFor(member.agent));
    expect((await emit(socket, 'join_trip', { tripId: trip._id })).ok).toBe(true);
    await owner.agent.delete(`/api/trips/${trip._id}/participants/${member.user.id}`).expect(204);
    const reply = await emit(socket, 'location_update', { tripId: trip._id, lat: 1, lng: 1 });
    expect(reply).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await User.exists({ _id: member.user.id })).toBeTruthy();
  });
});
