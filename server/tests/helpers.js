const request = require('supertest');
const { createApp } = require('../src/app');

const app = createApp();
let counter = 0;

/** A supertest agent that keeps cookies and sends the CSRF header on every request. */
async function newAgent() {
  const agent = request.agent(app);
  const res = await agent.get('/api/auth/csrf').expect(200);
  agent.set('X-CSRF-Token', res.body.data.csrfToken);
  return agent;
}

async function registeredAgent(overrides = {}) {
  counter += 1;
  const agent = await newAgent();
  const body = { name: `User ${counter}`, email: `user${counter}.${Date.now()}@example.test`, password: 'Passw0rd!', ...overrides };
  const res = await agent.post('/api/auth/register').send(body).expect(201);
  return { agent, user: res.body.data.user, credentials: body };
}

const today = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const tripPayload = (overrides = {}) => ({
  name: 'Test Trip',
  origin: { name: 'Louvre', coordinates: { lat: 48.8606, lng: 2.3376 } },
  destination: { name: 'Paris', coordinates: { lat: 48.8566, lng: 2.3522 } },
  startDate: today().toISOString(),
  endDate: new Date(today().getTime() + 2 * 86400000).toISOString(),
  timezone: 'UTC',
  travelers: 2,
  budget: 1000,
  currency: 'EUR',
  transportMode: 'walking',
  ...overrides,
});

async function createTrip(agent, overrides) {
  const res = await agent.post('/api/trips').send(tripPayload(overrides)).expect(201);
  return res.body.data;
}

const minutesFromNow = (m) => new Date(Date.now() + m * 60000).toISOString();

/** Owner + accepted participant with the given role. */
async function tripWithMember(role = 'editor', tripOverrides) {
  const owner = await registeredAgent();
  const member = await registeredAgent();
  const trip = await createTrip(owner.agent, tripOverrides);
  await owner.agent.post(`/api/trips/${trip._id}/invitations`).send({ email: member.credentials.email, role }).expect(201);
  await member.agent.post(`/api/invitations/${trip._id}/accept`).expect(200);
  return { owner, member, trip };
}

module.exports = { app, newAgent, registeredAgent, tripPayload, createTrip, minutesFromNow, tripWithMember, today };
