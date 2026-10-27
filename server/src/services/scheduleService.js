const { MAX_SPEED_KMH } = require('../config/constants');
const { haversine } = require('../utils/geo');
const { localTimeOfDay, hhmmToMinutes, MINUTE } = require('../utils/time');

// Pure schedule analysis: no database or network access, so it is easy to test.

const IGNORED = new Set(['cancelled', 'skipped']);

const overlaps = (a, b) => new Date(a.scheduledStart) < new Date(b.scheduledEnd) && new Date(b.scheduledStart) < new Date(a.scheduledEnd);

/** Items whose time window overlaps `candidate` (excluding itself and cancelled/skipped items). */
function findOverlaps(candidate, items) {
  return items.filter(
    (i) => String(i._id) !== String(candidate._id || '') && !IGNORED.has(i.status) && overlaps(candidate, i)
  );
}

/**
 * Warnings for a set of itinerary items:
 *   overlap                – two activities share time
 *   insufficient_transfer  – the gap is shorter than the estimated travel time
 *   unrealistic_travel     – the implied speed exceeds what the transport mode allows
 *   outside_hours          – scheduled outside known operating hours
 */
function analyzeSchedule(items, { timezone = 'UTC' } = {}) {
  const active = items
    .filter((i) => !IGNORED.has(i.status))
    .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
  const warnings = [];

  for (let i = 1; i < active.length; i += 1) {
    const prev = active[i - 1];
    const next = active[i];
    const gapMin = (new Date(next.scheduledStart) - new Date(prev.scheduledEnd)) / MINUTE;

    if (gapMin < 0) {
      warnings.push({
        type: 'overlap',
        severity: next.conflictAcknowledged ? 'warning' : 'error',
        acknowledged: Boolean(next.conflictAcknowledged),
        itemId: String(next._id),
        otherItemId: String(prev._id),
        message: `"${next.title}" starts ${Math.round(-gapMin)} min before "${prev.title}" ends.`,
      });
      continue;
    }

    const travel = next.estimatedTravelTime;
    if (Number.isFinite(travel) && travel > gapMin) {
      warnings.push({
        type: 'insufficient_transfer',
        severity: 'warning',
        itemId: String(next._id),
        otherItemId: String(prev._id),
        message: `Only ${Math.round(gapMin)} min between "${prev.title}" and "${next.title}", but travel takes about ${Math.round(travel)} min.`,
        travelSource: next.travelSource || null,
      });
    } else if (prev.coordinates && next.coordinates) {
      const km = haversine(prev.coordinates, next.coordinates) / 1000;
      const maxKmh = MAX_SPEED_KMH[next.transportMode] || MAX_SPEED_KMH.driving;
      const hours = Math.max(gapMin, 1) / 60;
      if (km > 0.3 && km / hours > maxKmh) {
        warnings.push({
          type: 'unrealistic_travel',
          severity: 'warning',
          itemId: String(next._id),
          otherItemId: String(prev._id),
          message: `"${next.title}" is ${km.toFixed(1)} km from "${prev.title}" with only ${Math.round(gapMin)} min to get there by ${next.transportMode}.`,
        });
      }
    }
  }

  for (const item of active) {
    const hours = item.operatingHours;
    if (!hours?.open || !hours?.close) continue;
    const open = hhmmToMinutes(hours.open);
    const close = hhmmToMinutes(hours.close);
    if (close <= open) continue; // overnight hours: not evaluated
    const start = hhmmToMinutes(localTimeOfDay(item.scheduledStart, timezone));
    const endRaw = hhmmToMinutes(localTimeOfDay(item.scheduledEnd, timezone));
    const end = endRaw < start ? endRaw + 24 * 60 : endRaw;
    if (start < open || end > close) {
      warnings.push({
        type: 'outside_hours',
        severity: 'warning',
        itemId: String(item._id),
        message: `"${item.title}" is scheduled ${localTimeOfDay(item.scheduledStart, timezone)}–${localTimeOfDay(item.scheduledEnd, timezone)} but is open ${hours.open}–${hours.close}${hours.source ? ` (source: ${hours.source})` : ''}.`,
      });
    }
  }

  return warnings;
}

/**
 * Re-time non-fixed items so they follow `ordered` back-to-back from the first item's start,
 * leaving fixed-time reservations where they are. Returns [{ item, scheduledStart, scheduledEnd }].
 */
function reflow(ordered) {
  if (!ordered.length) return [];
  const earliest = Math.min(...ordered.map((i) => new Date(i.scheduledStart).getTime()));
  let cursor = earliest;
  return ordered.map((item, index) => {
    const start = new Date(item.scheduledStart).getTime();
    const duration = new Date(item.scheduledEnd).getTime() - start;
    if (IGNORED.has(item.status) || item.status === 'completed' || item.status === 'in_progress') {
      cursor = Math.max(cursor, new Date(item.scheduledEnd).getTime());
      return { item, scheduledStart: new Date(start), scheduledEnd: new Date(item.scheduledEnd) };
    }
    if (item.isFixedTime) {
      cursor = Math.max(cursor, new Date(item.scheduledEnd).getTime());
      return { item, scheduledStart: new Date(start), scheduledEnd: new Date(item.scheduledEnd) };
    }
    const travelMs = index === 0 ? 0 : (item.estimatedTravelTime || 0) * MINUTE;
    const newStart = cursor + travelMs;
    cursor = newStart + duration;
    return { item, scheduledStart: new Date(newStart), scheduledEnd: new Date(newStart + duration) };
  });
}

module.exports = { analyzeSchedule, findOverlaps, overlaps, reflow };
