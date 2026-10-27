/* eslint-disable no-console */
// Seeds sample users, trips, itineraries and expenses for local testing.
// Usage: npm run seed            (adds sample data; removes previous sample data first)
//        npm run seed -- --reset (drops the whole database first)
//
// Sample accounts (local test credentials only):
//   alice@tripsync.test / TripSync123   – owner of the sample trips
//   bob@tripsync.test   / TripSync123   – editor on the Paris trip
//   chen@tripsync.test  / TripSync123   – viewer on the Paris trip

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { connectDatabase, disconnectDatabase } = require('../config/db');
const { User, Trip, ItineraryItem, Expense, ItineraryChangeLog, Notification, TrackingSession, LocationUpdate, RescheduleProposal, ShareLink } = require('../models');
const itineraryService = require('../services/itineraryService');
const { MINUTE, HOUR, DAY, startOfUtcDay, tripDayFor, zonedTimeToUtc, tripDayDate } = require('../utils/time');

const PASSWORD = 'TripSync123';
const SAMPLE_EMAILS = ['alice@tripsync.test', 'bob@tripsync.test', 'chen@tripsync.test'];

const roundTo15 = (ms) => Math.round(ms / (15 * MINUTE)) * 15 * MINUTE;

async function clearSampleData() {
  const users = await User.find({ email: { $in: SAMPLE_EMAILS } }).select('_id');
  const userIds = users.map((u) => u._id);
  const trips = await Trip.find({ $or: [{ ownerId: { $in: userIds } }, { isDemo: true }] }).select('_id');
  const tripIds = trips.map((t) => t._id);
  await Promise.all([
    ItineraryItem.deleteMany({ tripId: { $in: tripIds } }),
    Expense.deleteMany({ tripId: { $in: tripIds } }),
    ItineraryChangeLog.deleteMany({ tripId: { $in: tripIds } }),
    TrackingSession.deleteMany({ tripId: { $in: tripIds } }),
    LocationUpdate.deleteMany({ $or: [{ tripId: { $in: tripIds } }, { userId: { $in: userIds } }] }),
    RescheduleProposal.deleteMany({ tripId: { $in: tripIds } }),
    ShareLink.deleteMany({ tripId: { $in: tripIds } }),
    Notification.deleteMany({ userId: { $in: userIds } }),
  ]);
  await Trip.deleteMany({ _id: { $in: tripIds } });
  await User.deleteMany({ _id: { $in: userIds } });
}

async function createUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [alice, bob, chen] = await User.create([
    {
      name: 'Alice Traveller',
      email: SAMPLE_EMAILS[0],
      passwordHash,
      travelPreferences: { budgetLevel: 'moderate', activities: ['museums', 'food', 'history'], dietary: ['vegetarian'], transport: 'walking', pace: 'moderate', currency: 'INR' },
    },
    { name: 'Bob Navigator', email: SAMPLE_EMAILS[1], passwordHash, travelPreferences: { transport: 'driving', pace: 'packed', currency: 'INR' } },
    { name: 'Chen Follower', email: SAMPLE_EMAILS[2], passwordHash },
  ]);
  return { alice, bob, chen };
}

function item(fields) {
  return { transportMode: 'walking', status: 'upcoming', priority: 'medium', estimatedCost: 0, costCurrency: 'INR', ...fields };
}

