const { Schema, model } = require('mongoose');

const proposedChangeSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'ItineraryItem', required: true },
    title: String,
    action: { type: String, enum: ['shift', 'skip', 'keep'], required: true },
    previousStart: Date,
    previousEnd: Date,
    proposedStart: Date,
    proposedEnd: Date,
    reason: String,
    alternatives: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

const rescheduleProposalSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    day: { type: Number, required: true },
    triggerItemId: { type: Schema.Types.ObjectId, ref: 'ItineraryItem' },
    delayMinutes: { type: Number, required: true },
    source: { type: String, enum: ['gps', 'user', 'system', 'routing'], default: 'system' },
    dataSource: { type: String }, // routing provider used for the delay estimate
    isEstimate: { type: Boolean, default: false },
    includesTraffic: { type: Boolean, default: false }, // delay estimate used live traffic
    explanation: { type: String, maxlength: 4000 },
    changes: { type: [proposedChangeSchema], default: [] },
    warnings: { type: [String], default: [] },
    status: { type: String, enum: ['pending', 'applied', 'rejected', 'expired'], default: 'pending' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: Date,
  },
  { timestamps: true }
);

rescheduleProposalSchema.index({ tripId: 1, status: 1, createdAt: -1 });

module.exports = model('RescheduleProposal', rescheduleProposalSchema);
