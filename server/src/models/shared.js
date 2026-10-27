const { Schema } = require('mongoose');
const { CURRENCY_REGEX } = require('../config/constants');

const coordinatesSchema = new Schema(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false }
);

const placeSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    address: { type: String, trim: true, maxlength: 400 },
    coordinates: { type: coordinatesSchema, default: undefined },
  },
  { _id: false }
);

// Monetary values are stored as numbers rounded to two decimals.
const roundMoney = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v);

const moneyField = (options = {}) => ({
  type: Number,
  min: [0, 'Amount cannot be negative'],
  max: [1e10, 'Amount is too large'],
  set: roundMoney,
  validate: {
    validator: Number.isFinite,
    message: 'Amount must be a finite number',
  },
  ...options,
});

const currencyField = (options = {}) => ({
  type: String,
  uppercase: true,
  trim: true,
  match: [CURRENCY_REGEX, 'Currency must be a 3-letter ISO 4217 code'],
  ...options,
});

module.exports = { coordinatesSchema, placeSchema, moneyField, currencyField, roundMoney };
