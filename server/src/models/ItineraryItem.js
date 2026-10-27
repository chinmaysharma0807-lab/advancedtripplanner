const { Schema, model } = require('mongoose');
const {
  ITEM_CATEGORIES,
  ITEM_STATUSES,
  PRIORITIES,
  TRANSPORT_MODES,
} = require('../config/constants');
const { coordinatesSchema, moneyField, currencyField } = require('./shared');

const linkSchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 100 },
    url: { type: String, trim: true, maxlength: 2000, match: [/^https?:\/\//i, 'Links must be http(s) URLs'] },
  },
  { _id: false }
);

const itineraryItemSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    day: { type: Number, required: true, min: 1, max: 366 },
    order: { type: Number, required: true, min: 0 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 4000, default: '' },
    category: { type: String, enum: ITEM_CATEGORIES, default: 'activity' },
    location: {
      name: { type: String, trim: true, maxlength: 200 },
      address: { type: String, trim: true, maxlength: 400 },
    },
    coordinates: { type: coordinatesSchema, default: undefined },
    scheduledStart: { type: Date, required: true },
    scheduledEnd: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return !this.scheduledStart || value > this.scheduledStart;
        },
        message: 'Scheduled end must be after scheduled start',
      },
    },
    estimatedDuration: { type: Number, min: 0, max: 60 * 24 * 7 }, // minutes
    estimatedTravelTime: { type: Number, min: 0, default: null }, // minutes from previous stop
    travelDistance: { type: Number, min: 0, default: null }, // meters from previous stop
    travelSource: { type: String, default: null }, // provider that produced the travel estimate
    trafficDelayMinutes: { type: Number, min: 0, default: null }, // traffic share of estimatedTravelTime
    trafficKind: { type: String, default: null }, // 'live' | 'predicted' when traffic was applied
    transportMode: { type: String, enum: TRANSPORT_MODES, default: 'driving' },
    estimatedCost: moneyField({ default: 0 }),
    costCurrency: currencyField(),
    bookingReference: {
      provider: { type: String, trim: true, maxlength: 120 },
      code: { type: String, trim: true, maxlength: 120 },
      url: { type: String, trim: true, maxlength: 2000 },
    },
    // Booked or otherwise fixed-time reservations are never moved automatically.
    isFixedTime: { type: Boolean, default: false },
    isOutdoor: { type: Boolean, default: false },
    operatingHours: {
      open: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      close: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      source: { type: String, maxlength: 100 },
    },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    status: { type: String, enum: ITEM_STATUSES, default: 'upcoming' },
    statusSource: { type: String, default: 'user' },
    conflictAcknowledged: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 4000, default: '' },
    links: { type: [linkSchema], default: [] },
    attachments: { type: [linkSchema], default: [] },
    eta: { type: Date, default: null },
    actualStart: Date,
    actualEnd: Date,
    weatherFlag: {
      severity: { type: String, enum: ['info', 'warning', 'severe'] },
      summary: String,
      source: String,
      forecastFor: Date,
      updatedAt: Date,
      isDemo: Boolean,
    },
    generatedBy: { type: String, default: null }, // 'ai' | 'template' when created by the generator
    lastModifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

itineraryItemSchema.index({ tripId: 1, day: 1, order: 1 });
itineraryItemSchema.index({ tripId: 1, scheduledStart: 1 });
itineraryItemSchema.index({ status: 1, scheduledEnd: 1 });

itineraryItemSchema.pre('validate', function setDuration(next) {
  if (this.scheduledStart && this.scheduledEnd) {
    this.estimatedDuration = Math.round((this.scheduledEnd - this.scheduledStart) / 60000);
  }
  next();
});

module.exports = model('ItineraryItem', itineraryItemSchema);
