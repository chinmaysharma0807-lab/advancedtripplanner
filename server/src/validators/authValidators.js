const { z, currency } = require('./common');
const { TRANSPORT_MODES, NOTIFICATION_CATEGORIES } = require('../config/constants');

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'Password must contain a letter and a number' });

const register = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email,
  password,
});

const login = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(128),
});

const tag = z.string().trim().min(1).max(50);

const travelPreferences = z
  .object({
    budgetLevel: z.enum(['budget', 'moderate', 'luxury']),
    activities: z.array(tag).max(30),
    dietary: z.array(tag).max(20),
    transport: z.enum(TRANSPORT_MODES),
    pace: z.enum(['relaxed', 'moderate', 'packed']),
    currency,
  })
  .partial();

const notificationPreferences = z
  .object({
    ...Object.fromEntries(Object.keys(NOTIFICATION_CATEGORIES).map((k) => [k, z.boolean()])),
    browserPush: z.boolean(),
  })
  .partial();

const privacy = z
  .object({
    shareLocationWithParticipants: z.boolean(),
    locationRetentionDays: z.coerce.number().int().min(1).max(365).nullable(),
  })
  .partial();

const updateProfile = z
  .object({
    name: z.string().trim().min(1).max(100),
    travelPreferences,
    notificationPreferences,
    privacy,
  })
  .partial();

const changePassword = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

module.exports = { register, login, updateProfile, changePassword };
