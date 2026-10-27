const { Schema, model } = require('mongoose');
const { TRANSPORT_MODES, NOTIFICATION_CATEGORIES } = require('../config/constants');
const { currencyField } = require('./shared');

const travelPreferencesSchema = new Schema(
  {
    budgetLevel: { type: String, enum: ['budget', 'moderate', 'luxury'], default: 'moderate' },
    activities: { type: [{ type: String, trim: true, maxlength: 50 }], default: [] },
    dietary: { type: [{ type: String, trim: true, maxlength: 50 }], default: [] },
    transport: { type: String, enum: TRANSPORT_MODES, default: 'driving' },
    pace: { type: String, enum: ['relaxed', 'moderate', 'packed'], default: 'moderate' },
    currency: currencyField({ default: 'INR' }),
  },
  { _id: false }
);

const categoryDefaults = Object.fromEntries(
  Object.keys(NOTIFICATION_CATEGORIES).map((key) => [key, { type: Boolean, default: true }])
);

const notificationPreferencesSchema = new Schema(
  {
    ...categoryDefaults,
    browserPush: { type: Boolean, default: false },
  },
  { _id: false }
);

const privacySchema = new Schema(
  {
    // When false, live positions are only visible to the traveller themself.
    shareLocationWithParticipants: { type: Boolean, default: true },
    locationRetentionDays: { type: Number, min: 1, max: 365, default: undefined },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    passwordHash: { type: String, required: true, select: false },
    // Incremented to invalidate every issued JWT ("sign out everywhere", password change).
    tokenVersion: { type: Number, default: 0, select: false },
    travelPreferences: { type: travelPreferencesSchema, default: () => ({}) },
    notificationPreferences: { type: notificationPreferencesSchema, default: () => ({}) },
    privacy: { type: privacySchema, default: () => ({}) },
  },
  { timestamps: true }
);

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    travelPreferences: this.travelPreferences,
    notificationPreferences: this.notificationPreferences,
    privacy: this.privacy,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = model('User', userSchema);
