const { Schema, model } = require('mongoose');
const { LOCATION_SOURCES } = require('../config/constants');
const { coordinatesSchema } = require('./shared');

// Location fixes are stored outside the Trip document so trips do not grow without bound.
// Each fix carries its own expiry, so retention can be configured globally or per user.
const locationUpdateSchema = new Schema({
  tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: Schema.Types.ObjectId, ref: 'TrackingSession' },
  coordinates: { type: coordinatesSchema, required: true },
  accuracy: { type: Number, min: 0, max: 100000 },
  speed: { type: Number, min: 0 },
  heading: { type: Number, min: 0, max: 360 },
  timestamp: { type: Date, required: true },
  receivedAt: { type: Date, default: Date.now },
  source: { type: String, enum: LOCATION_SOURCES, default: 'browser_geolocation' },
  expiresAt: { type: Date, required: true },
});

locationUpdateSchema.index({ tripId: 1, userId: 1, timestamp: -1 });
locationUpdateSchema.index({ userId: 1 });
locationUpdateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model('LocationUpdate', locationUpdateSchema);
