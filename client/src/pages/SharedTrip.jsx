import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import { tripApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Spinner, ErrorState, InlineError } from '../components/ui';
import TripMap from '../components/TripMap';
import { ItineraryList } from '../components/ItineraryViews';
import { formatDateRange } from '../utils/format';

/** Read-only itinerary behind a share link. Never shows live locations. */
export default function SharedTrip() {
  const { token } = useParams();
  const { status } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const { data, loading, error: loadError } = useAsync(() => tripApi.viewShared(token), [token, status]);

  if (loading) return <Spinner className="min-h-screen" label="Opening shared trip…" />;
  if (loadError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={loadError.status === 404 ? { status: 500, message: 'This share link is invalid, expired or has been revoked.' } : loadError} title="Link unavailable" />
      </div>
    );
  }

  const join = async () => {
    if (status !== 'authenticated') {
      navigate('/login', { state: { from: `/share/${token}` } });
      return;
    }
    try {
      const r = await tripApi.joinShared(token);
      navigate(`/trips/${r.tripId}`);
    } catch (err) {
      setError(toApiError(err));
    }
  };

  if (data.requiresSignIn) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <h1 className="text-xl font-semibold">{data.tripName}</h1>
        <p className="mt-2 text-sm text-ink-500">Sign in to join this trip as {data.linkRole}.</p>
        <button type="button" className="btn-primary mt-4" onClick={join}>
          Sign in to join
        </button>
      </div>
    );
  }

  const { trip, items, linkRole, myRole } = data;
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <Link to="/" className="flex items-center gap-2 font-bold">
        <img src="/favicon.svg" alt="" className="h-7 w-7" /> TripSync
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="chip bg-slate-100 text-slate-600">Shared itinerary · read only</p>
          <h1 className="mt-2 text-2xl font-bold">{trip.name}</h1>
          <p className="text-sm text-ink-500">
            {trip.origin?.name} → {trip.destination?.name} · {formatDateRange(trip.startDate, trip.endDate)} · times in {trip.timezone}
          </p>
          {trip.description && <p className="mt-1 text-sm">{trip.description}</p>}
        </div>
        {myRole ? (
          <Link to={`/trips/${trip.id}`} className="btn-primary">
            Open trip
          </Link>
        ) : (
          <button type="button" className="btn-primary" onClick={join}>
            Join as {linkRole}
          </button>
        )}
      </div>
      <InlineError error={error} />
      <TripMap items={items} timezone={trip.timezone} height={320} fallbackCenter={trip.destination?.coordinates} />
      {items.length ? <ItineraryList items={items} trip={{ ...trip, _id: trip.id }} warnings={[]} /> : <p className="text-sm text-ink-500">No activities planned yet.</p>}
    </div>
  );
}
