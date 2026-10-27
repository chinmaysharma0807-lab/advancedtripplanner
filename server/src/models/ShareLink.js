const { Schema, model } = require('mongoose');
const { PARTICIPANT_ROLES } = require('../config/constants');

// Only a SHA-256 hash of the share token is stored; the raw token is shown once.
const shareLinkSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    role: { type: String, enum: PARTICIPANT_ROLES, default: 'viewer' },
    // Whether anonymous visitors may read the itinerary without signing in (never live location).
    allowAnonymousView: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    uses: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = model('ShareLink', shareLinkSchema);
