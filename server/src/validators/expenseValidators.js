const { z, currency, isoDate, objectId } = require('./common');
const { EXPENSE_CATEGORIES } = require('../config/constants');

const amount = z.coerce
  .number()
  .finite()
  .positive('Amount must be greater than zero')
  .max(1e10)
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, { message: 'Use at most two decimal places' });

const fields = {
  description: z.string().trim().min(1).max(300),
  category: z.enum(EXPENSE_CATEGORIES),
  amount,
  currency,
  exchangeRate: z.coerce.number().positive().max(1e7).nullable(),
  expenseDate: isoDate,
  receiptUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), 'Receipt must be an http(s) URL')
    .or(z.literal('')),
  paidBy: objectId,
  splitAmong: z.array(objectId).max(100),
  itineraryItemId: objectId.nullable(),
};

const createExpense = z
  .object(fields)
  .partial()
  .required({ description: true, category: true, amount: true, expenseDate: true });

const updateExpense = z.object(fields).partial();

const listExpensesQuery = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

module.exports = { createExpense, updateExpense, listExpensesQuery };
