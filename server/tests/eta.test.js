const { buildProposal } = require('../src/services/rescheduleService');

const at = (h, m = 0) => new Date(Date.UTC(2026, 5, 1, h, m));
const item = (id, start, end, extra = {}) => ({ _id: id, title: id, scheduledStart: start, scheduledEnd: end, status: 'upcoming', priority: 'medium', estimatedTravelTime: 10, ...extra });

describe('delay recalculation', () => {
  test('absorbs small delays using slack in the schedule', () => {
    const dayItems = [item('a', at(10), at(11)), item('b', at(12), at(13))];
    const p = buildProposal({ dayItems, trigger: dayItems[0], expectedArrival: at(10, 20) });
    expect(p.delayMinutes).toBe(20);
    expect(p.changes).toEqual([expect.objectContaining({ itemId: 'a', action: 'shift', proposedStart: at(10, 20), proposedEnd: at(11, 20) })]);
  });

  test('cascades a long delay, keeps fixed bookings and must-do items, skips what no longer fits', () => {
    const dayItems = [
      item('a', at(9), at(10)),
      item('b', at(10, 15), at(11, 15), { priority: 'low' }),
      item('c', at(12), at(13), { isFixedTime: true }),
      item('d', at(14), at(16), { priority: 'must', operatingHours: { open: '09:00', close: '16:30' } }),
      item('e', at(16, 30), at(17, 30), { operatingHours: { open: '09:00', close: '17:00' } }),
      item('done', at(8), at(8, 30), { status: 'completed' }),
    ];
    const p = buildProposal({ dayItems, trigger: dayItems[0], expectedArrival: at(10, 45), timezone: 'UTC' });
    const byId = Object.fromEntries(p.changes.map((c) => [c.itemId, c]));
    expect(p.delayMinutes).toBe(105);
    expect(byId.a).toMatchObject({ action: 'shift', proposedStart: at(10, 45) });
    expect(byId.b.action).toBe('skip'); // would collide with the fixed booking at 12:00
    expect(byId.c.action).toBe('keep');
    expect(byId.d).toBeUndefined(); // starts after the booking, no change needed
    expect(byId.done).toBeUndefined();
    expect(p.warnings).toHaveLength(0);
  });

  test('warns when a fixed booking itself is at risk and never moves it', () => {
    const dayItems = [item('a', at(9), at(10), { priority: 'high' }), item('c', at(10, 30), at(11), { isFixedTime: true })];
    const p = buildProposal({ dayItems, trigger: dayItems[0], expectedArrival: at(10) });
    expect(p.changes.find((c) => c.itemId === 'c')).toMatchObject({ action: 'keep', proposedStart: at(10, 30) });
    expect(p.warnings.some((w) => /"c" is a fixed-time booking/.test(w))).toBe(true);
  });

  test('keeps high-priority activities even past closing time, with a warning', () => {
    const dayItems = [item('a', at(15), at(16), { priority: 'high', operatingHours: { open: '09:00', close: '16:30' } })];
    const p = buildProposal({ dayItems, trigger: dayItems[0], expectedArrival: at(16), timezone: 'UTC' });
    expect(p.changes[0].action).toBe('shift');
    expect(p.warnings[0]).toMatch(/closing time/);
  });
});
