import { useCallback, useEffect, useRef, useState } from 'react';
import { trackingApi } from '../services/endpoints';
import { toApiError } from '../services/api';

const MIN_SEND_INTERVAL_MS = 5000;
const MIN_MOVE_METERS = 10;
const QUEUE_LIMIT = 50;

function metersBetween(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const GEO_ERRORS = {
  1: { code: 'denied', message: 'Location permission was denied. Enable it in your browser settings to share your position.' },
  2: { code: 'unavailable', message: 'Your position is currently unavailable (no GPS or network fix).' },
  3: { code: 'timeout', message: 'Getting your position timed out. We will keep trying.' },
};

/**
 * Browser geolocation → TripSync. Watches position only while `active` is true and stops the
 * watch immediately when tracking is paused or stopped (no background tracking).
 * Fixes recorded while offline are queued and flushed in order on reconnect.
 */
export function useGeolocationTracker(tripId, { active, onSent } = {}) {
  const [fix, setFix] = useState(null);
  const [error, setError] = useState(null);
  const [permission, setPermission] = useState('unknown');
  const [queued, setQueued] = useState(0);
  const [lastSentAt, setLastSentAt] = useState(null);
  const watchId = useRef(null);
  const lastSent = useRef(null);
  const queue = useRef([]);
  const sending = useRef(false);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  useEffect(() => {
    if (!navigator.permissions?.query) return undefined;
    let status;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((s) => {
        status = s;
        setPermission(s.state);
        s.onchange = () => setPermission(s.state);
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  const flush = useCallback(async () => {
    if (sending.current || !queue.current.length) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const next = queue.current[0];
        try {
          const result = await trackingApi.sendLocation(tripId, next);
          queue.current.shift();
          setQueued(queue.current.length);
          setLastSentAt(new Date());
          onSentRef.current?.(result);
        } catch (err) {
          const e = toApiError(err);
          if (e.status === 0) break; // offline: keep the queue and retry later
          queue.current.shift(); // rejected by the server (e.g. tracking stopped): drop it
          setQueued(queue.current.length);
          setError({ code: e.code, message: e.message });
          if (e.code === 'TRACKING_NOT_ACTIVE') break;
        }
      }
    } finally {
      sending.current = false;
    }
  }, [tripId]);

  const handlePosition = useCallback(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy, speed, heading } = pos.coords;
      const point = { lat, lng, accuracy, timestamp: new Date(pos.timestamp).toISOString() };
      setFix(point);
      setError(null);
      setPermission('granted');
      const prev = lastSent.current;
      const due = !prev || pos.timestamp - prev.t >= MIN_SEND_INTERVAL_MS || metersBetween(prev, point) >= Math.max(MIN_MOVE_METERS, accuracy || 0);
      if (!due) return;
      lastSent.current = { ...point, t: pos.timestamp };
      queue.current.push({ ...point, speed: Number.isFinite(speed) ? speed : null, heading: Number.isFinite(heading) ? heading : null, source: 'browser_geolocation' });
      if (queue.current.length > QUEUE_LIMIT) queue.current.splice(0, queue.current.length - QUEUE_LIMIT);
      setQueued(queue.current.length);
      flush();
    },
    [flush]
  );

  useEffect(() => {
    if (!active || !supported) return undefined;
    watchId.current = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        const mapped = GEO_ERRORS[err.code] || { code: 'unknown', message: err.message };
        setError(mapped);
        if (err.code === 1) setPermission('denied');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    const onOnline = () => flush();
    window.addEventListener('online', onOnline);
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      window.removeEventListener('online', onOnline);
    };
  }, [active, supported, handlePosition, flush]);

  /** One-off permission request, made only when the user presses "Start sharing". */
  const requestPermission = useCallback(
    () =>
      new Promise((resolve) => {
        if (!supported) {
          resolve({ ok: false, error: { code: 'unsupported', message: 'This browser does not support location services.' } });
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setPermission('granted');
            resolve({ ok: true, position: pos });
          },
          (err) => {
            const mapped = GEO_ERRORS[err.code] || { code: 'unknown', message: err.message };
            setError(mapped);
            if (err.code === 1) setPermission('denied');
            resolve({ ok: err.code !== 1, error: mapped });
          },
          { enableHighAccuracy: true, timeout: 15000 }
        );
      }),
    [supported]
  );

  return { supported, fix, error, permission, queued, lastSentAt, requestPermission };
}
