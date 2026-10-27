const { Schema, model } = require('mongoose');
const { NOTIFICATION_TYPES } = require('../config/constants');

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 2000 },
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
    deduplicationKey: { type: String, required: true, maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// One notification per (user, event). Inserts use upsert + $setOnInsert so concurrent
// producers (job sweeps, socket handlers) cannot create duplicates.
notificationSchema.index({ userId: 1, deduplicationKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

module.exports = model('Notification', notificationSchema);
