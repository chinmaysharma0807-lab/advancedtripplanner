const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const addMinutes = (date, minutes) => new Date(new Date(date).getTime() + minutes * MINUTE);
const diffMinutes = (a, b) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / MINUTE);

/** "HH:MM" wall-clock time of `date` in an IANA time zone. */
function localTimeOfDay(date, timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(date));
  } catch {
    return new Date(date).toISOString().slice(11, 16);
  }
}

/** "YYYY-MM-DD" calendar date of `date` in an IANA time zone. */
function localDate(date, timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(date)
    );
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
}

const hhmmToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const startOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const endOfUtcDay = (date) => {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

/** Offset (ms) of an IANA time zone from UTC at a given instant. */
function tzOffsetMs(date, timeZone = 'UTC') {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(new Date(date))
        .map((p) => [p.type, p.value])
    );
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - Math.floor(new Date(date).getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** UTC instant for a wall-clock "YYYY-MM-DD" + "HH:MM" in an IANA time zone. */
function zonedTimeToUtc(dateStr, hhmm, timeZone = 'UTC') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - tzOffsetMs(guess, timeZone);
  utc = guess - tzOffsetMs(utc, timeZone); // second pass handles DST boundaries
  return new Date(utc);
}

/** "YYYY-MM-DD" of trip day `day` (1-based). Trip dates are stored as UTC midnights. */
function tripDayDate(trip, day) {
  return new Date(startOfUtcDay(trip.startDate).getTime() + (day - 1) * DAY).toISOString().slice(0, 10);
}

/** 1-based trip day index for a timestamp, using the trip's local calendar. */
function tripDayFor(trip, date) {
  const local = Date.parse(`${localDate(date, trip.timezone || 'UTC')}T00:00:00Z`);
  const start = startOfUtcDay(trip.startDate).getTime();
  return Math.max(1, Math.floor((local - start) / DAY) + 1);
}

function tripLengthDays(trip) {
  return Math.max(1, Math.round((startOfUtcDay(trip.endDate) - startOfUtcDay(trip.startDate)) / DAY) + 1);
}

module.exports = {
  MINUTE,
  HOUR,
  DAY,
  addMinutes,
  diffMinutes,
  localTimeOfDay,
  localDate,
  hhmmToMinutes,
  startOfUtcDay,
  endOfUtcDay,
  tripDayFor,
  tripDayDate,
  tzOffsetMs,
  zonedTimeToUtc,
  tripLengthDays,
};
