import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import { useTripSocket } from '../hooks/useTripSocket';
import { useGeolocationTracker } from '../hooks/useGeolocationTracker';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { tripApi, itineraryApi, trackingApi, miscApi } from '../services/endpoints';
import { toApiError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { emitWithAck } from '../socket/socket';
import TripMap from '../components/TripMap';
import ProposalCard from '../components/ProposalCard';
import { Spinner, ErrorState, Stat, ProgressBar, StatusBadge, SourceBadge, InlineError, Modal } from '../components/ui';
import { formatTime, formatDistance, formatDuration, timeAgo } from '../utils/format';
import { CATEGORY_ICON } from '../utils/constants';

/** Walks a polyline at a fixed speed and posts clearly-labelled DEMO positions. */
function useDemoSimulator(tripId, { geometry, active, onSent }) {
  const [running, setRunning] = useState(false);
  const idx = useRef(0);
  useEffect(() => {
    if (!running || !active || !geometry?.length) return undefined;
    const timer = setInterval(async () => {
      idx.current = Math.min(idx.current + 3, geometry.length - 1);
      const [lat, lng] = geometry[idx.current];
      try {
        const res = await trackingApi.sendLocation(tripId, { lat, lng, accuracy: 8, source: 'demo_simulator' });
        onSent?.(res);
      } catch {
        setRunning(false);
      }
      if (idx.current >= geometry.length - 1) setRunning(false);
    }, 2500);
    return () => clearInterval(timer);
  }, [running, active, geometry, tripId, onSent]);
  return {
    running,
    start: () => {
      idx.current = 0;
      setRunning(true);
    },
    stop: () => setRunning(false),
  };
}

export default function LiveTracking() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const online = useOnlineStatus();
  const [travellers, setTravellers] = useState({});
  const [mine, setMine] = useState(null);
  const [path, setPath] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [prompt, setPrompt] = useState(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [delayMinutes, setDelayMinutes] = useState(15);

  const trip = useAsync(() => tripApi.get(tripId), [tripId]);
  const itinerary = useAsync(() => itineraryApi.list(tripId), [tripId]);
  const proposals = useAsync(() => itineraryApi.proposals(tripId, { status: 'pending' }), [tripId]);
  const providers = useAsync(() => miscApi.providers(), []);

  const loadLatest = useCallback(async () => {
    try {
      const [latest, history] = await Promise.all([trackingApi.latest(tripId), trackingApi.history(tripId, { limit: 500 })]);
      setTravellers(
        Object.fromEntries(
          latest.travellers.map((s) => [
            s.userId,
            { userId: s.userId, userName: s.userName, coordinates: s.lastLocation?.coordinates, accuracy: s.lastLocation?.accuracy, timestamp: s.lastLocation?.timestamp, isDemo: s.lastLocation?.source === 'demo_simulator', progress: s.progress, status: s.status, targetItemId: s.targetItemId, deviation: s.deviation, route: s.route },
          ])
        )
      );
      setMine(latest.mine);
      setPath(history.data.map((h) => [h.coordinates.lat, h.coordinates.lng]).reverse());
    } catch (err) {
      setError(toApiError(err));
    }
  }, [tripId]);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const resync = useCallback(() => {
    loadLatest();
    itinerary.reload({ silent: true });
    proposals.reload({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLatest]);

  const addAlert = (a) => setAlerts((list) => [{ ...a, id: `${Date.now()}-${Math.random()}` }, ...list].slice(0, 6));

  const { connection } = useTripSocket(
    tripId,
    {
      trip_location_updated: (u) => {
        setTravellers((t) => ({ ...t, [u.userId]: { ...t[u.userId], ...u, status: 'active' } }));
        if (u.userId === user.id) {
          setPath((p) => [...p, [u.coordinates.lat, u.coordinates.lng]].slice(-2000));
          setMine((m) => (m?.status === 'active' ? { ...m, progress: u.progress, targetItemId: u.targetItemId } : m));
          if (mine?.status !== 'active') loadLatest();
        }
      },
      eta_updated: (e) => setTravellers((t) => (t[e.userId] ? { ...t, [e.userId]: { ...t[e.userId], progress: { ...t[e.userId].progress, ...e } } } : t)),
      route_deviation_detected: (e) => addAlert({ type: 'warning', text: `${e.userId === user.id ? 'You are' : 'A traveller is'} ${e.distanceMeters} m off the planned route. Route recalculated.` }),
      activity_status_changed: (e) => {
        itinerary.setData((d) => (d ? { ...d, items: d.items.map((i) => (i._id === e.itemId ? { ...i, status: e.status } : i)) } : d));
        addAlert({ type: 'info', text: `${e.title}: ${e.status.replace('_', ' ')}${e.reason ? ` — ${e.reason}` : ''}` });
      },
      itinerary_updated: () => itinerary.reload({ silent: true }),
      reschedule_proposed: () => proposals.reload({ silent: true }),
      reschedule_resolved: () => proposals.reload({ silent: true }),
      tracking_status_changed: (e) => {
        if (e.userId === user.id) loadLatest(); // same account started/stopped from another device
        setTravellers((t) => (t[e.userId] ? { ...t, [e.userId]: { ...t[e.userId], status: e.status } } : t));
        if (e.status === 'stopped') setTravellers((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== e.userId)));
      },
      arrival_detected: (e) => setPrompt({ kind: 'arrival', itemId: e.itemId, title: e.title }),
      completion_prompt: (e) => setPrompt({ kind: 'completion', itemId: e.itemId, title: e.title }),
    },
    resync
  );

  const isSharing = mine?.status === 'active';
  const onSent = useCallback((res) => res?.session && setMine(res.session), []);
  const geo = useGeolocationTracker(tripId, { active: isSharing, onSent });

  const items = itinerary.data?.items || [];
  const me = travellers[user.id];
  const rawProgress = me?.progress || mine?.progress;
  const current = items.find((i) => i.status === 'in_progress');
  const tracked = items.find((i) => i._id === (me?.targetItemId || mine?.targetItemId));
  // Once the tracked stop has started, the next destination is the following open stop.
  const target =
    tracked && tracked.status !== 'in_progress'
      ? tracked
      : items.find((i) => ['upcoming', 'approaching', 'delayed'].includes(i.status) && i.coordinates && (!current || new Date(i.scheduledStart) >= new Date(current.scheduledStart)));
  const progressForTarget = tracked && target && tracked._id === target._id;
  const myProgress = progressForTarget ? rawProgress : null; // the engine re-targets on the next fix
  const nextItems = items.filter((i) => ['upcoming', 'approaching', 'delayed', 'in_progress'].includes(i.status)).slice(0, 5);
  const legRoute = mine?.route || me?.route;
  const simulator = useDemoSimulator(tripId, { geometry: legRoute?.geometry, active: isSharing, onSent });

  const travellerList = useMemo(() => Object.values(travellers).filter((t) => t.coordinates), [travellers]);

  if (trip.loading && !trip.data) return <Spinner label="Loading live view…" />;
  if (trip.error) return <ErrorState error={trip.error} onRetry={trip.reload} />;
  const t = trip.data;
  const canShare = t.myRole === 'owner' || t.myRole === 'editor';

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const startSharing = async () => {
    const perm = await geo.requestPermission();
    if (!perm.ok) {
      setError(perm.error);
      setConsentOpen(false);
      return;
    }
    await run(async () => {
      setMine(await trackingApi.start(tripId));
      setConsentOpen(false);
      if (perm.position) {
        const { latitude: lat, longitude: lng, accuracy } = perm.position.coords;
        const res = await trackingApi.sendLocation(tripId, { lat, lng, accuracy, timestamp: new Date(perm.position.timestamp).toISOString(), source: 'browser_geolocation' });
        setMine(res.session);
      }
    });
  };

  const confirmStatus = async (itemId, status) => {
    const reply = await emitWithAck('activity_status_update', { tripId, itemId, status });
    if (!reply.ok) setError(reply.error);
    setPrompt(null);
  };

  const delayMin = myProgress?.delayMinutes;
  const nextStart = target ? new Date(target.scheduledStart) : null;
  const minutesUntilNext = nextStart ? Math.round((nextStart - Date.now()) / 60000) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to={`/trips/${t._id}`} className="text-sm text-brand-700">
            ← {t.name}
          </Link>
          <h1 className="text-2xl font-bold">Live tracking</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`chip ${connection === 'connected' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{connection === 'connected' ? '● Real-time connected' : '○ Reconnecting…'}</span>
          {!online && <span className="chip bg-amber-100 text-amber-800">Offline{geo.queued ? ` · ${geo.queued} fixes queued` : ''}</span>}
          {providers.data && (
            <span className="chip bg-slate-100 text-slate-600">
              Routing: {providers.data.routing}
              {providers.data.trafficAware ? ' · live traffic' : ' (no live traffic)'}
            </span>
          )}
        </div>
      </div>

      {proposals.data?.map((p) => (
        <ProposalCard key={p._id} proposal={p} trip={t} canEdit={canShare} onResolved={resync} />
      ))}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <TripMap items={items.filter((i) => !['skipped', 'cancelled'].includes(i.status))} travelled={path} legRoute={legRoute} travellers={travellerList} timezone={t.timezone} highlightId={target?._id} height={480} followTraveller={me} fallbackCenter={t.destination?.coordinates} />
          <p className="flex flex-wrap gap-3 text-xs text-ink-500">
            <span>
              <span className="mr-1 inline-block h-1 w-4 bg-emerald-600 align-middle" />
              Travelled
            </span>
            <span>
              <span className="mr-1 inline-block h-1 w-4 bg-amber-500 align-middle" />
              Route to next stop
            </span>
            {legRoute && <SourceBadge source={legRoute.source} isDemo={legRoute.isDemo} isEstimate={legRoute.isEstimate} />}
          </p>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <h2 className="font-semibold">Location sharing</h2>
            {!canShare ? (
              <p className="mt-1 text-sm text-ink-500">You are following this trip as a viewer. Travellers&apos; live positions appear here when they share them.</p>
            ) : !geo.supported ? (
              <p className="mt-1 text-sm text-rose-700">This browser does not support location services.</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink-500">
                  {isSharing
                    ? `Sharing with ${t.participants.filter((p) => p.status === 'accepted').length} other member(s) of this trip${user.privacy?.shareLocationWithParticipants === false ? ' — your privacy setting keeps it visible only to you' : ''}.`
                    : mine?.status === 'paused'
                      ? 'Paused — your position is not being collected.'
                      : 'Off. Your position is never collected unless you turn this on.'}
                </p>
                {geo.permission === 'denied' && <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1 text-xs text-rose-800">Location permission is blocked. Allow it in your browser&apos;s site settings, then try again.</p>}
                {geo.error && geo.permission !== 'denied' && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">{geo.error.message}</p>}
                {geo.fix?.accuracy > 150 && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">Low GPS accuracy (±{Math.round(geo.fix.accuracy)} m). Arrival detection pauses until accuracy improves.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!isSharing && (
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => setConsentOpen(true)}>
                      {mine?.status === 'paused' ? '▶ Resume sharing' : '📡 Start sharing'}
                    </button>
                  )}
                  {isSharing && (
                    <button type="button" className="btn-secondary" disabled={busy} onClick={() => run(async () => setMine(await trackingApi.pause(tripId)))}>
                      ⏸ Pause
                    </button>
                  )}
                  {(isSharing || mine?.status === 'paused') && (
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          simulator.stop();
                          setMine(await trackingApi.stop(tripId));
                        })
                      }
                    >
                      ⏹ Stop
                    </button>
                  )}
                </div>
                {isSharing && providers.data?.demoSimulationAllowed && legRoute?.geometry?.length > 1 && (
                  <div className="mt-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-2 text-xs text-fuchsia-900">
                    <strong>Demo simulator:</strong> move along the route to the next stop with simulated positions, labelled DEMO everywhere.
                    <button type="button" className="btn-secondary ml-2 px-2 py-0.5 text-xs" onClick={simulator.running ? simulator.stop : simulator.start}>
                      {simulator.running ? 'Stop simulation' : 'Simulate walk'}
                    </button>
                  </div>
                )}
                <p className="mt-2 text-xs text-ink-500">Last update: {me?.timestamp ? `${timeAgo(me.timestamp)}${me.isDemo ? ' (DEMO position)' : ''}` : geo.lastSentAt ? timeAgo(geo.lastSentAt) : '—'}</p>
              </>
            )}
            <InlineError error={error} />
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Next stop</h2>
              {myProgress?.source && <SourceBadge source={myProgress.source} isDemo={myProgress.isDemo} isEstimate={myProgress.isEstimate} updatedAt={myProgress.updatedAt} />}
            </div>
            {current && (
              <p className="mt-1 text-sm">
                Now: {CATEGORY_ICON[current.category]} <strong>{current.title}</strong> <StatusBadge status={current.status} />
              </p>
            )}
            {target ? (
              <>
                <p className="mt-1 text-sm">
                  {CATEGORY_ICON[target.category]} <strong>{target.title}</strong> at {formatTime(target.scheduledStart, t.timezone)} <StatusBadge status={target.status} />
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Stat label="Distance" value={formatDistance(myProgress?.distanceRemaining)} />
                  <Stat label="ETA" value={myProgress?.eta ? formatTime(myProgress.eta, t.timezone) : '—'} sub={myProgress?.durationRemaining != null ? formatDuration(myProgress.durationRemaining / 60) : null} />
                  <Stat label="Starts in" value={minutesUntilNext == null ? '—' : minutesUntilNext < 0 ? `${-minutesUntilNext} min ago` : formatDuration(minutesUntilNext)} />
                  <Stat label="Status" value={delayMin > (t.trackingSettings?.delayGraceMinutes ?? 10) ? `${delayMin} min late` : myProgress?.eta ? 'On time' : '—'} tone={delayMin > (t.trackingSettings?.delayGraceMinutes ?? 10) ? 'text-amber-700' : 'text-emerald-700'} />
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-xs text-ink-500">
                    <span>Leg progress</span>
                    <span>{myProgress?.percent ?? 0}%</span>
                  </div>
                  <ProgressBar value={myProgress?.percent} label="Route progress" />
                </div>
                {myProgress?.trafficAware && (
                  <p className={`mt-2 rounded-lg px-2 py-1 text-xs ${myProgress.trafficDelaySeconds >= 300 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
                    🚦{' '}
                    {myProgress.trafficDelaySeconds >= 60
                      ? `Traffic adds about ${Math.round(myProgress.trafficDelaySeconds / 60)} min to this leg (live traffic, ${myProgress.source}).`
                      : `No traffic delays on this leg right now (${myProgress.source}).`}
                  </p>
                )}
                {myProgress?.isEstimate && <p className="mt-2 text-xs text-amber-700">Routing is unavailable for this leg, so distance and ETA are straight-line estimates.</p>}
                {me?.deviation?.isDeviating && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">Off route by about {me.deviation.distanceMeters} m.</p>}
                {canShare && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => confirmStatus(target._id, 'in_progress')}>
                      I&apos;ve arrived
                    </button>
                    <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => confirmStatus(target._id, 'skipped')}>
                      Skip it
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-500">{isSharing ? 'No upcoming stop with a map location.' : 'Start sharing to see distance and ETA to your next stop.'}</p>
            )}
            {current && canShare && (
              <button type="button" className="btn-primary mt-3 w-full" onClick={() => confirmStatus(current._id, 'completed')}>
                ✓ Finish “{current.title}”
              </button>
            )}
            {canShare && (
              <form
                className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(async () => {
                    const { meta } = await itineraryApi.reportDelay(tripId, { minutes: Number(delayMinutes) });
                    if (meta?.message) addAlert({ type: 'info', text: meta.message });
                    proposals.reload({ silent: true });
                  });
                }}
              >
                Running late?
                <input type="number" min="1" max="720" className="input w-20 py-1" value={delayMinutes} onChange={(e) => setDelayMinutes(e.target.value)} aria-label="Delay in minutes" /> min
                <button type="submit" className="btn-secondary px-2 py-1 text-xs" disabled={busy}>
                  Suggest new times
                </button>
              </form>
            )}
          </div>

          {Object.values(travellers).filter((x) => x.userId !== user.id).length > 0 && (
            <div className="card p-4">
              <h2 className="font-semibold">Travellers</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {Object.values(travellers)
                  .filter((x) => x.userId !== user.id)
                  .map((x) => (
                    <li key={x.userId} className="flex justify-between gap-2">
                      <span>
                        {x.userName} {x.isDemo && <span className="chip bg-fuchsia-100 text-fuchsia-800">demo</span>}
                        {x.status === 'paused' && <span className="chip bg-slate-100 text-slate-600">paused</span>}
                      </span>
                      <span className="text-xs text-ink-500">
                        {x.progress?.eta ? `ETA ${formatTime(x.progress.eta, t.timezone)} · ` : ''}
                        {timeAgo(x.timestamp)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {alerts.length > 0 && (
            <div className="card p-4" aria-live="polite">
              <h2 className="font-semibold">Live alerts</h2>
              <ul className="mt-2 space-y-1 text-xs">
                {alerts.map((a) => (
                  <li key={a.id} className={`rounded-lg px-2 py-1 ${a.type === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-ink-700'}`}>
                    {a.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card p-4">
            <h2 className="font-semibold">Today&apos;s timeline</h2>
            <ol className="mt-2 space-y-2">
              {nextItems.map((i) => (
                <li key={i._id} className={`flex items-center justify-between gap-2 rounded-xl px-2 py-1 text-sm ${i._id === target?._id ? 'bg-amber-50' : ''}`}>
                  <span className="truncate">
                    {formatTime(i.scheduledStart, t.timezone)} {i.title}
                  </span>
                  <StatusBadge status={i.status} />
                </li>
              ))}
              {!nextItems.length && <li className="text-sm text-ink-500">Nothing left on the schedule.</li>}
            </ol>
          </div>
        </aside>
      </div>

      <Modal
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="Share your live location?"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConsentOpen(false)}>
              Not now
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={startSharing}>
              {busy ? 'Starting…' : 'Allow and start'}
            </button>
          </>
        }
      >
        <ul className="list-inside list-disc space-y-1 text-sm text-ink-700">
          <li>Your browser will ask for location permission.</li>
          <li>Your position is sent only while this page is open and sharing is on.</li>
          <li>Only accepted members of “{t.name}” can see it{user.privacy?.shareLocationWithParticipants === false ? ' — your settings currently keep it private to you' : ''}.</li>
          <li>Location history is kept for a limited time and you can delete it in Settings.</li>
          <li>Arriving near a stop never marks it complete on its own — you stay in control.</li>
        </ul>
      </Modal>

      <Modal
        open={Boolean(prompt)}
        onClose={() => setPrompt(null)}
        title={prompt?.kind === 'arrival' ? `Arrived at ${prompt?.title}?` : `Finished ${prompt?.title}?`}
        footer={
          prompt?.kind === 'arrival' ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPrompt(null)}>
                Not yet
              </button>
              <button type="button" className="btn-primary" onClick={() => confirmStatus(prompt.itemId, 'in_progress')}>
                Yes, start it
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPrompt(null)}>
                Still here
              </button>
              <button type="button" className="btn-primary" onClick={() => confirmStatus(prompt.itemId, 'completed')}>
                Mark completed
              </button>
            </>
          )
        }
      >
        <p className="text-sm text-ink-700">{prompt?.kind === 'arrival' ? 'You are inside the arrival zone for this activity.' : 'You appear to have left the area of this activity.'}</p>
      </Modal>
    </div>
  );
}
