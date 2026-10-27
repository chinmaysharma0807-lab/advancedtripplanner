const { Schema, model } = require('mongoose');
const { coordinatesSchema } = require('./shared');

const trackingSessionSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['active', 'paused', 'stopped'], default: 'active' },
    startedAt: { type: Date, default: Date.now },
    pausedAt: Date,
    stoppedAt: Date,
    lastLocation: {
      coordinates: { type: coordinatesSchema, default: undefined },
      accuracy: Number,
      timestamp: Date,
      source: String,
    },
    travelledMeters: { type: Number, default: 0 },
    targetItemId: { type: Schema.Types.ObjectId, ref: 'ItineraryItem', default: null },
    currentItemId: { type: Schema.Types.ObjectId, ref: 'ItineraryItem', default: null },
    // Route for the current leg (origin = where the leg started, destination = target item).
    leg: {
      targetItemId: { type: Schema.Types.ObjectId, default: null },
      origin: { type: coordinatesSchema, default: undefined },
      initialDistance: Number,
      geometry: { type: [[Number]], default: undefined }, // [[lat, lng], ...]
      source: String,
      isDemo: Boolean,
      isEstimate: Boolean,
      trafficAware: Boolean, // the provider applied traffic to this route
      trafficKind: String, // 'live' | 'predicted'
      trafficDelay: Number, // seconds added by traffic at computedAt
      noTrafficDuration: Number, // seconds without traffic at computedAt
      routeDistance: Number, // meters, from the provider at computedAt
      routeDuration: Number, // seconds, from the provider at computedAt
      computedAt: Date,
      computedFrom: { type: coordinatesSchema, default: undefined },
    },
    progress: {
      distanceRemaining: Number, // meters
      durationRemaining: Number, // seconds
      eta: Date,
      percent: Number,
      source: String,
      isEstimate: Boolean,
      isDemo: Boolean,
      trafficAware: Boolean,
      trafficDelaySeconds: Number,
      delayMinutes: Number,
      updatedAt: Date,
    },
    deviation: {
      isDeviating: { type: Boolean, default: false },
      distanceMeters: Number,
      consecutive: { type: Number, default: 0 },
      detectedAt: Date,
    },
    geofence: {
      itemId: { type: Schema.Types.ObjectId, default: null },
      enteredAt: Date,
    },
    lastNotifiedEta: Date,
  },
  { timestamps: true }
);

trackingSessionSchema.index({ tripId: 1, userId: 1, status: 1 });
// Only one live (active or paused) session per traveller per trip.
trackingSessionSchema.index(
  { tripId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['active', 'paused'] } } }
);

module.exports = model('TrackingSession', trackingSessionSchema);
