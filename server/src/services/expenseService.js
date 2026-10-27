const mongoose = require('mongoose');
const { Expense, ItineraryItem, User } = require('../models');
const { EXPENSE_CATEGORIES } = require('../config/constants');
const { memberIds } = require('./accessService');
const notificationService = require('./notificationService');
const realtime = require('../sockets/realtime');
const { badRequest, notFound } = require('../utils/errors');
const { roundMoney } = require('../models/shared');

function assertMembers(trip, ids) {
  const members = new Set(memberIds(trip));
  for (const id of ids) if (!members.has(String(id))) throw badRequest('Expenses can only be paid by or split among trip members');
}

async function getExpenseForTrip(expenseId, tripId) {
  if (!mongoose.isValidObjectId(expenseId)) throw notFound('Expense');
  const e = await Expense.findOne({ _id: expenseId, tripId });
  if (!e) throw notFound('Expense');
  return e;
}

/** Convert an expense to the trip currency, or null if no explicit rate was recorded. */
function inTripCurrency(expense, tripCurrency) {
  if (expense.currency === tripCurrency) return expense.amount;
  if (expense.exchangeRate) return roundMoney(expense.amount * expense.exchangeRate);
  return null;
}

async function create(trip, actor, data) {
  const paidBy = data.paidBy || String(actor._id);
  assertMembers(trip, [paidBy, ...(data.splitAmong || [])]);
  const currency = data.currency || trip.currency;
  // A foreign-currency expense without an explicit rate is stored but excluded from totals.
  const expense = await Expense.create({
    ...data,
    receiptUrl: data.receiptUrl || undefined,
    currency,
    exchangeRate: currency === trip.currency ? null : data.exchangeRate ?? null,
    tripId: trip._id,
    paidBy,
    createdBy: actor._id,
  });
  realtime.emitToTrip(trip._id, 'expenses_updated', { action: 'created', expenseId: String(expense._id) });
  await checkBudget(trip);
  return expense;
}

async function update(trip, expense, patch) {
  if (patch.paidBy || patch.splitAmong) assertMembers(trip, [patch.paidBy || expense.paidBy, ...(patch.splitAmong || [])]);
  expense.set({ ...patch, receiptUrl: patch.receiptUrl === '' ? undefined : patch.receiptUrl ?? expense.receiptUrl });
  if (expense.currency === trip.currency) expense.exchangeRate = null;
  await expense.save();
  realtime.emitToTrip(trip._id, 'expenses_updated', { action: 'updated', expenseId: String(expense._id) });
  await checkBudget(trip);
  return expense;
}

async function remove(trip, expense) {
  await Expense.deleteOne({ _id: expense._id });
  realtime.emitToTrip(trip._id, 'expenses_updated', { action: 'deleted', expenseId: String(expense._id) });
}

async function list(trip, { skip, limit, category }) {
  const filter = { tripId: trip._id, ...(category ? { category } : {}) };
  const [items, total] = await Promise.all([
    Expense.find(filter).sort({ expenseDate: -1, createdAt: -1 }).skip(skip).limit(limit).populate('paidBy', 'name').lean(),
    Expense.countDocuments(filter),
  ]);
  return { items, total };
}

/** Pure budget calculation used by the summary endpoint and the tests. */
function summarize({ trip, expenses, items, members }) {
  const byCategory = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0]));
  const unconverted = {};
  const paid = Object.fromEntries(members.map((m) => [String(m._id), 0]));
  const owed = Object.fromEntries(members.map((m) => [String(m._id), 0]));
  let actual = 0;

  for (const e of expenses) {
    const value = inTripCurrency(e, trip.currency);
    if (value === null) {
      unconverted[e.currency] = roundMoney((unconverted[e.currency] || 0) + e.amount);
      continue;
    }
    actual = roundMoney(actual + value);
    byCategory[e.category] = roundMoney(byCategory[e.category] + value);
    const payer = String(e.paidBy?._id || e.paidBy);
    paid[payer] = roundMoney((paid[payer] || 0) + value);
    const split = e.splitAmong?.length ? e.splitAmong.map(String) : members.map((m) => String(m._id));
    // Split in cents so shares always add back up to the expense amount.
    const cents = Math.round(value * 100);
    const base = Math.floor(cents / split.length);
    let remainder = cents - base * split.length;
    for (const id of split) {
      const share = base + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;
      owed[id] = roundMoney((owed[id] || 0) + share / 100);
    }
  }

  const planned = roundMoney(
    items
      .filter((i) => !['cancelled', 'skipped'].includes(i.status) && (!i.costCurrency || i.costCurrency === trip.currency))
      .reduce((sum, i) => sum + (i.estimatedCost || 0), 0)
  );
  const plannedUnconverted = items.filter((i) => i.costCurrency && i.costCurrency !== trip.currency && i.estimatedCost > 0).length;
  const budget = trip.budget || 0;
  const utilization = budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null;
  const warnings = [];
  if (budget > 0 && actual > budget) warnings.push({ type: 'over_budget', message: `Spending is ${roundMoney(actual - budget)} ${trip.currency} over budget.` });
  else if (budget > 0 && actual >= budget * 0.9) warnings.push({ type: 'near_budget', message: `You have used ${utilization}% of the budget.` });
  if (budget > 0 && planned > budget) warnings.push({ type: 'planned_over_budget', message: `Planned activity costs (${planned} ${trip.currency}) exceed the budget.` });
  if (Object.keys(unconverted).length) warnings.push({ type: 'unconverted', message: 'Some expenses are in another currency without an exchange rate and are not included in totals.' });

  const travelers = Math.max(trip.travelers || 1, 1);
  return {
    currency: trip.currency,
    budget,
    actual,
    planned,
    plannedUnconvertedItems: plannedUnconverted,
    remaining: roundMoney(budget - actual),
    utilization,
    byCategory,
    unconverted,
    perPerson: { budget: roundMoney(budget / travelers), actual: roundMoney(actual / travelers), travelers },
    members: members.map((m) => {
      const id = String(m._id);
      return { userId: id, name: m.name, paid: paid[id] || 0, share: owed[id] || 0, balance: roundMoney((paid[id] || 0) - (owed[id] || 0)) };
    }),
    warnings,
  };
}

async function summary(trip) {
  const [expenses, items, members] = await Promise.all([
    Expense.find({ tripId: trip._id }).lean(),
    ItineraryItem.find({ tripId: trip._id }).select('estimatedCost costCurrency status').lean(),
    User.find({ _id: { $in: memberIds(trip) } }).select('name').lean(),
  ]);
  return summarize({ trip, expenses, items, members });
}

async function checkBudget(trip) {
  const s = await summary(trip);
  const over = s.warnings.find((w) => w.type === 'over_budget' || w.type === 'near_budget');
  if (over) {
    await notificationService.notifyTripMembers(trip, {
      type: 'budget_alert',
      severity: over.type === 'over_budget' ? 'warning' : 'info',
      title: over.type === 'over_budget' ? `${trip.name} is over budget` : `${trip.name} is close to its budget`,
      message: over.message,
      dedupKey: `budget:${trip._id}:${over.type}`,
    });
  }
}

module.exports = { create, update, remove, list, summary, summarize, getExpenseForTrip, inTripCurrency };
