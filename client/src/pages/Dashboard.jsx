import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import { tripApi } from '../services/endpoints';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { Spinner, ErrorState, EmptyState, TripStatusBadge, ProgressBar } from '../components/ui';
import { formatDateRange, formatMoney, timeAgo } from '../utils/format';

function TripCard({ trip }) {
  const live = trip.liveTracking?.length > 0;
  return (
    <Link to={`/trips/${trip._id}`} className="card block p-4 transition hover:-translate-y-0.5 hover:border-brand-300">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{trip.name}</h3>
          <p className="truncate text-sm text-ink-500">
            {trip.origin?.name} → {trip.destination?.name}
          </p>
        </div>
        <TripStatusBadge status={trip.status} />
      </div>
      <p className="mt-2 text-xs text-ink-500">{formatDateRange(trip.startDate, trip.endDate)} · {trip.travelers} traveller{trip.travelers === 1 ? '' : 's'}</p>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-ink-500">
          <span>
            {trip.itineraryStats.done}/{trip.itineraryStats.total} activities done
          </span>
          <span>
            {formatMoney(trip.actualSpending, trip.currency)} / {formatMoney(trip.budget, trip.currency)}
          </span>
        </div>
        <ProgressBar value={trip.itineraryStats.percent} label="Itinerary progress" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {trip.myRole !== 'owner' && <span className="chip bg-slate-100 text-slate-700">{trip.myRole}</span>}
        {trip.isDemo && <span className="chip bg-fuchsia-100 text-fuchsia-800">Sample trip</span>}
        {live && (
          <span className="chip bg-emerald-100 text-emerald-800">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" /> Live · {timeAgo(trip.liveTracking[0].lastUpdate)}
          </span>
        )}
      </div>
    </Link>
  );
}

function Invitations() {
  const { data, reload } = useAsync(() => tripApi.invitations(), []);
  const navigate = useNavigate();
  if (!data?.length) return null;
  return (
    <section className="card border-brand-200 bg-brand-50/50 p-4">
      <h2 className="font-semibold">Trip invitations</h2>
      <ul className="mt-2 space-y-2">
        {data.map((inv) => (
          <li key={inv.tripId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3">
            <span className="text-sm">
              <strong>{inv.owner?.name}</strong> invited you to <strong>{inv.name}</strong> as {inv.role}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className="btn-primary px-3 py-1"
                onClick={async () => {
                  await tripApi.acceptInvitation(inv.tripId);
                  navigate(`/trips/${inv.tripId}`);
                }}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                onClick={async () => {
                  await tripApi.declineInvitation(inv.tripId);
                  reload();
                }}
              >
                Decline
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { items: notifications } = useNotifications();
  const { data, loading, error, reload } = useAsync(() => tripApi.list({ limit: 100 }), []);

  if (loading) return <Spinner label="Loading your trips…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const trips = data.data;
  const active = trips.filter((t) => t.status === 'active');
  const upcoming = trips.filter((t) => t.status === 'upcoming');
  const completed = trips.filter((t) => t.status === 'completed').reverse();
  const totalSpent = trips.reduce((s, t) => s + (t.currency === user?.travelPreferences?.currency ? t.actualSpending : 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Hi {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-sm text-ink-500">
            {active.length} active · {upcoming.length} upcoming · {completed.length} completed
            {totalSpent > 0 ? ` · ${formatMoney(totalSpent, user.travelPreferences.currency)} spent across trips` : ''}
          </p>
        </div>
        <Link to="/trips/new" className="btn-primary">
          ＋ Plan a new trip
        </Link>
      </div>

      <Invitations />

      {trips.length === 0 ? (
        <EmptyState
          icon="🧳"
          title="No trips yet"
          action={
            <Link to="/trips/new" className="btn-primary">
              Plan your first trip
            </Link>
          }
        >
          Create a trip to build an itinerary, invite friends and track your journey live.
        </EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Active now</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {active.map((t) => (
                  <div key={t._id} className="space-y-2">
                    <TripCard trip={t} />
                    <Link to={`/trips/${t._id}/live`} className="btn-secondary w-full">
                      📡 Open live tracking
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-3 text-lg font-semibold">Upcoming</h2>
            {upcoming.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {upcoming.map((t) => (
                  <TripCard key={t._id} trip={t} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-500">No upcoming trips.</p>
            )}
          </section>
          {completed.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">Recently completed</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {completed.slice(0, 6).map((t) => (
                  <TripCard key={t._id} trip={t} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold">Latest updates</h2>
        {notifications.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing new. Reminders, delays and collaborator changes will appear here.</p>
        ) : (
          <ul className="card divide-y divide-slate-100">
            {notifications.slice(0, 6).map((n) => (
              <li key={n._id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-ink-500">{n.message}</p>
                </div>
                <span className="flex-none text-xs text-ink-500">{timeAgo(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
