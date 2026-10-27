const expenseService = require('../services/expenseService');
const { requireTripAccess } = require('../services/accessService');
const { Expense } = require('../models');
const { asyncHandler, ok, created, parsePagination, pageMeta } = require('../utils/http');
const { notFound } = require('../utils/errors');

async function expenseWithAccess(id, user, role) {
  const expense = await Expense.findById(id);
  if (!expense) throw notFound('Expense');
  const { trip } = await requireTripAccess(expense.tripId, user, role).catch((err) => {
    if (err.status === 404) throw notFound('Expense');
    throw err;
  });
  return { expense, trip };
}

const list = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  const q = req.validatedQuery || {};
  const page = parsePagination(q, { defaultLimit: 50, maxLimit: 200 });
  const { items, total } = await expenseService.list(trip, { ...page, category: q.category });
  ok(res, items, pageMeta(page, total));
});

const summary = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user);
  ok(res, await expenseService.summary(trip));
});

const create = asyncHandler(async (req, res) => {
  const { trip } = await requireTripAccess(req.params.tripId, req.user, 'editor');
  created(res, await expenseService.create(trip, req.user, req.body));
});

const update = asyncHandler(async (req, res) => {
  const { expense, trip } = await expenseWithAccess(req.params.id, req.user, 'editor');
  ok(res, await expenseService.update(trip, expense, req.body));
});

const remove = asyncHandler(async (req, res) => {
  const { expense, trip } = await expenseWithAccess(req.params.id, req.user, 'editor');
  await expenseService.remove(trip, expense);
  res.status(204).end();
});

module.exports = { list, summary, create, update, remove };
