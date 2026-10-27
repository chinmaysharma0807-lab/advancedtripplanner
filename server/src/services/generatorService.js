const providers = require('./providers');
const logger = require('../config/logger');
const { tripLengthDays, tripDayDate, zonedTimeToUtc } = require('../utils/time');

// Produces an editable itinerary DRAFT; nothing is saved until the user confirms.

const INTEREST_CATEGORIES = {
  food: 'food',
  cuisine: 'food',
  shopping: 'attractions',
  museums: 'indoor',
  museum: 'indoor',
  art: 'indoor',
  culture: 'attractions',
  history: 'attractions',
  nature: 'attractions',
  sightseeing: 'attractions',
};

const SLOTS = {
  relaxed: [
    ['09:00', '10:00', 'meal', 'Breakfast'],
    ['10:30', '12:30', 'sightseeing'],
    ['13:00', '14:15', 'meal', 'Lunch'],
    ['14:30', '16:00', 'rest', 'Rest & free time'],
    ['16:30', '18:30', 'sightseeing'],
    ['19:30', '21:00', 'meal', 'Dinner'],
  ],
  moderate: [
    ['08:30', '09:15', 'meal', 'Breakfast'],
    ['09:45', '11:45', 'sightseeing'],
    ['12:30', '13:30', 'meal', 'Lunch'],
    ['14:00', '15:45', 'sightseeing'],
    ['16:15', '17:45', 'sightseeing'],
    ['19:00', '20:30', 'meal', 'Dinner'],
  ],
  packed: [
    ['07:30', '08:15', 'meal', 'Breakfast'],
    ['08:45', '10:30', 'sightseeing'],
    ['11:00', '12:30', 'sightseeing'],
    ['12:45', '13:30', 'meal', 'Lunch'],
    ['14:00', '15:30', 'sightseeing'],
    ['16:00', '17:30', 'sightseeing'],
    ['18:00', '19:00', 'activity'],
    ['19:30', '21:00', 'meal', 'Dinner'],
  ],
};

const isOutdoorKind = (kind) => ['viewpoint', 'attraction', 'zoo', 'theme_park', 'monument', 'castle', 'ruins', 'fort', 'memorial'].includes(kind);

function toItem(trip, day, start, end, fields) {
  const date = tripDayDate(trip, day);
  return {
    day,
    scheduledStart: zonedTimeToUtc(date, start, trip.timezone),
    scheduledEnd: zonedTimeToUtc(date, end, trip.timezone),
    transportMode: trip.transportMode === 'flight' ? 'driving' : trip.transportMode,
    estimatedCost: 0,
    priority: 'medium',
    ...fields,
  };
}

async function templateDraft(trip, user, opts) {
  const days = opts.days;
  const center = trip.destination.coordinates;
  const pace = opts.pace;
  const warnings = [];
  const pools = { attractions: [], food: [], indoor: [] };
  let source = 'template';
  let isDemo = false;

  if (center) {
    const wanted = new Set(['attractions', 'food']);
    for (const interest of opts.interests) {
      const cat = INTEREST_CATEGORIES[interest.toLowerCase()];
      if (cat) wanted.add(cat);
    }
    for (const cat of wanted) {
      try {
        const found = await providers.places.nearby(center, cat, cat === 'food' ? 2500 : 6000);
        pools[cat] = found;
        source = `template:${found[0]?.source || providers.places.selectAdapter().name}`;
        isDemo = isDemo || found.some((p) => p.isDemo);
      } catch (err) {
        logger.warn('Places lookup failed during generation', { error: err.message });
        warnings.push(`Could not load ${cat} suggestions: ${err.message}`);
      }
    }
  } else {
    warnings.push('The destination has no coordinates, so no nearby places could be suggested.');
  }

  const dietary = (user.travelPreferences?.dietary || []).map((d) => d.toLowerCase());
  const food = [...pools.food].sort((a, b) => {
    const score = (p) => dietary.reduce((s, d) => s + (p.diet?.[d] === 'yes' || p.diet?.[d] === 'only' ? -1 : 0), 0);
    return score(a) - score(b);
  });
  const sights = [...pools.indoor, ...pools.attractions].filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i);
  let sightIdx = 0;
  let foodIdx = 0;
  const items = [];

  for (let day = 1; day <= days; day += 1) {
    for (const [start, end, category, label] of SLOTS[pace]) {
      if (category === 'meal') {
        const place = food[foodIdx % Math.max(food.length, 1)];
        foodIdx += 1;
        items.push(
          toItem(trip, day, start, end, {
            title: place ? `${label} at ${place.name}` : label,
            category: 'meal',
            location: place ? { name: place.name, address: place.address } : { name: trip.destination.name },
            coordinates: place?.coordinates || null,
            description: place?.cuisine ? `Cuisine: ${place.cuisine}` : '',
            operatingHours: null,
            notes: place?.openingHours ? `Opening hours (OpenStreetMap): ${place.openingHours}` : '',
            priority: 'low',
          })
        );
      } else if (category === 'rest') {
        items.push(toItem(trip, day, start, end, { title: label, category: 'rest', location: { name: trip.destination.name }, coordinates: null, priority: 'low' }));
      } else {
        const place = sights[sightIdx];
        sightIdx += 1;
        items.push(
          toItem(trip, day, start, end, {
            title: place ? place.name : `Explore ${trip.destination.name}`,
            category: place ? 'sightseeing' : 'activity',
            location: { name: place?.name || trip.destination.name, address: place?.address },
            coordinates: place?.coordinates || null,
            description: place ? `${place.kind.replace(/_/g, ' ')}${place.fee === 'yes' ? ' · entry fee' : ''}` : 'Pick a place to visit — no place data was available for this slot.',
            isOutdoor: place ? isOutdoorKind(place.kind) && !place.indoor : false,
            notes: place?.openingHours ? `Opening hours (OpenStreetMap): ${place.openingHours}` : '',
            links: place?.website && /^https?:\/\//.test(place.website) ? [{ label: 'Website', url: place.website }] : [],
          })
        );
      }
    }
  }

  const checkIn = trip.accommodation?.[0];
  if (checkIn) {
    items.push(
      toItem(trip, 1, '15:00', '15:30', {
        title: `Check in: ${checkIn.name}`,
        category: 'hotel_checkin',
        location: { name: checkIn.name, address: checkIn.address },
        coordinates: checkIn.coordinates || null,
        isFixedTime: true,
        priority: 'high',
        bookingReference: checkIn.confirmationNumber ? { code: checkIn.confirmationNumber } : {},
      })
    );
    // Make room for the check-in on day 1.
    const day1 = items.filter((i) => i.day === 1 && i.category !== 'hotel_checkin');
    const clash = day1.find((i) => i.scheduledStart < items[items.length - 1].scheduledEnd && items[items.length - 1].scheduledStart < i.scheduledEnd);
    if (clash) items.splice(items.indexOf(clash), 1);
  }

  if (sights.length && sightIdx > sights.length) warnings.push('Not enough distinct places were found for every slot; some days have generic "explore" slots.');
  return { items, source, isDemo, warnings };
}

