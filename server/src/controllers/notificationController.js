const notificationService = require('../services/notificationService');
const { asyncHandler, ok, parsePagination, pageMeta } = require('../utils/http');

const list = asyncHandler(async (req, res) => {
  const page = parsePagination(req.query, { defaultLimit: 20 });
  const { items, total, unreadCount } = await notificationService.list(req.user._id, page, { unread: req.query.unread === 'true' });
  ok(res, items, { ...pageMeta(page, total), unreadCount });
});

const markRead = asyncHandler(async (req, res) => ok(res, await notificationService.markRead(req.user._id, req.params.id)));

const markAllRead = asyncHandler(async (req, res) => ok(res, await notificationService.markAllRead(req.user._id)));

module.exports = { list, markRead, markAllRead };
