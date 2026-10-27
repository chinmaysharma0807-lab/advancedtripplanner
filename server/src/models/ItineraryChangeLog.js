const { Schema, model } = require('mongoose');
const { CHANGE_TYPES, CHANGE_SOURCES } = require('../config/constants');

const itineraryChangeLogSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    itineraryItemId: { type: Schema.Types.ObjectId, ref: 'ItineraryItem', default: null },
    itemTitle: { type: String, maxlength: 200 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null = system
    changeType: { type: String, enum: CHANGE_TYPES, required: true },
    previousValues: { type: Schema.Types.Mixed, default: null },
    newValues: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, maxlength: 1000, default: '' },
    source: { type: String, enum: CHANGE_SOURCES, default: 'user' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

itineraryChangeLogSchema.index({ tripId: 1, createdAt: -1 });
itineraryChangeLogSchema.index({ itineraryItemId: 1, createdAt: -1 });

module.exports = model('ItineraryChangeLog', itineraryChangeLogSchema);
