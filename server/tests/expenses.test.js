const { tripWithMember } = require('./helpers');
const { summarize } = require('../src/services/expenseService');

describe('expense calculations', () => {
  const trip = { currency: 'EUR', budget: 100, travelers: 3 };
  const members = [{ _id: 'a', name: 'A' }, { _id: 'b', name: 'B' }, { _id: 'c', name: 'C' }];

  test('totals, splits in cents and never mixes currencies without a rate', () => {
    const s = summarize({
      trip,
      members,
      items: [{ estimatedCost: 40, costCurrency: 'EUR', status: 'upcoming' }, { estimatedCost: 99, costCurrency: 'USD', status: 'upcoming' }, { estimatedCost: 10, status: 'cancelled' }],
      expenses: [
        { amount: 10, currency: 'EUR', category: 'food', paidBy: 'a', splitAmong: [] },
        { amount: 50, currency: 'USD', exchangeRate: 0.9, category: 'transport', paidBy: 'b', splitAmong: ['a', 'b'] },
        { amount: 20, currency: 'GBP', category: 'shopping', paidBy: 'c', splitAmong: [] },
      ],
    });
    expect(s.actual).toBe(55);
    expect(s.byCategory).toMatchObject({ food: 10, transport: 45, shopping: 0 });
    expect(s.unconverted).toEqual({ GBP: 20 });
    expect(s.planned).toBe(40);
    expect(s.plannedUnconvertedItems).toBe(1);
    expect(s.remaining).toBe(45);
    expect(s.utilization).toBe(55);
    const share = Object.fromEntries(s.members.map((m) => [m.userId, m.share]));
    expect(share.a + share.b + share.c).toBeCloseTo(55, 10);
    expect([share.a, share.b, share.c]).toEqual([25.84, 25.83, 3.33]);
    expect(s.members.find((m) => m.userId === 'b').balance).toBe(19.17);
    expect(s.warnings.map((w) => w.type)).toEqual(['unconverted']);
  });

  test('warns when spending or planned costs exceed the budget', () => {
    const s = summarize({ trip, members, items: [{ estimatedCost: 150, status: 'upcoming' }], expenses: [{ amount: 120, currency: 'EUR', category: 'food', paidBy: 'a' }] });
    expect(s.warnings.map((w) => w.type)).toEqual(expect.arrayContaining(['over_budget', 'planned_over_budget']));
    expect(s.remaining).toBe(-20);
  });
});

describe('expenses API', () => {
  test('editors record expenses; viewers only read; amounts are validated', async () => {
    const { owner, member: editor, trip } = await tripWithMember('editor');
    const base = { description: 'Taxi', category: 'transport', amount: 25.5, currency: 'EUR', expenseDate: new Date().toISOString() };

    await owner.agent.post(`/api/trips/${trip._id}/expenses`).send({ ...base, amount: 10.555 }).expect(422);
    await owner.agent.post(`/api/trips/${trip._id}/expenses`).send({ ...base, amount: -5 }).expect(422);
    await owner.agent.post(`/api/trips/${trip._id}/expenses`).send({ ...base, category: 'casino' }).expect(422);

    const created = await editor.agent.post(`/api/trips/${trip._id}/expenses`).send(base).expect(201);
    expect(created.body.data).toMatchObject({ amount: 25.5, paidBy: editor.user.id });
    await owner.agent.post(`/api/trips/${trip._id}/expenses`).send({ ...base, paidBy: '64b7f0c2a1b2c3d4e5f60718' }).expect(400);

    const updated = await owner.agent.patch(`/api/expenses/${created.body.data._id}`).send({ amount: 30 }).expect(200);
    expect(updated.body.data.amount).toBe(30);

    const summary = await owner.agent.get(`/api/trips/${trip._id}/expenses/summary`).expect(200);
    expect(summary.body.data).toMatchObject({ actual: 30, budget: 1000, remaining: 970, utilization: 3 });

    const list = await owner.agent.get(`/api/trips/${trip._id}/expenses?limit=1`).expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].paidBy.name).toBeDefined();

    const viewer = await tripWithMember('viewer');
    await viewer.member.agent.post(`/api/trips/${viewer.trip._id}/expenses`).send(base).expect(403);
    await viewer.member.agent.get(`/api/trips/${viewer.trip._id}/expenses`).expect(200);

    await owner.agent.delete(`/api/expenses/${created.body.data._id}`).expect(204);
  });
});
