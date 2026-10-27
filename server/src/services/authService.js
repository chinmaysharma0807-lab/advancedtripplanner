const bcrypt = require('bcrypt');
const { User, LocationUpdate } = require('../models');
const { conflict, unauthorized, badRequest } = require('../utils/errors');

const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;
// Compared against when the email is unknown so response timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('tripsync-timing-equaliser', BCRYPT_ROUNDS);

async function register({ name, email, password }) {
  if (await User.exists({ email })) throw conflict('An account with this email already exists', undefined, 'EMAIL_TAKEN');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    return await User.create({ name, email, passwordHash });
  } catch (err) {
    if (err?.code === 11000) throw conflict('An account with this email already exists', undefined, 'EMAIL_TAKEN');
    throw err;
  }
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  return user;
}

function mergeSubdoc(doc, key, patch) {
  if (!patch) return;
  const current = doc[key]?.toObject ? doc[key].toObject() : doc[key] || {};
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  doc.set(key, next);
}

async function updateProfile(user, patch) {
  if (patch.name) user.name = patch.name;
  mergeSubdoc(user, 'travelPreferences', patch.travelPreferences);
  mergeSubdoc(user, 'notificationPreferences', patch.notificationPreferences);
  mergeSubdoc(user, 'privacy', patch.privacy);
  await user.save();
  return user;
}

async function changePassword(user, { currentPassword, newPassword }) {
  const full = await User.findById(user._id).select('+passwordHash +tokenVersion');
  if (!(await bcrypt.compare(currentPassword, full.passwordHash))) throw badRequest('Current password is incorrect');
  full.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  full.tokenVersion = (full.tokenVersion || 0) + 1; // sign out every other session
  await full.save();
  return full;
}

async function revokeAllSessions(user) {
  await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
}

async function deleteLocationHistory(user, { tripId } = {}) {
  const res = await LocationUpdate.deleteMany({ userId: user._id, ...(tripId ? { tripId } : {}) });
  return { deleted: res.deletedCount };
}

module.exports = { register, login, updateProfile, changePassword, revokeAllSessions, deleteLocationHistory };
