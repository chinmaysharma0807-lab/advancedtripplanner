const providers = require('./providers');
const { badRequest } = require('../utils/errors');
const { localTimeOfDay, hhmmToMinutes } = require('../utils/time');

// Parses the simplest OpenStreetMap opening_hours forms only ("24/7", "Mo-Su 09:00-18:00",
// "09:00-18:00"). Anything more complex is returned raw and treated as unknown.
function parseSimpleHours(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (s === '24/7') return { open: '00:00', close: '23:59', allWeek: true };
  const m = s.match(/^(?:Mo-Su\s+)?([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-4]):([0-5]\d)$/);
  if (!m) return null;
  const close = m[3] === '24' ? '23:59' : `${m[3]}:${m[4]}`;
  return { open: `${m[1]}:${m[2]}`, close, allWeek: true };
}

function openNow(hours, timezone) {
  if (!hours) return null;
  const now = hhmmToMinutes(localTimeOfDay(new Date(), timezone));
  const open = hhmmToMinutes(hours.open);
  const close = hhmmToMinutes(hours.close);
  return close > open ? now >= open && now < close : now >= open || now < close;
}

const BUDGET_KINDS = { budget: ['hostel', 'guest_house', 'fast_food', 'cafe'], luxury: ['hotel', 'restaurant'] };

async function recommend(trip, user, { lat, lng, category = 'attractions', radius = 1500 }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw badRequest('A location is required for recommendations');
  if (!providers.places.CATEGORIES[category]) throw badRequest('Unknown recommendation category');
  let places;
  try {
    places = await providers.places.nearby({ lat, lng }, category, radius);
  } catch (err) {
    return { available: false, reason: `Places data unavailable: ${err.message}`, items: [] };
  }
  const dietary = (user.travelPreferences?.dietary || []).map((d) => d.toLowerCase());
  const interests = [...(user.travelPreferences?.activities || []), ...(trip.interests || [])].map((i) => i.toLowerCase());
  const budgetLevel = user.travelPreferences?.budgetLevel || 'moderate';

  const items = places
    .filter((p) => p.distance <= radius)
    .map((p) => {
      const hours = parseSimpleHours(p.openingHours);
      const reasons = [];
      let score = -p.distance / 100;
      const dietMatch = dietary.filter((d) => p.diet?.[d] === 'yes' || p.diet?.[d] === 'only');
      if (dietMatch.length) {
        score += 5;
        reasons.push(`Offers ${dietMatch.join(', ')} options`);
      }
      if (interests.some((i) => p.kind?.includes(i) || p.cuisine?.includes(i))) {
        score += 3;
        reasons.push('Matches your interests');
      }
      if ((BUDGET_KINDS[budgetLevel] || []).includes(p.kind)) score += 1;
      const isOpen = openNow(hours, trip.timezone);
      if (isOpen === false) score -= 4;
      return { ...p, parsedHours: hours, openNow: isOpen, score: Math.round(score * 10) / 10, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);

  return {
    available: true,
    items,
    source: items[0]?.source || providers.places.selectAdapter().name,
    isDemo: items.some((i) => i.isDemo),
    fetchedAt: new Date().toISOString(),
    note: 'Opening hours come from OpenStreetMap where available and may be incomplete.',
  };
}

module.exports = { recommend, parseSimpleHours, openNow };
