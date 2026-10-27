const { registeredAgent, createTrip } = require('./helpers');
const notificationService = require('../src/services/notificationService');
const { Notification, User } = require('../src/models');

describe('notifications', () => {
  test('deduplicates repeated and concurrent events', async () => {
    const { user } = await registeredAgent();
    const payload = { userId: user.id, type: 'activity_upcoming', title: 'Soon', message: 'Starts soon', dedupKey: 'upcoming:abc' };
    const first = await notificationService.notify(payload);
    const second = await notificationService.notify(payload);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const results = await Promise.all(Array.from({ length: 8 }, () => notificationService.notify({ ...payload, dedupKey: 'upcoming:race' })));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await Notification.countDocuments({ userId: user.id })).toBe(2);
  });

  test('honours per-category preferences', async () => {
    const { agent, user } = await registeredAgent();
    await agent.patch('/api/users/me').send({ notificationPreferences: { weather: false } }).expect(200);
    const r = await notificationService.notify({ userId: user.id, type: 'weather_alert', title: 'Rain', message: 'Rain', dedupKey: 'w1' });
    expect(r).toMatchObject({ created: false, suppressed: true });
    const ok = await notificationService.notify({ userId: user.id, type: 'eta_changed', title: 'ETA', message: 'Later', dedupKey: 'e1' });
    expect(ok.created).toBe(true);
  });

  test('lists, paginates and marks notifications as read for the owner only', async () => {
    const { agent, user } = await registeredAgent();
    const other = await registeredAgent();
    const trip = await createTrip(agent);
    for (let i = 0; i < 3; i += 1) {
      await notificationService.notify({ userId: user.id, tripId: trip._id, type: 'booking_reminder', title: `B${i}`, message: 'm', dedupKey: `b${i}` });
    }
    const page = await agent.get('/api/notifications?limit=2').expect(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ total: 3, unreadCount: 3, totalPages: 2 });
    expect(page.body.data[0]).toEqual(expect.objectContaining({ type: 'booking_reminder', tripId: trip._id, readAt: null }));
    expect(page.body.data[0].createdAt).toBeDefined();

    const id = page.body.data[0]._id;
    await other.agent.patch(`/api/notifications/${id}/read`).expect(404);
    const read = await agent.patch(`/api/notifications/${id}/read`).expect(200);
    expect(read.body.data.readAt).not.toBeNull();
    const again = await agent.patch(`/api/notifications/${id}/read`).expect(200);
    expect(again.body.data.readAt).toBe(read.body.data.readAt);

    await agent.patch('/api/notifications/read-all').expect(200);
    const unread = await agent.get('/api/notifications?unread=true').expect(200);
    expect(unread.body.meta.unreadCount).toBe(0);
  });

  test('collaborator edits notify other members once', async () => {
    const owner = await registeredAgent();
    const editor = await registeredAgent();
    const trip = await createTrip(owner.agent);
    await owner.agent.post(`/api/trips/${trip._id}/invitations`).send({ email: editor.credentials.email, role: 'editor' }).expect(201);
    expect(await Notification.countDocuments({ userId: editor.user.id, type: 'invitation' })).toBe(1);
    await editor.agent.post(`/api/invitations/${trip._id}/accept`).expect(200);
    await editor.agent
      .post(`/api/trips/${trip._id}/itinerary`)
      .send({ title: 'Picnic', scheduledStart: new Date(Date.now() + 3600000).toISOString(), scheduledEnd: new Date(Date.now() + 7200000).toISOString() })
      .expect(201);
    const ownerNotes = await Notification.find({ userId: owner.user.id, type: 'collaborator_change' });
    expect(ownerNotes.map((n) => n.message).join(' ')).toMatch(/added "Picnic"/);
    expect(await Notification.countDocuments({ userId: editor.user.id, type: 'collaborator_change', message: /Picnic/ })).toBe(0);
    expect(await User.countDocuments()).toBeGreaterThan(0);
  });
});
