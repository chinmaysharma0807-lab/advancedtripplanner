const { z } = require('zod');
const mongoose = require('mongoose');
const { CURRENCY_REGEX } = require('../config/constants');

const objectId = z
  .string()
  .refine((v) => mongoose.isValidObjectId(v) && /^[a-f0-9]{24}$/i.test(v), { message: 'Invalid id' });

const coordinates = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const place = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(400).optional(),
  coordinates: coordinates.optional(),
});

const currency = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => CURRENCY_REGEX.test(v), { message: 'Currency must be a 3-letter ISO code' });

const money = z.coerce
  .number()
  .finite()
  .min(0)
  .max(1e10)
  .transform((v) => Math.round(v * 100) / 100);

const isoDate = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), { message: 'Invalid date' });

const pagination = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const tripIdParams = z.object({ tripId: objectId });
const idParams = z.object({ id: objectId });

module.exports = { z, objectId, coordinates, place, currency, money, isoDate, pagination, tripIdParams, idParams };
