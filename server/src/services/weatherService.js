const { ItineraryItem } = require('../models');
const providers = require('./providers');
const notificationService = require('./notificationService');
const realtime = require('../sockets/realtime');
const logger = require('../config/logger');
const { localDate, startOfUtcDay, endOfUtcDay, DAY } = require('../utils/time');

const SEVERE_CODES = new Set([95, 96, 99, 75, 86, 67, 82]);
const WET_CODES = new Set([61, 63, 65, 66, 80, 81, 71, 73, 85, 56, 57, 55]);
const FORECAST_HORIZON_DAYS = 15;

/** Classify the forecast hour nearest an activity. Returns null when conditions are fine. */
function assess(hour) {
  if (!hour) return null;
  if (SEVERE_CODES.has(hour.weatherCode) || hour.windSpeed >= 60) {
    return { severity: 'severe', summary: `${providers.weather.describe(hour.weatherCode)}${hour.windSpeed >= 60 ? `, wind ${Math.round(hour.windSpeed)} km/h` : ''}` };
  }
  if (hour.precipitationProbability >= 70 || (WET_CODES.has(hour.weatherCode) && hour.precipitationProbability >= 50)) {
    return { severity: 'warning', summary: `${providers.weather.describe(hour.weatherCode)}, ${hour.precipitationProbability}% chance of precipitation` };
  }
  if (hour.precipitationProbability >= 40 || hour.windSpeed >= 40) {
    return { severity: 'info', summary: `${providers.weather.describe(hour.weatherCode)}, ${hour.precipitationProbability}% chance of precipitation` };
  }
  return null;
}

function nearestHour(hourly, when) {
  const target = new Date(when).getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const h of hourly) {
    const d = Math.abs(new Date(h.time).getTime() - target);
    if (d < bestDiff) {
      best = h;
      bestDiff = d;
    }
  }
  return bestDiff <= 90 * 60 * 1000 ? best : null;
}

/** Current conditions and trip-date forecast for each destination with coordinates. */
async function tripWeather(trip) {
  const places = [trip.destination, ...(trip.intermediateStops || [])].filter((p) => p?.coordinates);
  const start = startOfUtcDay(trip.startDate);
  const end = endOfUtcDay(trip.endDate);
  return Promise.all(
    places.map(async (place) => {
      try {
        const f = await providers.weather.forecast(place.coordinates);
        const daily = f.daily.filter((d) => {
          const t = Date.parse(`${d.date}T12:00:00Z`);
          return t >= start.getTime() && t <= end.getTime();
        });
        const horizonEnd = Date.now() + FORECAST_HORIZON_DAYS * DAY;
        return {
          place: { name: place.name, coordinates: place.coordinates },
          available: true,
          current: f.current,
          daily,
          tripDatesCovered: start.getTime() <= horizonEnd,
          note: start.getTime() > horizonEnd ? 'Trip dates are beyond the forecast range; check back closer to departure.' : null,
          units: f.units,
          source: f.source,
          isDemo: f.isDemo,
          fetchedAt: f.fetchedAt,
        };
      } catch (err) {
        return { place: { name: place.name }, available: false, reason: `Weather unavailable: ${err.message}` };
      }
    })
  );
}

/**
 * Flag outdoor activities in the forecast window. Leaves existing flags untouched when the
 * provider is unavailable (no data is invented) and notifies members about warnings once.
 */
async function flagTripItems(trip) {
  const now = Date.now();
  const items = await ItineraryItem.find({
    tripId: trip._id,
    isOutdoor: true,
    coordinates: { $exists: true },
    status: { $in: ['upcoming', 'approaching', 'delayed'] },
    scheduledStart: { $gte: new Date(now - 60 * 60 * 1000), $lte: new Date(now + FORECAST_HORIZON_DAYS * DAY) },
  });
  let flagged = 0;
  let failed = 0;
  for (const item of items) {
    let forecast;
    try {
      forecast = await providers.weather.forecast(item.coordinates);
    } catch (err) {
      failed += 1;
      logger.warn('Weather check failed', { error: err.message });
      continue;
    }
    const hour = nearestHour(forecast.hourly, item.scheduledStart);
    const result = assess(hour);
    if (!result) {
      if (item.weatherFlag?.severity) {
        item.weatherFlag = undefined;
        await item.save();
        realtime.emitToTrip(trip._id, 'itinerary_updated', { action: 'weather', itemId: String(item._id) });
      }
      continue;
    }
    const changed = item.weatherFlag?.severity !== result.severity || item.weatherFlag?.summary !== result.summary;
    item.weatherFlag = { ...result, source: forecast.source, isDemo: forecast.isDemo, forecastFor: hour.time, updatedAt: new Date(forecast.fetchedAt) };
    await item.save();
    flagged += 1;
    if (changed) realtime.emitToTrip(trip._id, 'itinerary_updated', { action: 'weather', itemId: String(item._id) });
    if (result.severity !== 'info') {
      await notificationService.notifyTripMembers(trip, {
        type: 'weather_alert',
        severity: result.severity === 'severe' ? 'critical' : 'warning',
        title: `Weather may affect ${item.title}`,
        message: `${result.summary} expected around the planned time${forecast.isDemo ? ' (DEMO forecast)' : ` (source: ${forecast.source})`}. Consider an indoor alternative or a different time.`,
        data: { itemId: String(item._id) },
        dedupKey: `weather:${item._id}:${result.severity}:${localDate(item.scheduledStart, trip.timezone)}`,
      });
    }
  }
  return { checked: items.length, flagged, failed };
}

module.exports = { tripWeather, flagTripItems, assess, nearestHour };
