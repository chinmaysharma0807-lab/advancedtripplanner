const env = require('../config/env');
const authService = require('../services/authService');
const { signToken, cookieOptions } = require('../middleware/auth');
const { issueCsrfToken } = require('../middleware/csrf');
const { asyncHandler, ok, created } = require('../utils/http');

function setSession(res, user) {
  res.cookie(env.cookieName, signToken(user), cookieOptions());
}

const csrf = (req, res) => ok(res, { csrfToken: issueCsrfToken(req, res) });

const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body);
  setSession(res, user);
  created(res, { user: user.toPublicJSON() });
});

const login = asyncHandler(async (req, res) => {
  const user = await authService.login(req.body);
  setSession(res, user);
  ok(res, { user: user.toPublicJSON() });
});

const logout = (req, res) => {
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(env.cookieName, opts);
  ok(res, { loggedOut: true });
};

const logoutAll = asyncHandler(async (req, res) => {
  await authService.revokeAllSessions(req.user);
  logout(req, res);
});

const me = (req, res) => ok(res, { user: req.user.toPublicJSON() });

const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user, req.body);
  ok(res, { user: user.toPublicJSON() });
});

const changePassword = asyncHandler(async (req, res) => {
  const user = await authService.changePassword(req.user, req.body);
  setSession(res, user); // keep this session, every other one is revoked
  ok(res, { changed: true });
});

const deleteLocationHistory = asyncHandler(async (req, res) => {
  ok(res, await authService.deleteLocationHistory(req.user, { tripId: req.query.tripId }));
});

module.exports = { csrf, register, login, logout, logoutAll, me, updateMe, changePassword, deleteLocationHistory };