async function aiDraft(trip, user, opts) {
  const adapter = providers.ai.selectAdapter();
  const result = await adapter.generateItinerary({
    destination: opts.destination || trip.destination.name,
    days: opts.days,
    budget: opts.budget ?? trip.budget,
    currency: trip.currency,
    interests: opts.interests,
    pace: opts.pace,
    travelers: trip.travelers,
    dietary: user.travelPreferences?.dietary || [],
  });
  const warnings = [];
  const items = [];
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const d of result.days || []) {
    if (d.day < 1 || d.day > opts.days) continue;
    for (const raw of d.items || []) {
      if (!hhmm.test(raw.startTime) || !hhmm.test(raw.endTime) || raw.endTime <= raw.startTime) continue;
      let coordinates = null;
      try {
        // Coordinates come from the geocoder, never from the language model.
        const [hit] = await providers.geocoding.search(`${raw.locationName}`);
        coordinates = hit?.coordinates || null;
      } catch {
        coordinates = null;
      }
      items.push(
        toItem(trip, d.day, raw.startTime, raw.endTime, {
          title: raw.title.slice(0, 200),
          description: raw.description.slice(0, 2000),
          category: raw.category,
          location: { name: raw.locationName.slice(0, 200) },
          coordinates,
          estimatedCost: Math.max(0, Math.round((raw.estimatedCost || 0) * (trip.travelers || 1) * 100) / 100),
          isOutdoor: Boolean(raw.isOutdoor),
          priority: raw.priority,
          notes: 'AI-generated suggestion — verify opening hours and prices before you go.',
          generatedBy: 'ai',
        })
      );
    }
  }
  if (items.some((i) => !i.coordinates)) warnings.push('Some suggested places could not be located on the map; add their locations before tracking.');
  return { items, source: result.source, isDemo: false, warnings };
}

async function generateDraft(trip, user, options = {}) {
  const opts = {
    days: Math.min(options.days || tripLengthDays(trip), 21),
    pace: options.pace || user.travelPreferences?.pace || 'moderate',
    interests: options.interests?.length ? options.interests : trip.interests?.length ? trip.interests : user.travelPreferences?.activities || [],
    budget: options.budget,
    destination: options.destination,
  };

  let draft = null;
  const warnings = [];
  if (providers.ai.selectAdapter().isConfigured()) {
    try {
      draft = await aiDraft(trip, user, opts);
      if (!draft.items.length) {
        warnings.push('The AI provider returned no usable activities; a template itinerary was generated instead.');
        draft = null;
      }
    } catch (err) {
      warnings.push(`AI generation unavailable (${err.message}); a template itinerary was generated instead.`);
    }
  }
  if (!draft) draft = await templateDraft(trip, user, opts);
  for (const item of draft.items) item.generatedBy = item.generatedBy || 'template';
  draft.items.sort((a, b) => a.day - b.day || a.scheduledStart - b.scheduledStart);
  return { ...draft, warnings: [...warnings, ...draft.warnings], days: opts.days, pace: opts.pace };
}

module.exports = { generateDraft, templateDraft };
