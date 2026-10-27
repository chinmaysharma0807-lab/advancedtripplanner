import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import { useTripSocket } from '../hooks/useTripSocket';
import { tripApi, itineraryApi, expenseApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Spinner, ErrorState, TripStatusBadge, Tabs, Stat, Modal, Field, InlineError, EmptyState, SourceBadge } from '../components/ui';
import TripMap from '../components/TripMap';
import WeatherPanel from '../components/WeatherPanel';
import RecommendationsPanel from '../components/RecommendationsPanel';
import ProposalCard from '../components/ProposalCard';
import ItemFormModal from '../components/ItemFormModal';
import { ItineraryList, ItineraryTimeline, ItineraryCalendar } from '../components/ItineraryViews';
import { formatDateRange, formatMoney, formatDateTime, timeAgo, tripLengthDays, toDateInput } from '../utils/format';
import { TRANSPORT_MODES, CURRENCIES } from '../utils/constants';

function EditTripModal({ trip, open, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    name: trip.name,
    description: trip.description || '',
    startDate: toDateInput(trip.startDate),
    endDate: toDateInput(trip.endDate),
    travelers: trip.travelers,
    budget: trip.budget,
    currency: trip.currency,
    transportMode: trip.transportMode,
    statusOverride: trip.statusOverride || '',
    accommodation: trip.accommodation?.[0]?.name || '',
    confirmation: trip.accommodation?.[0]?.confirmationNumber || '',
    autoCompleteOnDeparture: trip.trackingSettings?.autoCompleteOnDeparture || false,
    autoStartDwellMinutes: trip.trackingSettings?.autoStartDwellMinutes ?? 5,
    arrivalRadiusMeters: trip.trackingSettings?.arrivalRadiusMeters ?? 150,
  }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const isOwner = trip.myRole === 'owner';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const acc = trip.accommodation?.[0] || {};
      const body = {
        name: form.name,
        description: form.description,
        startDate: form.startDate,
        endDate: form.endDate,
        travelers: Number(form.travelers),
        budget: Number(form.budget),
        currency: form.currency,
        transportMode: form.transportMode,
        accommodation: form.accommodation
          ? [{ name: form.accommodation, address: acc.address, coordinates: acc.coordinates, checkIn: acc.checkIn, checkOut: acc.checkOut, confirmationNumber: form.confirmation || undefined }]
          : [],
      };
      if (isOwner) {
        body.statusOverride = form.statusOverride || null;
        body.trackingSettings = {
          autoCompleteOnDeparture: form.autoCompleteOnDeparture,
          autoStartDwellMinutes: Number(form.autoStartDwellMinutes),
          arrivalRadiusMeters: Number(form.arrivalRadiusMeters),
        };
      }
      await tripApi.update(trip._id, body);
      onSaved();
      onClose();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit trip" wide footer={<button type="submit" form="trip-form" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}>
      <form id="trip-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name" htmlFor="t-name">
            <input id="t-name" className="input" required value={form.name} onChange={set('name')} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="t-desc">
            <textarea id="t-desc" className="input" rows={2} value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <Field label="Start date" htmlFor="t-start" hint="Moving the start date shifts the whole itinerary">
          <input id="t-start" type="date" className="input" value={form.startDate} onChange={set('startDate')} />
        </Field>
        <Field label="End date" htmlFor="t-end">
          <input id="t-end" type="date" className="input" value={form.endDate} min={form.startDate} onChange={set('endDate')} />
        </Field>
        <Field label="Travellers" htmlFor="t-trav">
          <input id="t-trav" type="number" min="1" className="input" value={form.travelers} onChange={set('travelers')} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Budget" htmlFor="t-budget">
            <input id="t-budget" type="number" min="0" className="input" value={form.budget} onChange={set('budget')} />
          </Field>
          <Field label="Currency" htmlFor="t-cur">
            <select id="t-cur" className="input" value={form.currency} onChange={set('currency')}>
              {[...new Set([form.currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Transport" htmlFor="t-mode">
          <select id="t-mode" className="input" value={form.transportMode} onChange={set('transportMode')}>
            {TRANSPORT_MODES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Accommodation" htmlFor="t-acc">
          <input id="t-acc" className="input" value={form.accommodation} onChange={set('accommodation')} />
        </Field>
        <Field label="Booking confirmation" htmlFor="t-conf">
          <input id="t-conf" className="input" value={form.confirmation} onChange={set('confirmation')} />
        </Field>
        {isOwner && (
          <>
            <Field label="Status" htmlFor="t-status" hint="Automatic uses dates and real progress">
              <select id="t-status" className="input" value={form.statusOverride} onChange={set('statusOverride')}>
                <option value="">Automatic</option>
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
            <fieldset className="rounded-xl border border-slate-200 p-3 sm:col-span-2">
              <legend className="px-1 text-sm font-semibold">Tracking rules</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Arrival zone (m)" htmlFor="t-radius">
                  <input id="t-radius" type="number" min="20" max="2000" className="input" value={form.arrivalRadiusMeters} onChange={set('arrivalRadiusMeters')} />
                </Field>
                <Field label="Auto-start after (min in zone, 0 = always ask)" htmlFor="t-dwell">
                  <input id="t-dwell" type="number" min="0" max="120" className="input" value={form.autoStartDwellMinutes} onChange={set('autoStartDwellMinutes')} />
                </Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" checked={form.autoCompleteOnDeparture} onChange={set('autoCompleteOnDeparture')} />
                  Mark an activity completed when the traveller leaves its arrival zone (otherwise they are asked)
                </label>
              </div>
            </fieldset>
          </>
        )}
        <div className="sm:col-span-2">
          <InlineError error={error} />
        </div>
      </form>
    </Modal>
  );
}

function PeoplePanel({ trip, onChange }) {
  const { user } = useAuth();
  const isOwner = trip.myRole === 'owner';
  const [invite, setInvite] = useState({ email: '', role: 'viewer' });
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [newLink, setNewLink] = useState(null);
  const links = useAsync(() => (isOwner ? tripApi.shareLinks(trip._id) : Promise.resolve([])), [trip._id, isOwner]);

  const run = async (fn, success) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (success) setMsg(success);
      onChange();
    } catch (err) {
      setError(toApiError(err));
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 font-semibold">People on this trip</h3>
        <ul className="card divide-y divide-slate-100">
          <li className="flex items-center justify-between px-4 py-3 text-sm">
            <span>
              <strong>{trip.owner?.name}</strong> <span className="text-ink-500">{trip.owner?.email}</span>
            </span>
            <span className="chip bg-brand-100 text-brand-800">owner</span>
          </li>
          {trip.participants.map((p) => (
            <li key={p.userId?._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>
                <strong>{p.userId?.name}</strong> <span className="text-ink-500">{p.userId?.email}</span>
                {p.status === 'pending' && <span className="chip ml-2 bg-amber-100 text-amber-800">invited</span>}
              </span>
              <span className="flex items-center gap-2">
                {isOwner ? (
                  <select className="input w-auto py-1" value={p.role} aria-label={`Role for ${p.userId?.name}`} onChange={(e) => run(() => tripApi.updateParticipant(trip._id, p.userId._id, e.target.value), 'Role updated')}>
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                ) : (
                  <span className="chip bg-slate-100 text-slate-700">{p.role}</span>
                )}
                {(isOwner || String(p.userId?._id) === String(user.id)) && (
                  <button type="button" className="btn-ghost px-2 text-rose-700" onClick={() => run(() => tripApi.removeParticipant(trip._id, p.userId._id), 'Removed')}>
                    {String(p.userId?._id) === String(user.id) ? 'Leave' : 'Remove'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
      {isOwner && (
        <>
          <section>
            <h3 className="mb-2 font-semibold">Invite by email</h3>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => tripApi.invite(trip._id, invite), `Invitation sent to ${invite.email}`).then(() => setInvite({ email: '', role: invite.role }));
              }}
            >
              <input type="email" required className="input max-w-xs flex-1" placeholder="friend@example.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} aria-label="Email" />
              <select className="input w-auto" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} aria-label="Role">
                <option value="viewer">Viewer — follows the trip</option>
                <option value="editor">Editor — can change the itinerary</option>
              </select>
              <button type="submit" className="btn-primary">
                Invite
              </button>
            </form>
          </section>
          <section>
            <h3 className="mb-2 font-semibold">Share links</h3>
            <p className="mb-2 text-sm text-ink-500">Anyone with a link can read the itinerary (never live locations). Signed-in users can join with the link&apos;s role.</p>
            <div className="flex flex-wrap gap-2">
              {['viewer', 'editor'].map((role) => (
                <button
                  key={role}
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    run(async () => {
                      const l = await tripApi.createShareLink(trip._id, { role, expiresInDays: 14, allowAnonymousView: true });
                      setNewLink(`${window.location.origin}/share/${l.token}`);
                      links.reload({ silent: true });
                    })
                  }
                >
                  New {role} link (14 days)
                </button>
              ))}
            </div>
            {newLink && (
              <div className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm">
                Copy this link now — it is shown only once:
                <div className="mt-1 flex gap-2">
                  <input readOnly className="input" value={newLink} onFocus={(e) => e.target.select()} aria-label="Share link" />
                  <button type="button" className="btn-secondary" onClick={() => navigator.clipboard?.writeText(newLink)}>
                    Copy
                  </button>
                </div>
              </div>
            )}
            {links.data?.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {links.data.map((l) => (
                  <li key={l._id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <span>
                      {l.role} link · created {timeAgo(l.createdAt)} · {l.uses} joined{l.expiresAt ? ` · expires ${formatDateTime(l.expiresAt)}` : ''}
                    </span>
                    <button type="button" className="btn-ghost px-2 text-rose-700" onClick={() => run(() => tripApi.revokeShareLink(trip._id, l._id), 'Link revoked').then(() => links.reload({ silent: true }))}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {msg && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      <InlineError error={error} />
    </div>
  );
}

function ActivityLogPanel({ tripId, version }) {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(() => tripApi.activityLog(tripId, { page, limit: 25 }), [tripId, page, version]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data.data.length) return <EmptyState icon="📜" title="No changes yet">Every itinerary change — by people, GPS rules or the schedule checker — is recorded here.</EmptyState>;
  const fmt = (v) => (v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'string' && /^\d{4}-\d\d-\d\dT/.test(x) ? formatDateTime(x) : JSON.stringify(x)}`).join(', ') : '');
  return (
    <div>
      <ul className="card divide-y divide-slate-100">
        {data.data.map((e) => (
          <li key={e._id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{e.changedBy?.name || 'TripSync'}</strong> · {e.changeType.replace(/_/g, ' ')}
                {e.itemTitle ? ` · ${e.itemTitle}` : ''}
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-500">
                <span className="chip bg-slate-100 text-slate-600">{e.source}</span>
                {formatDateTime(e.createdAt)}
              </span>
            </div>
            {e.previousValues && <p className="mt-1 text-xs text-ink-500">Before: {fmt(e.previousValues)}</p>}
            {e.newValues && <p className="text-xs text-ink-500">After: {fmt(e.newValues)}</p>}
            {e.reason && <p className="mt-1 text-xs text-ink-700">Why: {e.reason}</p>}
          </li>
        ))}
      </ul>
      {data.meta.totalPages > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </button>
          <span className="self-center text-sm text-ink-500">
            Page {page} of {data.meta.totalPages}
          </span>
          <button type="button" className="btn-secondary" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Older
          </button>
        </div>
      )}
    </div>
  );
}

export default function TripDetails() {
  const { tripId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [view, setView] = useState('list');
  const [day, setDay] = useState(1);
  const [editing, setEditing] = useState(false);
  const [itemModal, setItemModal] = useState(null);
  const [logVersion, setLogVersion] = useState(0);
  const [actionError, setActionError] = useState(null);

  const trip = useAsync(() => tripApi.get(tripId), [tripId]);
  const itinerary = useAsync(() => itineraryApi.list(tripId), [tripId]);
  const proposals = useAsync(() => itineraryApi.proposals(tripId, { status: 'pending' }), [tripId]);
  const route = useAsync(() => itineraryApi.route(tripId, day), [tripId, day]);
  const budget = useAsync(() => expenseApi.summary(tripId), [tripId]);

  const refreshAll = useCallback(() => {
    trip.reload({ silent: true });
    itinerary.reload({ silent: true });
    proposals.reload({ silent: true });
    route.reload({ silent: true });
    setLogVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, day]);

  const { connection } = useTripSocket(
    tripId,
    {
      itinerary_updated: () => {
        itinerary.reload({ silent: true });
        route.reload({ silent: true });
        setLogVersion((v) => v + 1);
      },
      activity_status_changed: (e) => {
        itinerary.setData((d) => (d ? { ...d, items: d.items.map((i) => (i._id === e.itemId ? { ...i, status: e.status } : i)) } : d));
        setLogVersion((v) => v + 1);
      },
      trip_updated: () => trip.reload({ silent: true }),
      collaborator_joined: () => trip.reload({ silent: true }),
      reschedule_proposed: () => proposals.reload({ silent: true }),
      reschedule_resolved: () => proposals.reload({ silent: true }),
      expenses_updated: () => budget.reload({ silent: true }),
      trip_deleted: () => navigate('/dashboard'),
    },
    refreshAll
  );

  if (trip.loading && !trip.data) return <Spinner label="Loading trip…" />;
  if (trip.error) return <ErrorState error={trip.error} onRetry={trip.reload} />;
  const t = trip.data;
  const canEdit = t.myRole === 'owner' || t.myRole === 'editor';
  const items = itinerary.data?.items || [];
  const warnings = itinerary.data?.warnings || [];
  const days = tripLengthDays(t);

  const setStatus = async (item, status) => {
    setActionError(null);
    try {
      await itineraryApi.setStatus(item._id, status);
      itinerary.reload({ silent: true });
    } catch (err) {
      setActionError(toApiError(err));
    }
  };

  const dayPicker = (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
        <button key={d} type="button" onClick={() => setDay(d)} className={`chip border px-3 py-1 text-sm ${d === day ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white'}`}>
          Day {d}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{t.name}</h1>
            <TripStatusBadge status={t.status} />
            {t.isDemo && <span className="chip bg-fuchsia-100 text-fuchsia-800">Sample trip</span>}
            <span className={`chip ${connection === 'connected' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{connection === 'connected' ? '● live' : '○ reconnecting'}</span>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {t.origin?.name} → {t.intermediateStops?.map((s) => `${s.name} → `).join('')}
            {t.destination?.name} · {formatDateRange(t.startDate, t.endDate)} · times in {t.timezone}
          </p>
          {t.description && <p className="mt-1 max-w-3xl text-sm text-ink-700">{t.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/trips/${t._id}/live`} className="btn-primary">
            📡 Live tracking
          </Link>
          {canEdit && (
            <Link to={`/trips/${t._id}/itinerary`} className="btn-secondary">
              ✏️ Itinerary editor
            </Link>
          )}
          <Link to={`/trips/${t._id}/expenses`} className="btn-secondary">
            💶 Expenses
          </Link>
          {canEdit && (
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              Edit trip
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={async () => {
              const copy = await tripApi.duplicate(t._id);
              navigate(`/trips/${copy._id}`);
            }}
          >
            Duplicate
          </button>
          {t.myRole === 'owner' && (
            <button
              type="button"
              className="btn-ghost text-rose-700"
              onClick={async () => {
                if (window.confirm(`Delete "${t.name}" and all its itinerary, expenses and location history? This cannot be undone.`)) {
                  await tripApi.remove(t._id);
                  navigate('/dashboard');
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {proposals.data?.map((p) => (
        <ProposalCard key={p._id} proposal={p} trip={t} canEdit={canEdit} onResolved={refreshAll} />
      ))}

      <Tabs
        tabs={[
          ['overview', 'Overview'],
          ['itinerary', `Itinerary (${items.length})`],
          ['nearby', 'Nearby'],
          ['people', `People (${t.participants.filter((p) => p.status === 'accepted').length + 1})`],
          ['log', 'Activity log'],
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {dayPicker}
            <TripMap items={items.filter((i) => i.day === day)} route={route.data} timezone={t.timezone} fallbackCenter={t.destination?.coordinates} height={380} />
            {route.data && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                {route.data.available ? (
                  <>
                    Day {day} route: {(route.data.distance / 1000).toFixed(1)} km · {Math.round(route.data.duration / 60)} min travel <SourceBadge source={route.data.source} isDemo={route.data.isDemo} isEstimate={route.data.isEstimate} />
                    {route.data.note}
                  </>
                ) : (
                  route.data.reason
                )}
              </p>
            )}
            <h3 className="pt-2 font-semibold">Weather</h3>
            <WeatherPanel tripId={t._id} />
          </div>
          <aside className="space-y-4">
            <div className="card p-4">
              <h3 className="font-semibold">Budget</h3>
              {budget.data ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Stat label="Budget" value={formatMoney(budget.data.budget, t.currency)} />
                  <Stat label="Spent" value={formatMoney(budget.data.actual, t.currency)} tone={budget.data.actual > budget.data.budget ? 'text-rose-700' : ''} />
                  <Stat label="Planned costs" value={formatMoney(budget.data.planned, t.currency)} />
                  <Stat label="Remaining" value={formatMoney(budget.data.remaining, t.currency)} />
                </div>
              ) : (
                <Spinner />
              )}
              {budget.data?.warnings?.map((w) => (
                <p key={w.type} className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  {w.message}
                </p>
              ))}
            </div>
            <div className="card p-4">
              <h3 className="font-semibold">Bookings</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {t.accommodation?.map((a) => (
                  <li key={a._id}>
                    🏨 <strong>{a.name}</strong>
                    {a.confirmationNumber && <span className="text-ink-500"> · #{a.confirmationNumber}</span>}
                    {a.checkIn && <div className="text-xs text-ink-500">Check-in {formatDateTime(a.checkIn, t.timezone)}</div>}
                  </li>
                ))}
                {items
                  .filter((i) => i.bookingReference?.code || i.isFixedTime)
                  .map((i) => (
                    <li key={i._id}>
                      🎫 <strong>{i.title}</strong>
                      <div className="text-xs text-ink-500">
                        {formatDateTime(i.scheduledStart, t.timezone)}
                        {i.bookingReference?.code ? ` · ${i.bookingReference.provider || ''} ${i.bookingReference.code}` : ''}
                      </div>
                    </li>
                  ))}
                {!t.accommodation?.length && !items.some((i) => i.bookingReference?.code || i.isFixedTime) && <li className="text-ink-500">No bookings recorded.</li>}
              </ul>
            </div>
            <div className="card p-4 text-sm">
              <h3 className="font-semibold">Trip facts</h3>
              <dl className="mt-2 grid grid-cols-2 gap-y-1">
                <dt className="text-ink-500">Travellers</dt>
                <dd>{t.travelers}</dd>
                <dt className="text-ink-500">Transport</dt>
                <dd>{t.transportMode}</dd>
                <dt className="text-ink-500">Visibility</dt>
                <dd>{t.visibility}</dd>
                <dt className="text-ink-500">Your role</dt>
                <dd>{t.myRole}</dd>
              </dl>
              {t.activeTracking?.length > 0 && (
                <p className="mt-2 text-xs text-emerald-700">
                  Sharing location now: {t.activeTracking.map((s) => `${s.userId?.name} (${s.status})`).join(', ')}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      {tab === 'itinerary' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Itinerary view">
              {['list', 'timeline', 'calendar', 'map'].map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-lg px-3 py-1 text-sm capitalize ${view === v ? 'bg-white font-semibold shadow' : 'text-ink-500'}`}>
                  {v}
                </button>
              ))}
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => itineraryApi.recalculate(t._id).then(() => itinerary.reload({ silent: true }))}>
                  ↻ Recalculate travel times
                </button>
                <button type="button" className="btn-primary" onClick={() => setItemModal({ defaults: { day } })}>
                  ＋ Add activity
                </button>
              </div>
            )}
          </div>
          <InlineError error={actionError} />
          {warnings.filter((w) => !w.acknowledged).length > 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠ {warnings.filter((w) => !w.acknowledged).length} scheduling warning(s) — see the highlighted activities.</p>
          )}
          {itinerary.loading && !itinerary.data && <Spinner />}
          {itinerary.error && <ErrorState error={itinerary.error} onRetry={itinerary.reload} />}
          {itinerary.data && items.length === 0 && (
            <EmptyState icon="🗓️" title="No activities yet" action={canEdit && <Link to={`/trips/${t._id}/itinerary`} className="btn-primary">Open the itinerary editor</Link>}>
              Add activities manually or generate a draft itinerary in the editor.
            </EmptyState>
          )}
          {items.length > 0 && view === 'list' && (
            <ItineraryList
              items={items}
              trip={t}
              warnings={warnings}
              renderActions={
                canEdit
                  ? (item) => (
                      <>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setItemModal({ item })}>
                          Edit
                        </button>
                        {!['completed', 'skipped', 'cancelled'].includes(item.status) && (
                          <>
                            {item.status !== 'in_progress' && (
                              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setStatus(item, 'in_progress')}>
                                Start
                              </button>
                            )}
                            <button type="button" className="btn-ghost px-2 py-1 text-xs text-emerald-700" onClick={() => setStatus(item, 'completed')}>
                              Done
                            </button>
                            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setStatus(item, 'skipped')}>
                              Skip
                            </button>
                          </>
                        )}
                        {['completed', 'skipped', 'missed', 'cancelled'].includes(item.status) && (
                          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setStatus(item, 'upcoming')}>
                            Undo
                          </button>
                        )}
                      </>
                    )
                  : undefined
              }
            />
          )}
          {items.length > 0 && view === 'timeline' && (
            <>
              {dayPicker}
              <ItineraryTimeline items={items} trip={t} day={day} />
            </>
          )}
          {items.length > 0 && view === 'calendar' && (
            <ItineraryCalendar
              items={items}
              trip={t}
              onSelectDay={(d) => {
                setDay(d);
                setView('timeline');
              }}
            />
          )}
          {items.length > 0 && view === 'map' && (
            <>
              {dayPicker}
              <TripMap items={items.filter((i) => i.day === day)} route={route.data} timezone={t.timezone} height={460} fallbackCenter={t.destination?.coordinates} />
            </>
          )}
        </div>
      )}

      {tab === 'nearby' && (
        <div className="space-y-3">
          <p className="text-sm text-ink-500">Places near {t.destination?.name}. Adding one creates an activity and recalculates travel times for that day.</p>
          <RecommendationsPanel trip={t} canEdit={canEdit} onAdded={() => itinerary.reload({ silent: true })} defaultDay={day} />
        </div>
      )}

      {tab === 'people' && <PeoplePanel trip={t} onChange={() => trip.reload({ silent: true })} />}
      {tab === 'log' && <ActivityLogPanel tripId={t._id} version={logVersion} />}

      {editing && <EditTripModal trip={t} open onClose={() => setEditing(false)} onSaved={refreshAll} />}
      {itemModal && (
        <ItemFormModal open trip={t} item={itemModal.item} defaults={itemModal.defaults} onClose={() => setItemModal(null)} onSaved={() => itinerary.reload({ silent: true })} />
      )}
    </div>
  );
}