async function createParisTrip({ alice, bob, chen }) {
  const now = Date.now();
  const trip = await Trip.create({
    ownerId: alice._id,
    name: 'Paris Long Weekend',
    description: 'Museums, food and the Seine. Sample trip: today is day 1 so live tracking can be tried immediately.',
    origin: { name: 'Paris Gare du Nord', address: '18 Rue de Dunkerque, 75010 Paris', coordinates: { lat: 48.8809, lng: 2.3553 } },
    destination: { name: 'Paris, France', coordinates: { lat: 48.8566, lng: 2.3522 } },
    intermediateStops: [{ name: 'Montmartre', coordinates: { lat: 48.8867, lng: 2.3431 } }],
    startDate: startOfUtcDay(new Date(now)),
    endDate: startOfUtcDay(new Date(now + 2 * DAY)),
    timezone: 'Europe/Paris',
    travelers: 2,
    budget: 120000,
    currency: 'INR',
    transportMode: 'walking',
    interests: ['museums', 'food', 'history'],
    visibility: 'shared',
    accommodation: [
      {
        name: 'Hôtel des Grands Boulevards',
        address: '17 Boulevard Poissonnière, 75002 Paris',
        coordinates: { lat: 48.8713, lng: 2.3446 },
        checkIn: new Date(startOfUtcDay(new Date(now)).getTime() + 14 * HOUR),
        checkOut: new Date(startOfUtcDay(new Date(now + 2 * DAY)).getTime() + 10 * HOUR),
        confirmationNumber: 'SAMPLE-HGB-4821',
      },
    ],
    participants: [
      { userId: bob._id, role: 'editor', status: 'accepted', invitedBy: alice._id, joinedAt: new Date() },
      { userId: chen._id, role: 'viewer', status: 'accepted', invitedBy: alice._id, joinedAt: new Date() },
    ],
    isDemo: true,
  });

  // Today's items are relative to "now" so the progress engine has something to work on.
  const t = (offsetMin) => new Date(roundTo15(now) + offsetMin * MINUTE);
  const today = tripDayFor(trip, new Date(now));
  const at = (day, hhmm) => zonedTimeToUtc(tripDayDate(trip, day), hhmm, trip.timezone);
  const items = [
    item({ day: today, title: 'Breakfast at Café de Flore', category: 'meal', location: { name: 'Café de Flore', address: '172 Bd Saint-Germain' }, coordinates: { lat: 48.854, lng: 2.3326 }, scheduledStart: t(-240), scheduledEnd: t(-195), status: 'completed', estimatedCost: 3500 }),
    item({ day: today, title: 'Louvre Museum', category: 'sightseeing', location: { name: 'Musée du Louvre', address: 'Rue de Rivoli' }, coordinates: { lat: 48.8606, lng: 2.3376 }, scheduledStart: t(-165), scheduledEnd: t(-45), status: 'completed', isFixedTime: true, priority: 'high', estimatedCost: 4000, bookingReference: { provider: 'Louvre', code: 'SAMPLE-LV-1102' } }),
    item({ day: today, title: 'Walk through the Tuileries', category: 'activity', location: { name: 'Jardin des Tuileries' }, coordinates: { lat: 48.8635, lng: 2.327 }, scheduledStart: t(30), scheduledEnd: t(75), isOutdoor: true, priority: 'low' }),
    item({ day: today, title: 'Eiffel Tower summit', category: 'sightseeing', location: { name: 'Tour Eiffel', address: 'Champ de Mars' }, coordinates: { lat: 48.8584, lng: 2.2945 }, scheduledStart: t(120), scheduledEnd: t(240), isFixedTime: true, isOutdoor: true, priority: 'must', estimatedCost: 6500, bookingReference: { provider: 'SETE', code: 'SAMPLE-TE-7781' } }),
    item({ day: today, title: 'Seine river cruise', category: 'activity', location: { name: 'Bateaux Parisiens', address: 'Port de la Bourdonnais' }, coordinates: { lat: 48.8597, lng: 2.293 }, scheduledStart: t(270), scheduledEnd: t(330), isOutdoor: true, estimatedCost: 3300 }),
    item({ day: today, title: 'Dinner at Le Procope', category: 'meal', location: { name: 'Le Procope', address: '13 Rue de l’Ancienne Comédie' }, coordinates: { lat: 48.853, lng: 2.3388 }, scheduledStart: t(390), scheduledEnd: t(480), priority: 'medium', estimatedCost: 10000 }),
    item({ day: today + 1, title: 'Sacré-Cœur & Montmartre', category: 'sightseeing', location: { name: 'Basilique du Sacré-Cœur' }, coordinates: { lat: 48.8867, lng: 2.3431 }, scheduledStart: at(today + 1, '10:00'), scheduledEnd: at(today + 1, '12:00'), isOutdoor: true }),
    item({ day: today + 1, title: 'Lunch in Le Marais', category: 'meal', location: { name: 'L’As du Fallafel' }, coordinates: { lat: 48.8574, lng: 2.3593 }, scheduledStart: at(today + 1, '12:45'), scheduledEnd: at(today + 1, '13:45'), estimatedCost: 2800 }),
    item({ day: today + 1, title: 'Musée d’Orsay', category: 'sightseeing', location: { name: 'Musée d’Orsay' }, coordinates: { lat: 48.86, lng: 2.3266 }, scheduledStart: at(today + 1, '14:30'), scheduledEnd: at(today + 1, '17:00'), operatingHours: { open: '09:30', close: '18:00', source: 'museum website (sample)' }, priority: 'high', estimatedCost: 3000 }),
    item({ day: today + 1, title: 'Arc de Triomphe at sunset', category: 'sightseeing', location: { name: 'Arc de Triomphe' }, coordinates: { lat: 48.8738, lng: 2.295 }, scheduledStart: at(today + 1, '18:00'), scheduledEnd: at(today + 1, '19:00'), isOutdoor: true, estimatedCost: 2400 }),
    item({ day: today + 2, title: 'Hotel check-out', category: 'hotel_checkout', location: { name: 'Hôtel des Grands Boulevards' }, coordinates: { lat: 48.8713, lng: 2.3446 }, scheduledStart: at(today + 2, '10:00'), scheduledEnd: at(today + 2, '10:30'), isFixedTime: true }),
    item({ day: today + 2, title: 'Train home', category: 'transport', transportMode: 'transit', location: { name: 'Paris Gare du Nord' }, coordinates: { lat: 48.8809, lng: 2.3553 }, scheduledStart: at(today + 2, '12:13'), scheduledEnd: at(today + 2, '13:35'), isFixedTime: true, priority: 'must', estimatedCost: 16500, bookingReference: { provider: 'Eurostar', code: 'SAMPLE-ES-9055' } }),
  ];
  const byDay = {};
  await ItineraryItem.insertMany(
    items.map((i) => {
      byDay[i.day] = (byDay[i.day] ?? -1) + 1;
      return { ...i, tripId: trip._id, order: byDay[i.day], estimatedDuration: (i.scheduledEnd - i.scheduledStart) / MINUTE, lastModifiedBy: alice._id };
    })
  );

  await Expense.create([
    { tripId: trip._id, paidBy: alice._id, createdBy: alice._id, description: 'Eurostar tickets (2)', category: 'transport', amount: 33000, currency: 'INR', expenseDate: new Date(now - 10 * DAY) },
    { tripId: trip._id, paidBy: alice._id, createdBy: alice._id, description: 'Hotel deposit', category: 'accommodation', amount: 22000, currency: 'INR', expenseDate: new Date(now - 7 * DAY) },
    { tripId: trip._id, paidBy: bob._id, createdBy: bob._id, description: 'Breakfast at Café de Flore', category: 'food', amount: 3550, currency: 'INR', expenseDate: new Date(now - 3 * HOUR), splitAmong: [alice._id, bob._id] },
    { tripId: trip._id, paidBy: alice._id, createdBy: alice._id, description: 'Louvre tickets', category: 'activities', amount: 4000, currency: 'INR', expenseDate: new Date(now - 2 * HOUR), splitAmong: [alice._id, bob._id] },
    { tripId: trip._id, paidBy: bob._id, createdBy: bob._id, description: 'Souvenir (paid in GBP at the station, no rate recorded)', category: 'shopping', amount: 12, currency: 'GBP', expenseDate: new Date(now - DAY) },
  ]);
  return trip;
}

