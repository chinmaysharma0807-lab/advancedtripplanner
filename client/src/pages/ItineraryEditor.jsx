import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAsync } from '../hooks/useAsync';
import { useTripSocket } from '../hooks/useTripSocket';
import { tripApi, itineraryApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { Spinner, ErrorState, InlineError, EmptyState, SourceBadge } from '../components/ui';
import ItemFormModal from '../components/ItemFormModal';
import ProposalCard from '../components/ProposalCard';
import TripMap from '../components/TripMap';
import { ItemCard, TravelGap } from '../components/ItineraryViews';
import { tripLengthDays, formatDate, tripDayDate, formatTime } from '../utils/format';
import { ITEM_STATUS, CATEGORY_ICON } from '../utils/constants';

function SortableItem({ item, trip, warnings, onEdit, onDelete, onStatus }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item._id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'relative z-10 opacity-80' : ''}>
      <div className="flex items-stretch gap-2">
        <button type="button" className="flex w-8 flex-none cursor-grab items-center justify-center rounded-xl border border-slate-200 bg-white text-ink-500 active:cursor-grabbing" aria-label={`Reorder ${item.title}`} {...attributes} {...listeners}>
          ⠿
        </button>
        <div className="flex-1">
          <ItemCard
            item={item}
            trip={trip}
            warnings={warnings}
            actions={
              <>
                <select className="input w-auto py-1 text-xs" value={item.status} onChange={(e) => onStatus(item, e.target.value)} aria-label={`Status of ${item.title}`}>
                  {Object.entries(ITEM_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <span className="flex gap-1">
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onEdit(item)}>
                    Edit
                  </button>
                  <button type="button" className="btn-ghost px-2 py-1 text-xs text-rose-700" onClick={() => onDelete(item)}>
                    Delete
                  </button>
                </span>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

export default function ItineraryEditor() {
  const { tripId } = useParams();
  const [day, setDay] = useState(1);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [reflow, setReflow] = useState(true);
  const [order, setOrder] = useState([]);
  const [draft, setDraft] = useState(null);
  const [generating, setGenerating] = useState(false);

  const trip = useAsync(() => tripApi.get(tripId), [tripId]);
  const itinerary = useAsync(() => itineraryApi.list(tripId), [tripId]);
  const proposals = useAsync(() => itineraryApi.proposals(tripId, { status: 'pending' }), [tripId]);
  const route = useAsync(() => itineraryApi.route(tripId, day), [tripId, day]);

  const items = itinerary.data?.items || [];
  const warnings = itinerary.data?.warnings || [];
  const dayItems = items.filter((i) => i.day === day);

  useEffect(() => {
    setOrder(dayItems.map((i) => i._id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itinerary.data, day]);

  const reload = useCallback(() => {
    itinerary.reload({ silent: true });
    route.reload({ silent: true });
    proposals.reload({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, day]);

  useTripSocket(tripId, { itinerary_updated: reload, activity_status_changed: reload, reschedule_proposed: reload, reschedule_resolved: reload }, reload);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (trip.loading && !trip.data) return <Spinner label="Loading editor…" />;
  if (trip.error) return <ErrorState error={trip.error} onRetry={trip.reload} />;
  const t = trip.data;
  if (!['owner', 'editor'].includes(t.myRole)) return <ErrorState error={{ status: 403 }} />;
  const days = tripLengthDays(t);

  const guard = async (fn, success) => {
    setError(null);
    setNotice(null);
    try {
      const r = await fn();
      if (success) setNotice(typeof success === 'function' ? success(r) : success);
      reload();
    } catch (err) {
      setError(toApiError(err));
      reload();
    }
  };

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(active.id), order.indexOf(over.id));
    setOrder(next);
    guard(() => itineraryApi.reorder(t._id, { day, orderedIds: next, reflow }), (r) =>
      reflow ? `Order saved and times updated${r.routing?.notes?.length ? ` · ${r.routing.notes[0]}` : ''}. Fixed-time bookings were not moved.` : 'Order saved.'
    );
  };

  const ordered = order.map((id) => dayItems.find((i) => i._id === id)).filter(Boolean);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      setDraft(await itineraryApi.generate(t._id, { days }));
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Link to={`/trips/${t._id}`} className="text-sm text-brand-700">
            ← {t.name}
          </Link>
          <h1 className="text-2xl font-bold">Itinerary editor</h1>
          <p className="text-sm text-ink-500">Drag activities to reorder. Times shown in {t.timezone}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={generate} disabled={generating}>
            {generating ? 'Generating…' : '✨ Generate suggestions'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => guard(() => itineraryApi.recalculate(t._id, { day }), (r) => `Travel times recalculated (${r.routing.sources.join(', ') || 'no routable legs'}).`)}>
            ↻ Recalculate day {day}
          </button>
          <button type="button" className="btn-primary" onClick={() => setModal({ defaults: { day } })}>
            ＋ Add activity
          </button>
        </div>
      </div>

      {proposals.data?.map((p) => (
        <ProposalCard key={p._id} proposal={p} trip={t} canEdit onResolved={reload} />
      ))}

      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Trip days">
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const count = items.filter((i) => i.day === d).length;
          return (
            <button key={d} type="button" role="tab" aria-selected={d === day} onClick={() => setDay(d)} className={`flex-none rounded-xl border px-3 py-2 text-left text-sm ${d === day ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white'}`}>
              <div className="font-semibold">Day {d}</div>
              <div className={`text-xs ${d === day ? 'text-brand-100' : 'text-ink-500'}`}>
                {formatDate(`${tripDayDate(t, d)}T12:00:00Z`, 'UTC')} · {count}
              </div>
            </button>
          );
        })}
      </div>

      <InlineError error={error} />
      {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          <label className="mb-2 flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={reflow} onChange={(e) => setReflow(e.target.checked)} />
            When reordering, re-time activities back-to-back (bookings stay fixed)
          </label>
          {itinerary.loading && !itinerary.data && <Spinner />}
          {itinerary.data && ordered.length === 0 && (
            <EmptyState icon="🗓️" title={`Nothing planned for day ${day}`} action={<button type="button" className="btn-primary" onClick={() => setModal({ defaults: { day } })}>Add an activity</button>}>
              Add activities, or generate suggestions from places near {t.destination?.name}.
            </EmptyState>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {ordered.map((item, idx) => (
                  <div key={item._id}>
                    {idx > 0 && <TravelGap item={item} />}
                    <SortableItem
                      item={item}
                      trip={t}
                      warnings={warnings}
                      onEdit={(it) => setModal({ item: it })}
                      onDelete={(it) => window.confirm(`Delete "${it.title}"?`) && guard(() => itineraryApi.remove(it._id), 'Activity deleted.')}
                      onStatus={(it, status) => guard(() => itineraryApi.setStatus(it._id, status), `Marked "${it.title}" as ${ITEM_STATUS[status].label.toLowerCase()}.`)}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        <aside className="space-y-3">
          <TripMap items={dayItems} route={route.data} timezone={t.timezone} height={340} fallbackCenter={t.destination?.coordinates} onSelectItem={(it) => setModal({ item: it })} />
          {route.data?.available && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
              {(route.data.distance / 1000).toFixed(1)} km · {Math.round(route.data.duration / 60)} min travel <SourceBadge source={route.data.source} isDemo={route.data.isDemo} isEstimate={route.data.isEstimate} />
            </p>
          )}
          <div className="card p-4">
            <h3 className="font-semibold">Schedule checks</h3>
            {warnings.filter((w) => dayItems.some((i) => i._id === w.itemId)).length === 0 ? (
              <p className="mt-1 text-sm text-emerald-700">✓ No conflicts on day {day}.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {warnings
                  .filter((w) => dayItems.some((i) => i._id === w.itemId))
                  .map((w, i) => (
                    <li key={i} className={`rounded-lg px-2 py-1 ${w.severity === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
                      {w.type.replace(/_/g, ' ')}: {w.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {draft && (
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">
              Suggested activities <SourceBadge source={draft.source} isDemo={draft.isDemo} />
            </h2>
            <span className="flex gap-2">
              <button type="button" className="btn-primary" onClick={() => guard(() => itineraryApi.bulk(t._id, { items: draft.items, replaceExisting: false }), 'Suggestions added.').then(() => setDraft(null))}>
                Add all {draft.items.length}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
                Discard
              </button>
            </span>
          </div>
          {draft.warnings?.map((w) => (
            <p key={w} className="mt-2 text-xs text-amber-800">
              {w}
            </p>
          ))}
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {draft.items.map((it, idx) => (
              <li key={idx} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                <span className="truncate">
                  {CATEGORY_ICON[it.category]} Day {it.day} · {formatTime(it.scheduledStart, t.timezone)} {it.title}
                </span>
                <button type="button" className="btn-ghost px-2 text-xs" onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }))} aria-label={`Remove ${it.title}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-500">Suggestions are added alongside your existing plan; resolve any overlaps afterwards.</p>
        </div>
      )}

      {modal && <ItemFormModal open trip={t} item={modal.item} defaults={modal.defaults} onClose={() => setModal(null)} onSaved={reload} />}
    </div>
  );
}
