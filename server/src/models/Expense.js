const { Schema, model } = require('mongoose');
const { EXPENSE_CATEGORIES } = require('../config/constants');
const { moneyField, currencyField } = require('./shared');

const expenseSchema = new Schema(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    amount: moneyField({
      required: true,
      validate: {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'Amount must be greater than zero',
      },
    }),
    currency: currencyField({ required: true }),
    // Explicit rate converting `currency` into the trip currency. Required to include a
    // foreign-currency expense in budget totals; never guessed.
    exchangeRate: {
      type: Number,
      min: [0.000001, 'Exchange rate must be positive'],
      max: 1e7,
      default: null,
    },
    expenseDate: { type: Date, required: true },
    receiptUrl: { type: String, trim: true, maxlength: 2000, match: [/^https?:\/\//i, 'Receipt must be an http(s) URL'] },
    splitAmong: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    itineraryItemId: { type: Schema.Types.ObjectId, ref: 'ItineraryItem', default: null },
  },
  { timestamps: true }
);

expenseSchema.index({ tripId: 1, expenseDate: -1 });

module.exports = model('Expense', expenseSchema);