async function createRajasthanTrip({ alice }) {
  const start = startOfUtcDay(new Date(Date.now() + 21 * DAY));
  const trip = await Trip.create({
    ownerId: alice._id,
    name: 'Rajasthan Road Trip',
    description: 'Forts, palaces and food across Jaipur.',
    origin: { name: 'New Delhi, India', coordinates: { lat: 28.6139, lng: 77.209 } },
    destination: { name: 'Jaipur, India', coordinates: { lat: 26.9124, lng: 75.7873 } },
    startDate: start,
    endDate: new Date(start.getTime() + 3 * DAY),
    timezone: 'Asia/Kolkata',
    travelers: 3,
    budget: 60000,
    currency: 'INR',
    transportMode: 'driving',
    interests: ['history', 'food'],
    isDemo: true,
  });
  const at = (day, hhmm) => zonedTimeToUtc(tripDayDate(trip, day), hhmm, trip.timezone);
  const items = [
    item({ day: 1, title: 'Drive Delhi → Jaipur', category: 'transport', transportMode: 'driving', location: { name: 'Jaipur' }, coordinates: { lat: 26.9124, lng: 75.7873 }, scheduledStart: at(1, '06:30'), scheduledEnd: at(1, '11:30'), costCurrency: 'INR', estimatedCost: 3500 }),
    item({ day: 1, title: 'Hawa Mahal', category: 'sightseeing', transportMode: 'driving', location: { name: 'Hawa Mahal' }, coordinates: { lat: 26.9239, lng: 75.8267 }, scheduledStart: at(1, '15:00'), scheduledEnd: at(1, '16:30'), isOutdoor: true, costCurrency: 'INR', estimatedCost: 600 }),
    item({ day: 2, title: 'Amber Fort', category: 'sightseeing', transportMode: 'driving', location: { name: 'Amer Fort' }, coordinates: { lat: 26.9855, lng: 75.8513 }, scheduledStart: at(2, '09:00'), scheduledEnd: at(2, '12:00'), isOutdoor: true, priority: 'must', operatingHours: { open: '08:00', close: '17:30', source: 'sample data' }, costCurrency: 'INR', estimatedCost: 1500 }),
    item({ day: 2, title: 'City Palace', category: 'sightseeing', transportMode: 'driving', location: { name: 'City Palace, Jaipur' }, coordinates: { lat: 26.9258, lng: 75.8237 }, scheduledStart: at(2, '14:00'), scheduledEnd: at(2, '16:00'), costCurrency: 'INR', estimatedCost: 1200 }),
  ];
  const byDay = {};
  await ItineraryItem.insertMany(items.map((i) => ({ ...i, tripId: trip._id, order: (byDay[i.day] = (byDay[i.day] ?? -1) + 1) })));
  return trip;
}

