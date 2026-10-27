import { useEffect, useState } from 'react';
import { Modal, Field, InlineError } from './ui';
import PlaceSearch from './PlaceSearch';
import { itineraryApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { CATEGORIES, PRIORITIES, TRANSPORT_MODES } from '../utils/constants';
import { formatDateTime, isoToZonedInput, zonedInputToIso, tripDayDate } from '../utils/format';

function initialState(item, trip, defaults) {
  if (item) {
    return {
      title: item.title,
      description: item.description || '',
      category: item.category,
      place: { name: item.location?.name || '', address: item.location?.address, coordinates: item.coordinates },
      start: isoToZonedInput(item.scheduledStart, trip.timezone),
      end: isoToZonedInput(item.scheduledEnd, trip.timezone),
      transportMode: item.transportMode || trip.transportMode,
      priority: item.priority,
      estimatedCost: item.estimatedCost ?? 0,
      isFixedTime: Boolean(item.isFixedTime),
      isOutdoor: Boolean(item.isOutdoor),
      open: item.operatingHours?.open || '',
      close: item.operatingHours?.close || '',
      bookingProvider: item.bookingReference?.provider || '',
      bookingCode: item.bookingReference?.code || '',
      notes: item.notes || '',
      link: item.links?.[0]?.url || '',
    };
  }
  const date = tripDayDate(trip, defaults?.day || 1);
  return {
    title: defaults?.title || '',
    description: defaults?.description || '',
    category: defaults?.category || 'sightseeing',
    place: defaults?.place || { name: '' },
    start: defaults?.start || `${date}T10:00`,
    end: defaults?.end || `${date}T11:30`,
    transportMode: trip.transportMode === 'flight' ? 'driving' : trip.transportMode,
    priority: 'medium',
    estimatedCost: 0,
    isFixedTime: false,
    isOutdoor: Boolean(defaults?.isOutdoor),
    open: defaults?.open || '',
    close: defaults?.close || '',
    bookingProvider: '',
    bookingCode: '',
    notes: defaults?.notes || '',
    link: '',
  };
}

/** Create or edit an itinerary activity, with server-side conflict confirmation. */
export default function ItemFormModal({ open, onClose, trip, item, defaults, onSaved }) {
  const [form, setForm] = useState(() => initialState(item, trip, defaults));
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initialState(item, trip, defaults));
      setError(null);
      setConflicts(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?._id]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const submit = async (confirmConflict = false) => {
    setSaving(true);
    setError(null);
    const body = {
      title: form.title,
      description: form.description,
      category: form.category,
      location: { name: form.place?.name || '', address: form.place?.address || '' },
      coordinates: form.place?.coordinates || null,
      scheduledStart: zonedInputToIso(form.start, trip.timezone),
      scheduledEnd: zonedInputToIso(form.end, trip.timezone),
      transportMode: form.transportMode,
      priority: form.priority,
      estimatedCost: Number(form.estimatedCost) || 0,
      isFixedTime: form.isFixedTime,
      isOutdoor: form.isOutdoor,
      operatingHours: form.open && form.close ? { open: form.open, close: form.close, source: defaults?.hoursSource || 'entered by user' } : null,
      bookingReference: { provider: form.bookingProvider, code: form.bookingCode },
      notes: form.notes,
      links: form.link ? [{ label: 'Link', url: form.link }] : [],
      ...(confirmConflict ? { confirmConflict: true } : {}),
    };
    try {
      const saved = item ? await itineraryApi.update(item._id, body) : (await itineraryApi.create(trip._id, body)).data;
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const e = toApiError(err);
      if (e.code === 'SCHEDULE_CONFLICT') setConflicts(e.details?.conflicts || []);
      else setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={item ? 'Edit activity' : 'Add activity'}
      wide
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="item-form" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save activity'}
          </button>
        </>
      }
    >
      <form
        id="item-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <div className="sm:col-span-2">
          <Field label="Title" htmlFor="it-title">
            <input id="it-title" className="input" required maxLength={200} value={form.title} onChange={set('title')} />
          </Field>
        </div>
        <Field label="Type" htmlFor="it-cat">
          <select id="it-cat" className="input" value={form.category} onChange={set('category')}>
            {CATEGORIES.map(([k, l, icon]) => (
              <option key={k} value={k}>
                {icon} {l}
              </option>
            ))}
          </select>
        </Field>
        <PlaceSearch label="Location" value={form.place} onChange={set('place')} />
        <Field label={`Start (${trip.timezone})`} htmlFor="it-start">
          <input id="it-start" type="datetime-local" className="input" required value={form.start} onChange={set('start')} />
        </Field>
        <Field label={`End (${trip.timezone})`} htmlFor="it-end">
          <input id="it-end" type="datetime-local" className="input" required value={form.end} onChange={set('end')} />
        </Field>
        <Field label="Getting there" htmlFor="it-mode">
          <select id="it-mode" className="input" value={form.transportMode} onChange={set('transportMode')}>
            {TRANSPORT_MODES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority" htmlFor="it-prio">
          <select id="it-prio" className="input" value={form.priority} onChange={set('priority')}>
            {PRIORITIES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Estimated cost (${trip.currency})`} htmlFor="it-cost">
          <input id="it-cost" type="number" min="0" step="0.01" className="input" value={form.estimatedCost} onChange={set('estimatedCost')} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Opens" htmlFor="it-open" hint="Optional">
            <input id="it-open" type="time" className="input" value={form.open} onChange={set('open')} />
          </Field>
          <Field label="Closes" htmlFor="it-close">
            <input id="it-close" type="time" className="input" value={form.close} onChange={set('close')} />
          </Field>
        </div>
        <Field label="Booking provider" htmlFor="it-bp">
          <input id="it-bp" className="input" value={form.bookingProvider} onChange={set('bookingProvider')} />
        </Field>
        <Field label="Booking reference" htmlFor="it-bc">
          <input id="it-bc" className="input" value={form.bookingCode} onChange={set('bookingCode')} />
        </Field>
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isFixedTime} onChange={set('isFixedTime')} /> Fixed time (booked — never moved automatically)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isOutdoor} onChange={set('isOutdoor')} /> Outdoor (check weather)
          </label>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="it-desc">
            <textarea id="it-desc" className="input" rows={2} value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="it-notes">
          <textarea id="it-notes" className="input" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
        <Field label="Link" htmlFor="it-link" hint="Tickets, menu, website">
          <input id="it-link" type="url" className="input" placeholder="https://" value={form.link} onChange={set('link')} />
        </Field>
        <div className="sm:col-span-2">
          <InlineError error={error} />
          {conflicts && (
            <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-900">This overlaps with:</p>
              <ul className="mt-1 list-inside list-disc text-amber-900">
                {conflicts.map((c) => (
                  <li key={c.id}>
                    {c.title} ({formatDateTime(c.scheduledStart, trip.timezone)})
                  </li>
                ))}
              </ul>
              <button type="button" className="btn mt-2 bg-amber-600 text-white hover:bg-amber-700" onClick={() => submit(true)} disabled={saving}>
                Keep both anyway
              </button>
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
