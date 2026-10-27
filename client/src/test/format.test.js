import { describe, expect, test } from 'vitest';
import { zonedInputToIso, isoToZonedInput, formatDistance, formatDuration, formatMoney, tripLengthDays, tripDayDate } from '../utils/format';

describe('time zone helpers', () => {
  test('round-trips datetime-local values through a trip time zone', () => {
    expect(zonedInputToIso('2026-11-02T09:30', 'Asia/Kolkata')).toBe('2026-11-02T04:00:00.000Z');
    expect(isoToZonedInput('2026-11-02T04:00:00.000Z', 'Asia/Kolkata')).toBe('2026-11-02T09:30');
    expect(zonedInputToIso('2026-07-01T18:00', 'Europe/Paris')).toBe('2026-07-01T16:00:00.000Z');
  });

  test('computes trip days from UTC-midnight dates', () => {
    const trip = { startDate: '2026-05-01T00:00:00.000Z', endDate: '2026-05-03T00:00:00.000Z' };
    expect(tripLengthDays(trip)).toBe(3);
    expect(tripDayDate(trip, 3)).toBe('2026-05-03');
  });
});

describe('formatting', () => {
  test('distances and durations', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(2345)).toBe('2.3 km');
    expect(formatDistance(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(135)).toBe('2 h 15 min');
  });

  test('rupees use Indian digit grouping and are the default currency', () => {
    expect(formatMoney(120000, 'INR')).toBe('₹1,20,000.00');
    expect(formatMoney(3550.5)).toBe('₹3,550.50');
  });
});
