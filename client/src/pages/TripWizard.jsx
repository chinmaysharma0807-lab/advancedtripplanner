import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tripApi, itineraryApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import PlaceSearch from '../components/PlaceSearch';
import { Field, InlineError, SourceBadge, Spinner } from '../components/ui';
import { CURRENCIES, INTERESTS, TRANSPORT_MODES, COMMON_TIMEZONES, CATEGORY_ICON } from '../utils/constants';
import { formatTime, tripLengthDays } from '../utils/format';

const STEPS = ['Destination', 'Dates', 'Budget', 'Interests', 'Transport', 'Itinerary'];

const browserTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const todayPlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/** Draft review: edit titles, drop items, then save the generated itinerary. */
function DraftReview({ trip, draft, onSaved, onSkip }) {
  const [items, setItems] = useState(draft.items);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await itineraryApi.bulk(trip._id, { items, replaceExisting: false });
      onSaved();
    } catch (err) {
      setError(toApiError(err));
      setSaving(false);
    }
  };
  const byDay = items.reduce((acc, i, idx) => ((acc[i.day] = acc[i.day] || []).push([i, idx]), acc), {});
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Suggested itinerary ({items.length} activities)</h3>
        <SourceBadge source={draft.source} isDemo={draft.isDemo} />
      </div>
      {draft.warnings?.map((w) => (
        <p key={w} className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {w}
        </p>
      ))}
      <p className="mb-3 text-sm text-ink-500">Edit titles or remove activities now; you can fine-tune times, places and order later in the itinerary editor.</p>
      <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
        {Object.keys(byDay).map((day) => (
          <div key={day}>
            <h4 className="mb-1 text-xs font-semibold uppercase text-ink-500">Day {day}</h4>
            <ul className="space-y-1">
              {byDay[day].map(([item, idx]) => (
                <li key={idx} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <span aria-hidden="true">{CATEGORY_ICON[item.category]}</span>
                  <span className="w-24 flex-none text-xs text-ink-500">
                    {formatTime(item.scheduledStart, trip.timezone)}–{formatTime(item.scheduledEnd, trip.timezone)}
                  </span>
                  <input
                    className="input py-1"
                    value={item.title}
                    aria-label="Activity title"
                    onChange={(e) => setItems((list) => list.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                  />
                  {!item.coordinates && <span className="chip flex-none bg-amber-100 text-amber-800" title="No map location">no pin</span>}
                  <button type="button" className="btn-ghost flex-none px-2" aria-label={`Remove ${item.title}`} onClick={() => setItems((list) => list.filter((_, i) => i !== idx))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <InlineError error={error} />
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={saving || !items.length}>
          {saving ? 'Saving…' : 'Save itinerary'}
        </button>
        <button type="button" className="btn-secondary" onClick={onSkip}>
          Skip — start with an empty itinerary
        </button>
      </div>
    </div>
  );
}

export default function TripWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const prefs = user?.travelPreferences || {};
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: '',
    description: '',
    origin: { name: '' },
    destination: { name: '' },
    intermediateStops: [],
    startDate: todayPlus(7),
    endDate: todayPlus(10),
    timezone: browserTz(),
    travelers: 1,
    budget: 1000,
    currency: prefs.currency || 'INR',
    interests: prefs.activities || [],
    pace: prefs.pace || 'moderate',
    transportMode: prefs.transport || 'driving',
    accommodationName: '',
  });
  const [trip, setTrip] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v?.target ? v.target.value : v }));

  const stepValid = [
    form.destination.name.trim() && form.origin.name.trim(),
    form.startDate && form.endDate && form.endDate >= form.startDate,
    form.travelers >= 1 && form.budget >= 0,
    true,
    true,
  ];

  const createTrip = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await tripApi.create({
        name: form.name.trim() || `Trip to ${form.destination.name}`,
        description: form.description,
        origin: form.origin,
        destination: form.destination,
        intermediateStops: form.intermediateStops.filter((s) => s.name?.trim()),
        startDate: form.startDate,
        endDate: form.endDate,
        timezone: form.timezone,
        travelers: Number(form.travelers),
        budget: Number(form.budget),
        currency: form.currency,
        transportMode: form.transportMode,
        interests: form.interests,
        accommodation: form.accommodationName ? [{ name: form.accommodationName }] : [],
      });
      setTrip(created);
      setStep(5);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await itineraryApi.generate(trip._id, { pace: form.pace, interests: form.interests, budget: Number(form.budget), days: Math.min(tripLengthDays(trip), 21) }));
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Plan a new trip</h1>
      <ol className="mt-4 flex gap-1" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={`h-1.5 rounded-full ${i <= step ? 'bg-brand-600' : 'bg-slate-200'}`} />
            <span className={`mt-1 hidden text-xs sm:block ${i === step ? 'font-semibold text-brand-700' : 'text-ink-500'}`}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="card mt-6 p-5">
        {step === 0 && (
          <div className="space-y-4">
            <Field label="Trip name" htmlFor="w-name" hint="Optional — defaults to “Trip to …”">
              <input id="w-name" className="input" value={form.name} onChange={set('name')} maxLength={150} />
            </Field>
            <PlaceSearch label="Starting from" value={form.origin} onChange={set('origin')} required />
            <PlaceSearch label="Destination" value={form.destination} onChange={set('destination')} required />
            <div>
              <span className="label">Stops along the way</span>
              {form.intermediateStops.map((s, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <div className="flex-1">
                    <PlaceSearch value={s} onChange={(v) => setForm((f) => ({ ...f, intermediateStops: f.intermediateStops.map((x, j) => (j === i ? v : x)) }))} placeholder={`Stop ${i + 1}`} />
                  </div>
                  <button type="button" className="btn-ghost h-10" onClick={() => setForm((f) => ({ ...f, intermediateStops: f.intermediateStops.filter((_, j) => j !== i) }))} aria-label="Remove stop">
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="btn-secondary" onClick={() => setForm((f) => ({ ...f, intermediateStops: [...f.intermediateStops, { name: '' }] }))}>
                ＋ Add a stop
              </button>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="w-start">
              <input id="w-start" type="date" className="input" value={form.startDate} onChange={set('startDate')} />
            </Field>
            <Field label="End date" htmlFor="w-end" error={form.endDate < form.startDate ? 'End date must be after the start date' : null}>
              <input id="w-end" type="date" className="input" min={form.startDate} value={form.endDate} onChange={set('endDate')} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Destination time zone" htmlFor="w-tz" hint="Activity times are shown in this zone for everyone on the trip.">
                <select id="w-tz" className="input" value={form.timezone} onChange={set('timezone')}>
                  {[...new Set([form.timezone, ...COMMON_TIMEZONES])].map((tz) => (
                    <option key={tz}>{tz}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Travellers" htmlFor="w-trav">
              <input id="w-trav" type="number" min="1" max="100" className="input" value={form.travelers} onChange={set('travelers')} />
            </Field>
            <Field label="Total budget" htmlFor="w-budget">
              <input id="w-budget" type="number" min="0" step="1" className="input" value={form.budget} onChange={set('budget')} />
            </Field>
            <Field label="Currency" htmlFor="w-cur">
              <select id="w-cur" className="input" value={form.currency} onChange={set('currency')}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-3">
              <Field label="Accommodation" htmlFor="w-acc" hint="Optional — adds a fixed check-in to day 1 when generating">
                <input id="w-acc" className="input" value={form.accommodationName} onChange={set('accommodationName')} />
              </Field>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <span className="label">Interests</span>
              <div className="flex flex-wrap gap-2">
                {INTERESTS.map((i) => {
                  const on = form.interests.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setForm((f) => ({ ...f, interests: on ? f.interests.filter((x) => x !== i) : [...f.interests, i] }))}
                      className={`chip border px-3 py-1.5 text-sm ${on ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-ink-700'}`}
                    >
                      {i}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="label">Pace</span>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['relaxed', '🐢 Relaxed'],
                  ['moderate', '🚶 Moderate'],
                  ['packed', '⚡ Packed'],
                ].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={form.pace === k} onClick={() => set('pace')(k)} className={`rounded-xl border px-3 py-3 text-sm ${form.pace === k ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-200'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Description" htmlFor="w-desc">
              <textarea id="w-desc" className="input" rows={3} value={form.description} onChange={set('description')} />
            </Field>
          </div>
        )}
        {step === 4 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TRANSPORT_MODES.map(([k, l]) => (
              <button key={k} type="button" aria-pressed={form.transportMode === k} onClick={() => set('transportMode')(k)} className={`rounded-xl border px-3 py-4 text-sm ${form.transportMode === k ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-slate-200'}`}>
                {l}
              </button>
            ))}
            <p className="col-span-full text-xs text-ink-500">Driving, walking and cycling routes come from OpenStreetMap routing. Public transport and flights use labelled straight-line estimates.</p>
          </div>
        )}
        {step === 5 && trip && (
          <div>
            {!draft && !busy && (
              <div className="text-center">
                <p className="text-lg font-semibold">“{trip.name}” is saved 🎉</p>
                <p className="mt-1 text-sm text-ink-500">Generate a day-by-day plan from nearby places and your interests, then edit it before saving.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn-primary" onClick={generate}>
                    ✨ Generate itinerary
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => navigate(`/trips/${trip._id}`)}>
                    I&apos;ll build it myself
                  </button>
                </div>
              </div>
            )}
            {busy && <Spinner label="Building a draft itinerary…" />}
            {draft && <DraftReview trip={trip} draft={draft} onSaved={() => navigate(`/trips/${trip._id}`)} onSkip={() => navigate(`/trips/${trip._id}`)} />}
          </div>
        )}

        <InlineError error={error} />
        {step < 5 && (
          <div className="mt-6 flex justify-between">
            <button type="button" className="btn-secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
            {step < 4 ? (
              <button type="button" className="btn-primary" disabled={!stepValid[step]} onClick={() => setStep((s) => s + 1)}>
                Continue
              </button>
            ) : (
              <button type="button" className="btn-primary" disabled={busy} onClick={createTrip}>
                {busy ? 'Creating…' : 'Create trip'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
