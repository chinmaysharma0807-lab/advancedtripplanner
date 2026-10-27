const request = require('supertest');
const { app, newAgent, registeredAgent } = require('./helpers');

describe('authentication', () => {
  test('registers, sets an HTTP-only cookie and returns the profile', async () => {
    const agent = await newAgent();
    const res = await agent.post('/api/auth/register').send({ name: 'Ada', email: 'ada@example.test', password: 'Secr3tpass' }).expect(201);
    expect(res.body.data.user).toMatchObject({ name: 'Ada', email: 'ada@example.test' });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('ts_token='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data.user.email).toBe('ada@example.test');
  });

  test('rejects duplicate emails and weak passwords', async () => {
    const { credentials } = await registeredAgent();
    const agent = await newAgent();
    const dup = await agent.post('/api/auth/register').send({ ...credentials, name: 'Other' }).expect(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
    const weak = await agent.post('/api/auth/register').send({ name: 'W', email: 'weak@example.test', password: 'short' }).expect(422);
    expect(weak.body.error.details[0].path).toBe('body.password');
  });

  test('logs in with valid credentials and rejects invalid ones with the same message', async () => {
    const { credentials } = await registeredAgent();
    const agent = await newAgent();
    await agent.post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
    const wrongPass = await (await newAgent()).post('/api/auth/login').send({ email: credentials.email, password: 'nope-nope1' }).expect(401);
    const noUser = await (await newAgent()).post('/api/auth/login').send({ email: 'ghost@example.test', password: 'nope-nope1' }).expect(401);
    expect(wrongPass.body.error.message).toBe(noUser.body.error.message);
  });

  test('protected routes require a session', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/trips').expect(401);
    await request(app).get('/api/auth/me').set('Cookie', 'ts_token=forged.jwt.value').expect(401);
  });

  test('state-changing requests require the CSRF token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@example.test', password: 'x' }).expect(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  test('rejects operator injection in the login body', async () => {
    const agent = await newAgent();
    await agent.post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } }).expect(422);
  });

  test('logout clears the cookie; logout-all revokes other sessions', async () => {
    const { agent, credentials } = await registeredAgent();
    const second = await newAgent();
    await second.post('/api/auth/login').send({ email: credentials.email, password: credentials.password }).expect(200);
    await second.get('/api/auth/me').expect(200);

    await agent.post('/api/auth/logout-all').expect(200);
    await agent.get('/api/auth/me').expect(401);
    await second.get('/api/auth/me').expect(401);
  });

  test('updates travel and notification preferences', async () => {
    const { agent } = await registeredAgent();
    const res = await agent
      .patch('/api/users/me')
      .send({ travelPreferences: { pace: 'relaxed', dietary: ['vegan'], currency: 'inr' }, notificationPreferences: { weather: false } })
      .expect(200);
    expect(res.body.data.user.travelPreferences).toMatchObject({ pace: 'relaxed', dietary: ['vegan'], currency: 'INR' });
    expect(res.body.data.user.notificationPreferences.weather).toBe(false);
    expect(res.body.data.user.notificationPreferences.eta).toBe(true);
  });

  test('changing the password keeps the current session and requires the old password', async () => {
    const { agent, credentials } = await registeredAgent();
    await agent.post('/api/users/me/password').send({ currentPassword: 'wrong-pass1', newPassword: 'N3wpassword' }).expect(400);
    await agent.post('/api/users/me/password').send({ currentPassword: credentials.password, newPassword: 'N3wpassword' }).expect(200);
    await agent.get('/api/auth/me').expect(200);
    await (await newAgent()).post('/api/auth/login').send({ email: credentials.email, password: 'N3wpassword' }).expect(200);
  });
});
