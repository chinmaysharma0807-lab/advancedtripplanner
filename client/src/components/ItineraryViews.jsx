import { StatusBadge, SourceBadge } from './ui';
import { CATEGORY_ICON } from '../utils/constants';
import { formatTime, formatDuration, formatDistance, formatMoney, tripDayDate, formatDate, tripLengthDays } from '../utils/format';

export const groupByDay = (items) =>
  items.reduce((acc, i) => {
    (acc[i.day] = acc[i.day] || []).push(i);
    return acc;
  }, {});

function WarningList({ warnings, itemId }) {
  const mine = warnings.filter((w) => w.itemId === String(itemId));
  if (!mine.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {mine.map((w, i) => (
        <li key={i} className={`rounded-lg px-2 py-1 text-xs ${w.severity === 'error' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
          ⚠ {w.message}
        </li>
      ))}
    </ul>
  );
}

export function TravelGap({ item }) {
  if (item.estimatedTravelTime === null || item.estimatedTravelTime === undefined) return null;
  return (
    <div className="ml-6 flex items-center gap-2 border-l-2 border-dashed border-slate-300 py-1 pl-4 text-xs text-ink-500">
      <span>
        {item.transportMode === 'walking' ? '🚶' : item.transportMode === 'cycling' ? '🚲' : item.transportMode === 'transit' ? '🚆' : '🚗'} {formatDuration(item.estimatedTravelTime)} · {formatDistance(item.travelDistance)}
      </span>
      <SourceBadge source={item.travelSource} isDemo={item.travelSource === 'demo'} isEstimate={item.travelSource === 'straight-line-estimate'} />
      {item.trafficKind && (
        <span className={`chip ${item.trafficDelayMinutes >= 5 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`} title={item.trafficKind === 'live' ? 'Live traffic' : 'Predicted traffic for the departure time'}>
          🚦 {item.trafficDelayMinutes > 0 ? `+${item.trafficDelayMinutes} min traffic` : 'no traffic delay'}
          {item.trafficKind === 'predicted' ? ' (predicted)' : ''}
        </span>
      )}
    </div>
  );
}

export function ItemCard({ item, trip, warnings = [], actions, compact = false }) {
  return (
    <div className={`card p-4 ${item.status === 'in_progress' ? 'ring-2 ring-brand-500' : ''} ${['skipped', 'cancelled', 'missed'].includes(item.status) ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden="true">{CATEGORY_ICON[item.category] || '📍'}</span>
            <h4 className="font-semibold">{item.title}</h4>
            <StatusBadge status={item.status} />
            {item.isFixedTime && <span className="chip bg-violet-100 text-violet-800">Booked</span>}
            {item.priority === 'must' && <span className="chip bg-rose-100 text-rose-700">Must do</span>}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {formatTime(item.scheduledStart, trip.timezone)} – {formatTime(item.scheduledEnd, trip.timezone)} · {formatDuration(item.estimatedDuration)}
            {item.location?.name ? ` · ${item.location.name}` : ''}
            {!item.coordinates && <span className="text-amber-700"> · no map location</span>}
          </p>
          {!compact && item.description && <p className="mt-1 text-sm text-ink-700">{item.description}</p>}
          {!compact && (
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-500">
              {item.estimatedCost > 0 && <span>💶 {formatMoney(item.estimatedCost, item.costCurrency || trip.currency)}</span>}
              {item.bookingReference?.code && <span>🎫 {item.bookingReference.provider} {item.bookingReference.code}</span>}
              {item.operatingHours?.open && (
                <span>
                  🕘 {item.operatingHours.open}–{item.operatingHours.close}
                </span>
              )}
              {item.eta && !['completed', 'in_progress'].includes(item.status) && <span>ETA {formatTime(item.eta, trip.timezone)}</span>}
              {item.links?.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" className="text-brand-700 underline">
                  {l.label || 'Link'}
                </a>
              ))}
            </div>
          )}
          {item.weatherFlag?.severity && (
            <p className={`mt-2 rounded-lg px-2 py-1 text-xs ${item.weatherFlag.severity === 'severe' ? 'bg-rose-50 text-rose-800' : 'bg-sky-50 text-sky-800'}`}>
              🌦 {item.weatherFlag.summary} {item.weatherFlag.isDemo ? '(DEMO forecast)' : `· ${item.weatherFlag.source}`}
            </p>
          )}
          {!compact && item.notes && <p className="mt-1 text-xs italic text-ink-500">{item.notes}</p>}
          <WarningList warnings={warnings} itemId={item._id} />
        </div>
        {actions && <div className="flex flex-none flex-col items-end gap-1">{actions}</div>}
      </div>
    </div>
  );
}

/** Day-grouped list with travel gaps between stops. */
export function ItineraryList({ items, trip, warnings, renderActions }) {
  const byDay = groupByDay(items);
  return (
    <div className="space-y-6">
      {Object.keys(byDay)
        .sort((a, b) => a - b)
        .map((day) => (
          <section key={day}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
              Day {day} · {formatDate(`${tripDayDate(trip, Number(day))}T12:00:00Z`, 'UTC')}
            </h3>
            <div className="space-y-1">
              {byDay[day].map((item, idx) => (
                <div key={item._id}>
                  {idx > 0 && <TravelGap item={item} />}
                  <ItemCard item={item} trip={trip} warnings={warnings} actions={renderActions?.(item)} />
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

/** Vertical hour-scaled timeline for one day. */
export function ItineraryTimeline({ items, trip, day }) {
  const dayItems = items.filter((i) => i.day === day);
  if (!dayItems.length) return <p className="text-sm text-ink-500">No activities on this day.</p>;
  const hourOf = (d) => {
    const [h, m] = formatTime(d, trip.timezone).split(':').map(Number);
    return h + (m || 0) / 60;
  };
  const startH = Math.max(0, Math.floor(Math.min(...dayItems.map((i) => hourOf(i.scheduledStart)))) - 1);
  const endH = Math.min(24, Math.ceil(Math.max(...dayItems.map((i) => hourOf(i.scheduledEnd) || 24))) + 1);
  const pxPerHour = 64;
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white" style={{ height: (endH - startH) * pxPerHour + 16 }}>
      {Array.from({ length: endH - startH + 1 }, (_, i) => (
        <div key={i} className="absolute left-0 right-0 border-t border-slate-100" style={{ top: i * pxPerHour + 8 }}>
          <span className="-mt-2 ml-2 inline-block bg-white px-1 text-[11px] text-ink-500">{String(startH + i).padStart(2, '0')}:00</span>
        </div>
      ))}
      {dayItems.map((item) => {
        const top = (hourOf(item.scheduledStart) - startH) * pxPerHour + 8;
        const endHour = hourOf(item.scheduledEnd) < hourOf(item.scheduledStart) ? 24 : hourOf(item.scheduledEnd);
        const h = Math.max(28, (endHour - hourOf(item.scheduledStart)) * pxPerHour - 4);
        return (
          <div key={item._id} className="absolute left-16 right-2 overflow-hidden rounded-xl border border-brand-200 bg-brand-50 px-3 py-1" style={{ top, height: h }}>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span aria-hidden="true">{CATEGORY_ICON[item.category]}</span>
              <span className="truncate">{item.title}</span>
              <StatusBadge status={item.status} />
            </div>
            <div className="text-xs text-ink-500">
              {formatTime(item.scheduledStart, trip.timezone)}–{formatTime(item.scheduledEnd, trip.timezone)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Calendar grid: one column per trip day. */
export function ItineraryCalendar({ items, trip, onSelectDay }) {
  const days = tripLengthDays(trip);
  const byDay = groupByDay(items);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {Array.from({ length: days }, (_, i) => i + 1).map((day) => (
        <button key={day} type="button" onClick={() => onSelectDay?.(day)} className="card min-h-[120px] p-2 text-left hover:border-brand-300">
          <div className="text-xs font-semibold uppercase text-ink-500">
            Day {day} · {formatDate(`${tripDayDate(trip, day)}T12:00:00Z`, 'UTC', { weekday: 'short', day: 'numeric', month: undefined })}
          </div>
          <ul className="mt-1 space-y-1">
            {(byDay[day] || []).slice(0, 6).map((it) => (
              <li key={it._id} className="truncate rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                {formatTime(it.scheduledStart, trip.timezone)} {it.title}
              </li>
            ))}
            {(byDay[day] || []).length > 6 && <li className="text-xs text-ink-500">+{byDay[day].length - 6} more</li>}
            {!byDay[day] && <li className="text-xs text-ink-500">Free day</li>}
          </ul>
        </button>
      ))}
    </div>
  );
}
