import { useState } from 'react';
import { useAsync } from '../hooks/useAsync';
import { tripApi } from '../services/endpoints';
import { Spinner, ErrorState, SourceBadge, EmptyState } from './ui';
import ItemFormModal from './ItemFormModal';
import { formatDistance, isoToZonedInput } from '../utils/format';

const CATS = [
  ['attractions', '🏛 Attractions'],
  ['food', '🍽 Food'],
  ['indoor', '🏠 Indoor'],
  ['transit', '🚉 Transit'],
  ['hotels', '🏨 Stays'],
  ['essentials', '⛽ Essentials'],
];

const CATEGORY_FOR = { food: 'meal', hotels: 'hotel_checkin', transit: 'transport', essentials: 'other', indoor: 'sightseeing', attractions: 'sightseeing' };

/** Nearby places around a point, with one-click "add to itinerary". */
export default function RecommendationsPanel({ trip, center, canEdit, onAdded, defaultDay = 1 }) {
  const [category, setCategory] = useState('attractions');
  const [radius, setRadius] = useState(1500);
  const [adding, setAdding] = useState(null);
  const point = center || trip.destination?.coordinates;
  const { data, loading, error, reload } = useAsync(
    () => (point ? tripApi.recommendations(trip._id, { lat: point.lat, lng: point.lng, category, radius }) : Promise.resolve(null)),
    [trip._id, point?.lat, point?.lng, category, radius]
  );

  if (!point) return <EmptyState icon="📍" title="No location yet">Add coordinates to the destination or select a stop to see nearby places.</EmptyState>;

  const now = new Date();
  const start = isoToZonedInput(new Date(Math.ceil(now.getTime() / 1800000) * 1800000).toISOString(), trip.timezone);
  const end = isoToZonedInput(new Date(Math.ceil(now.getTime() / 1800000) * 1800000 + 3600000).toISOString(), trip.timezone);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {CATS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setCategory(k)} className={`chip border px-3 py-1 text-sm ${category === k ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`}>
            {l}
          </button>
        ))}
        <select className="input w-auto py-1" value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Search radius">
          {[500, 1000, 1500, 3000, 5000].map((r) => (
            <option key={r} value={r}>
              within {formatDistance(r)}
            </option>
          ))}
        </select>
      </div>
      {loading && <Spinner label="Finding places nearby…" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && !data.available && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{data.reason}</p>}
      {data?.available && data.items.length === 0 && <EmptyState icon="🔍" title="Nothing found">Try a larger radius or another category.</EmptyState>}
      {data?.available && data.items.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs text-ink-500">
            <SourceBadge source={data.source} isDemo={data.isDemo} updatedAt={data.fetchedAt} /> {data.note}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.items.map((p) => (
              <li key={p.id} className="card flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-ink-500">
                    {p.kind.replace(/_/g, ' ')} · {formatDistance(p.distance)}
                    {p.cuisine ? ` · ${p.cuisine}` : ''}
                  </p>
                  {p.openingHours && (
                    <p className="text-xs text-ink-500">
                      🕘 {p.openingHours}
                      {p.openNow === true && <span className="text-emerald-700"> · open now</span>}
                      {p.openNow === false && <span className="text-rose-700"> · closed now</span>}
                    </p>
                  )}
                  {p.reasons?.length > 0 && <p className="text-xs text-brand-700">{p.reasons.join(' · ')}</p>}
                </div>
                {canEdit && (
                  <button type="button" className="btn-secondary flex-none px-3 py-1" onClick={() => setAdding(p)}>
                    Add
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {adding && (
        <ItemFormModal
          open
          trip={trip}
          onClose={() => setAdding(null)}
          defaults={{
            day: defaultDay,
            title: adding.name,
            category: CATEGORY_FOR[category],
            place: { name: adding.name, address: adding.address, coordinates: adding.coordinates },
            start,
            end,
            open: adding.parsedHours?.open,
            close: adding.parsedHours?.close,
            hoursSource: 'OpenStreetMap',
            isOutdoor: !adding.indoor && category === 'attractions',
            notes: adding.openingHours ? `Opening hours (OpenStreetMap): ${adding.openingHours}` : '',
          }}
          onSaved={() => onAdded?.()}
        />
      )}
    </div>
  );
}