async function createTokyoTrip({ alice }) {
  const start = startOfUtcDay(new Date(Date.now() - 60 * DAY));
  const trip = await Trip.create({
    ownerId: alice._id,
    name: 'Tokyo in Spring',
    description: 'A completed sample trip.',
    origin: { name: 'Tokyo, Japan', coordinates: { lat: 35.6762, lng: 139.6503 } },
    destination: { name: 'Kyoto, Japan', coordinates: { lat: 35.0116, lng: 135.7681 } },
    startDate: start,
    endDate: new Date(start.getTime() + 4 * DAY),
    timezone: 'Asia/Tokyo',
    travelers: 1,
    budget: 140000,
    currency: 'INR',
    transportMode: 'transit',
    status: 'completed',
    isDemo: true,
  });
  const at = (day, hhmm) => zonedTimeToUtc(tripDayDate(trip, day), hhmm, trip.timezone);
  await ItineraryItem.insertMany([
    item({ tripId: trip._id, day: 1, order: 0, title: 'Senso-ji Temple', category: 'sightseeing', transportMode: 'transit', coordinates: { lat: 35.7148, lng: 139.7967 }, scheduledStart: at(1, '09:00'), scheduledEnd: at(1, '11:00'), status: 'completed', costCurrency: 'INR' }),
    item({ tripId: trip._id, day: 3, order: 0, title: 'Fushimi Inari Taisha', category: 'sightseeing', transportMode: 'transit', coordinates: { lat: 34.9671, lng: 135.7727 }, scheduledStart: at(3, '08:00'), scheduledEnd: at(3, '11:00'), status: 'completed', costCurrency: 'INR' }),
  ]);
  await Expense.create({ tripId: trip._id, paidBy: alice._id, createdBy: alice._id, description: 'JR Pass', category: 'transport', amount: 28000, currency: 'INR', expenseDate: start });
  return trip;
}

async function main() {
  await connectDatabase();
  if (process.argv.includes('--reset')) {
    await mongoose.connection.dropDatabase();
    console.log('Dropped database');
  } else {
    await clearSampleData();
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  const users = await createUsers();
  const trips = [await createParisTrip(users), await createRajasthanTrip(users), await createTokyoTrip(users)];

  console.log('Calculating travel times with the configured routing provider…');
  for (const trip of trips) {
    const days = await ItineraryItem.distinct('day', { tripId: trip._id });
    for (const day of days) await itineraryService.recalculateDay(trip, day);
  }

  console.log('\nSeeded sample data:');
  for (const t of trips) console.log(`  • ${t.name} (${t._id})`);
  console.log(`\nSign in with alice@tripsync.test / ${PASSWORD} (owner), bob@tripsync.test (editor) or chen@tripsync.test (viewer).`);
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('Seeding failed:', err);
  await disconnectDatabase();
  process.exit(1);
});
