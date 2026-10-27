const { z, coordinates, money, currency, isoDate, objectId } = require('./common');
const { ITEM_CATEGORIES, ITEM_STATUSES, PRIORITIES, TRANSPORT_MODES } = require('../config/constants');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const link = z.object({
  label: z.string().trim().max(100).optional(),
  url: z.string().trim().url().max(2000).refine((u) => /^https?:\/\//i.test(u), 'Links must be http(s)'),
});

const itemFields = {
  day: z.coerce.number().int().min(1).max(366),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(4000),
  category: z.enum(ITEM_CATEGORIES),
  location: z.object({ name: z.string().trim().max(200).optional(), address: z.string().trim().max(400).optional() }),
  coordinates: coordinates.nullable(),
  scheduledStart: isoDate,
  scheduledEnd: isoDate,
  transportMode: z.enum(TRANSPORT_MODES),
  estimatedCost: money,
  costCurrency: currency,
  bookingReference: z
    .object({
      provider: z.string().trim().max(120),
      code: z.string().trim().max(120),
      url: z.string().trim().max(2000),
    })
    .partial(),
  isFixedTime: z.boolean(),
  isOutdoor: z.boolean(),
  operatingHours: z.object({ open: hhmm, close: hhmm, source: z.string().max(100).optional() }).nullable(),
  priority: z.enum(PRIORITIES),
  notes: z.string().trim().max(4000),
  links: z.array(link).max(20),
  attachments: z.array(link).max(20),
};

const timeOrder = (data, ctx) => {
  if (data.scheduledStart && data.scheduledEnd && data.scheduledEnd <= data.scheduledStart) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledEnd'], message: 'End time must be after start time' });
  }
};

const createItem = z
  .object({ ...itemFields, confirmConflict: z.boolean().optional() })
  .partial()
  .required({ title: true, scheduledStart: true, scheduledEnd: true })
  .superRefine(timeOrder);

const updateItem = z
  .object({ ...itemFields, confirmConflict: z.boolean().optional() })
  .partial()
  .superRefine(timeOrder);

const statusUpdate = z.object({
  status: z.enum(ITEM_STATUSES),
  reason: z.string().trim().max(500).optional(),
});

const reorder = z.object({
  day: z.coerce.number().int().min(1).max(366),
  orderedIds: z.array(objectId).min(1).max(200),
  // Shift non-fixed activities so they follow the new order back-to-back.
  reflow: z.boolean().default(true),
});

const recalculate = z.object({
  day: z.coerce.number().int().min(1).max(366).optional(),
});

const generate = z.object({
  destination: z.string().trim().max(200).optional(),
  days: z.coerce.number().int().min(1).max(21).optional(),
  budget: money.optional(),
  interests: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  pace: z.enum(['relaxed', 'moderate', 'packed']).optional(),
});

const bulkCreate = z.object({
  replaceExisting: z.boolean().default(false),
  items: z
    .array(
      z
        .object(itemFields)
        .partial()
        .required({ title: true, scheduledStart: true, scheduledEnd: true, day: true })
        .extend({ generatedBy: z.enum(['ai', 'template']).optional() })
        .superRefine(timeOrder)
    )
    .min(1)
    .max(300),
});

const listItemsQuery = z.object({ day: z.coerce.number().int().min(1).max(366).optional() });

const routeQuery = z.object({ day: z.coerce.number().int().min(1).max(366).optional() });

module.exports = { createItem, updateItem, statusUpdate, reorder, recalculate, generate, bulkCreate, listItemsQuery, routeQuery };
