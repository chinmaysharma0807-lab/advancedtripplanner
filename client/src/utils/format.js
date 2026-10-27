// Formatting helpers. Times are always shown in the trip's time zone so every collaborator
// sees the same schedule regardless of where they are.

const safeTz = (tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
};

export function formatTime(date, tz) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: safeTz(tz) }).format(new Date(date));
}

export function formatDate(date, tz, opts = {}) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: safeTz(tz), ...opts }).format(new Date(date));
}

export function formatDateRange(start, end) {
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${fmt.format(new Date(start))} – ${fmt.format(new Date(end))}`;
}

export function formatDateTime(date, tz) {
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: safeTz(tz) }).format(new Date(date));
}

export function timeAgo(date) {
  if (!date) return 'never';
  const s = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined || Number.isNaN(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export function formatMoney(amount, currency = 'INR') {
  if (amount === null || amount === undefined) return '—';
  try {
    // Indian digit grouping (₹1,20,000) for rupees; the browser's locale otherwise.
    const locale = currency === 'INR' ? 'en-IN' : undefined;
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Offset of `tz` from UTC (ms) at instant `date`. */
function tzOffset(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz) || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(new Date(date).getTime() / 1000) * 1000;
}

/** "YYYY-MM-DDTHH:MM" wall time in `tz` → ISO UTC string. */
export function zonedInputToIso(value, tz) {
  if (!value) return null;
  const [d, t] = value.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let utc = guess - tzOffset(guess, tz);
  utc = guess - tzOffset(utc, tz);
  return new Date(utc).toISOString();
}

/** ISO instant → "YYYY-MM-DDTHH:MM" wall time in `tz` (for datetime-local inputs). */
export function isoToZonedInput(iso, tz) {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() + tzOffset(date, tz));
  return local.toISOString().slice(0, 16);
}

/** Calendar date of trip day N ("YYYY-MM-DD"). Trip dates are UTC midnights. */
export function tripDayDate(trip, day) {
  const start = new Date(trip.startDate);
  start.setUTCHours(0, 0, 0, 0);
  return new Date(start.getTime() + (day - 1) * 86400000).toISOString().slice(0, 10);
}

export function tripLengthDays(trip) {
  const s = new Date(trip.startDate).setUTCHours(0, 0, 0, 0);
  const e = new Date(trip.endDate).setUTCHours(0, 0, 0, 0);
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

export const toDateInput = (date) => (date ? new Date(date).toISOString().slice(0, 10) : '');
