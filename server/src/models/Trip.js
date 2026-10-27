const { Schema, model } = require('mongoose');
const { TRANSPORT_MODES, TRIP_STATUSES, PARTICIPANT_ROLES } = require('../config/constants');
const { placeSchema, moneyField, currencyField, coordinatesSchema } = require('./shared');

const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: PARTICIPANT_ROLES, required: true, default: 'viewer' },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    invitedAt: { type: Date, default: Date.now },
    joinedAt: Date,
  },
  { _id: false }
);

const accommodationSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  address: { type: String, trim: true, maxlength: 400 },
  coordinates: { type: coordinatesSchema, default: undefined },
  checkIn: Date,
  checkOut: Date,
  confirmationNumber: { type: String, trim: true, maxlength: 100 },
  notes: { type: String, trim: true, maxlength: 1000 },
});

const trackingSettingsSchema = new Schema(
  {
    approachRadiusMeters: { type: Number, min: 50, max: 20000, default: 1000 },
    approachMinutes: { type: Number, min: 1, max: 120, default: 10 },
    arrivalRadiusMeters: { type: Number, min: 20, max: 2000, default: 150 },
    // Minutes inside the arrival geofence before an activity is auto-started. 0 = always ask.
    autoStartDwellMinutes: { type: Number, min: 0, max: 120, default: 5 },
    // Explicit opt-in: complete an in-progress activity when the traveller leaves its geofence.
    autoCompleteOnDeparture: { type: Boolean, default: false },
    deviationThresholdMeters: { type: Number, min: 100, max: 10000, default: 500 },
    delayGraceMinutes: { type: Number, min: 0, max: 120, default: 10 },
    proposalThresholdMinutes: { type: Number, min: 5, max: 600, default: 20 },
  },
  { _id: false }
);

const tripSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 4000, default: '' },
    origin: { type: placeSchema, required: true },
    destination: { type: placeSchema, required: true },
    intermediateStops: { type: [placeSchema], default: [] },
    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return !this.startDate || value >= this.startDate;
        },
        message: 'End date must be on or after the start date',
      },
    },
    timezone: { type: String, default: 'UTC', maxlength: 64 },
    travelers: { type: Number, min: 1, max: 100, default: 1 },
    budget: moneyField({ default: 0 }),
    currency: currencyField({ default: 'INR', required: true }),
    transportMode: { type: String, enum: TRANSPORT_MODES, default: 'driving' },
    accommodation: { type: [accommodationSchema], default: [] },
    interests: { type: [{ type: String, trim: true, maxlength: 50 }], default: [] },
    visibility: { type: String, enum: ['private', 'shared'], default: 'private' },
    status: { type: String, enum: TRIP_STATUSES, default: 'upcoming', index: true },
    statusOverride: { type: String, enum: [...TRIP_STATUSES, null], default: null },
    participants: { type: [participantSchema], default: [] },
    trackingSettings: { type: trackingSettingsSchema, default: () => ({}) },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

tripSchema.index({ 'participants.userId': 1 });
tripSchema.index({ status: 1, startDate: 1 });

module.exports = model('Trip', tripSchema);
