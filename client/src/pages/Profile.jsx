import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { Field, InlineError } from '../components/ui';
import { INTERESTS, TRANSPORT_MODES, NOTIFICATION_CATEGORIES, CURRENCIES } from '../utils/constants';

function Section({ title, description, children }) {
  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function useSaver() {
  const [state, setState] = useState({ saving: false, error: null, saved: false });
  const save = async (fn) => {
    setState({ saving: true, error: null, saved: false });
    try {
      await fn();
      setState({ saving: false, error: null, saved: true });
      setTimeout(() => setState((s) => ({ ...s, saved: false })), 2500);
    } catch (err) {
      setState({ saving: false, error: toApiError(err), saved: false });
    }
  };
  return [state, save];
}

const Saved = ({ state }) => (
  <>
    <InlineError error={state.error} />
    {state.saved && <span className="text-sm text-emerald-700">Saved ✓</span>}
  </>
);

export default function Profile() {
  const { user, updateProfile, logout } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user.name);
  const [prefs, setPrefs] = useState({ ...user.travelPreferences, dietaryText: (user.travelPreferences?.dietary || []).join(', ') });
  const [notif, setNotif] = useState(user.notificationPreferences || {});
  const [privacy, setPrivacy] = useState({ shareLocationWithParticipants: user.privacy?.shareLocationWithParticipants !== false, locationRetentionDays: user.privacy?.locationRetentionDays || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [detailsState, saveDetails] = useSaver();
  const [prefsState, savePrefs] = useSaver();
  const [notifState, saveNotif] = useSaver();
  const [privacyState, savePrivacy] = useSaver();
  const [pwState, savePw] = useSaver();
  const [historyMsg, setHistoryMsg] = useState(null);

  const pushSupported = typeof window !== 'undefined' && 'Notification' in window;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Profile & settings</h1>

      <Section title="Your details">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveDetails(() => updateProfile({ name }));
          }}
        >
          <div className="min-w-[220px] flex-1">
            <Field label="Name" htmlFor="p-name">
              <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
          </div>
          <div className="min-w-[220px] flex-1">
            <Field label="Email" htmlFor="p-email">
              <input id="p-email" className="input bg-slate-50" value={user.email} disabled />
            </Field>
          </div>
          <button type="submit" className="btn-primary" disabled={detailsState.saving}>
            Save
          </button>
          <Saved state={detailsState} />
        </form>
      </Section>

      <Section title="Travel preferences" description="Used for itinerary generation and nearby recommendations.">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const { dietaryText, ...rest } = prefs;
            savePrefs(() =>
              updateProfile({
                travelPreferences: {
                  budgetLevel: rest.budgetLevel,
                  activities: rest.activities || [],
                  dietary: dietaryText.split(',').map((d) => d.trim()).filter(Boolean),
                  transport: rest.transport,
                  pace: rest.pace,
                  currency: rest.currency,
                },
              })
            );
          }}
        >
          <Field label="Budget level" htmlFor="p-budget">
            <select id="p-budget" className="input" value={prefs.budgetLevel} onChange={(e) => setPrefs({ ...prefs, budgetLevel: e.target.value })}>
              <option value="budget">Budget</option>
              <option value="moderate">Moderate</option>
              <option value="luxury">Luxury</option>
            </select>
          </Field>
          <Field label="Default currency" htmlFor="p-cur">
            <select id="p-cur" className="input" value={prefs.currency} onChange={(e) => setPrefs({ ...prefs, currency: e.target.value })}>
              {[...new Set([prefs.currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Preferred transport" htmlFor="p-mode">
            <select id="p-mode" className="input" value={prefs.transport} onChange={(e) => setPrefs({ ...prefs, transport: e.target.value })}>
              {TRANSPORT_MODES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Travel pace" htmlFor="p-pace">
            <select id="p-pace" className="input" value={prefs.pace} onChange={(e) => setPrefs({ ...prefs, pace: e.target.value })}>
              <option value="relaxed">Relaxed</option>
              <option value="moderate">Moderate</option>
              <option value="packed">Packed</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <span className="label">Preferred activities</span>
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((i) => {
                const on = (prefs.activities || []).includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPrefs({ ...prefs, activities: on ? prefs.activities.filter((x) => x !== i) : [...(prefs.activities || []), i] })}
                    className={`chip border px-3 py-1.5 text-sm ${on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`}
                  >
                    {i}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:col-span-2">
            <Field label="Dietary preferences" htmlFor="p-diet" hint="Comma separated, e.g. vegetarian, halal, gluten_free (matched against OpenStreetMap diet tags)">
              <input id="p-diet" className="input" value={prefs.dietaryText} onChange={(e) => setPrefs({ ...prefs, dietaryText: e.target.value })} />
            </Field>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={prefsState.saving}>
              Save preferences
            </button>
            <Saved state={prefsState} />
          </div>
        </form>
      </Section>

      <Section title="Notifications" description="Choose which in-app notifications you receive. Each event is delivered once.">
        <ul className="divide-y divide-slate-100">
          {NOTIFICATION_CATEGORIES.map(([key, label, hint]) => (
            <li key={key} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-ink-500">{hint}</p>
              </div>
              <input type="checkbox" className="h-5 w-5" checked={notif[key] !== false} onChange={(e) => setNotif({ ...notif, [key]: e.target.checked })} aria-label={label} />
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium">Browser notifications</p>
              <p className="text-xs text-ink-500">{pushSupported ? 'Show a system notification while TripSync is open in a background tab.' : 'Not supported in this browser.'}</p>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5"
              disabled={!pushSupported}
              checked={Boolean(notif.browserPush)}
              aria-label="Browser notifications"
              onChange={async (e) => {
                const on = e.target.checked;
                if (on && window.Notification.permission !== 'granted') {
                  const res = await window.Notification.requestPermission();
                  if (res !== 'granted') return;
                }
                setNotif({ ...notif, browserPush: on });
              }}
            />
          </li>
        </ul>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={notifState.saving}
            onClick={() => saveNotif(() => updateProfile({ notificationPreferences: Object.fromEntries(Object.entries(notif).filter(([k]) => k !== '_id')) }))}
          >
            Save notification settings
          </button>
          <Saved state={notifState} />
        </div>
      </Section>

      <Section title="Location sharing & privacy" description="Live location is only collected while you have tracking turned on for a trip.">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={privacy.shareLocationWithParticipants} onChange={(e) => setPrivacy({ ...privacy, shareLocationWithParticipants: e.target.checked })} />
          <span>
            <strong>Show my live position to trip members</strong>
            <span className="block text-ink-500">When off, ETA and progress still work for you, but other members cannot see where you are.</span>
          </span>
        </label>
        <div className="mt-3 max-w-xs">
          <Field label="Keep my location history for (days)" htmlFor="p-ret" hint="Leave empty to use the server default. Applies to new location fixes.">
            <input id="p-ret" type="number" min="1" max="365" className="input" value={privacy.locationRetentionDays} onChange={(e) => setPrivacy({ ...privacy, locationRetentionDays: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={privacyState.saving}
            onClick={() =>
              savePrivacy(() =>
                updateProfile({ privacy: { shareLocationWithParticipants: privacy.shareLocationWithParticipants, locationRetentionDays: privacy.locationRetentionDays ? Number(privacy.locationRetentionDays) : null } })
              )
            }
          >
            Save privacy settings
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              if (!window.confirm('Permanently delete all of your stored location history?')) return;
              const r = await authApi.deleteLocationHistory();
              setHistoryMsg(`Deleted ${r.deleted} location record${r.deleted === 1 ? '' : 's'}.`);
            }}
          >
            Delete my location history
          </button>
          <Saved state={privacyState} />
          {historyMsg && <span className="text-sm text-emerald-700">{historyMsg}</span>}
        </div>
      </Section>

      <Section title="Account security">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            savePw(async () => {
              await authApi.changePassword(pw);
              setPw({ currentPassword: '', newPassword: '' });
            });
          }}
        >
          <Field label="Current password" htmlFor="p-cur-pw">
            <input id="p-cur-pw" type="password" autoComplete="current-password" className="input" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="p-new-pw">
            <input id="p-new-pw" type="password" autoComplete="new-password" className="input" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          </Field>
          <button type="submit" className="btn-primary" disabled={pwState.saving}>
            Change password
          </button>
        </form>
        <p className="mt-1 text-xs text-ink-500">Changing your password signs out every other device.</p>
        <div className="mt-2">
          <Saved state={pwState} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
          >
            Sign out
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await logout({ everywhere: true });
              navigate('/');
            }}
          >
            Sign out of all devices
          </button>
        </div>
      </Section>
    </div>
  );
}
