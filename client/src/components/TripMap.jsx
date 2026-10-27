import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ITEM_STATUS } from '../utils/constants';
import { formatTime } from '../utils/format';

const pinIcon = (label, color) =>
  L.divIcon({
    className: '',
    html: `<div class="ts-pin" style="width:26px;height:26px;background:${color}">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

const travellerIcon = (name, isDemo) =>
  L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center"><div class="ts-me" style="${isDemo ? 'background:#c026d3' : ''}"></div><div style="margin-top:2px;background:#fff;border-radius:6px;padding:0 4px;font-size:11px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.2)">${name}${isDemo ? ' (demo)' : ''}</div></div>`,
    iconSize: [80, 36],
    iconAnchor: [40, 9],
  });

function FitBounds({ points, follow }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join(';');
  useEffect(() => {
    if (!points.length) return;
    if (follow) {
      map.panTo(follow, { animate: true });
      return;
    }
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, follow?.[0], follow?.[1]]);
  return null;
}

/**
 * Interactive map: itinerary stops, the planned route, the path already travelled and live
 * traveller positions. Tiles © OpenStreetMap contributors.
 */
export default function TripMap({
  items = [],
  route = null,
  travelled = [],
  legRoute = null,
  travellers = [],
  timezone,
  highlightId,
  height = 360,
  followTraveller = null,
  fallbackCenter,
  onSelectItem,
}) {
  const stops = useMemo(() => items.filter((i) => i.coordinates), [items]);
  const points = useMemo(() => {
    const p = stops.map((s) => [s.coordinates.lat, s.coordinates.lng]);
    travellers.forEach((t) => t.coordinates && p.push([t.coordinates.lat, t.coordinates.lng]));
    if (!p.length && fallbackCenter) p.push([fallbackCenter.lat, fallbackCenter.lng]);
    return p;
  }, [stops, travellers, fallbackCenter]);
  const follow = followTraveller?.coordinates ? [followTraveller.coordinates.lat, followTraveller.coordinates.lng] : null;

  if (!points.length) {
    return (
      <div className="flex items-center justify-center rounded-2xl bg-slate-100 text-sm text-ink-500" style={{ height }}>
        Add locations to your activities to see them on the map.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200" style={{ height }}>
      <MapContainer center={points[0]} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds points={points} follow={follow} />
        {route?.geometry?.length > 1 && <Polyline positions={route.geometry} pathOptions={{ color: '#1473ef', weight: 4, opacity: 0.45, dashArray: route.isEstimate ? '6 8' : undefined }} />}
        {legRoute?.geometry?.length > 1 && <Polyline positions={legRoute.geometry} pathOptions={{ color: '#f59e0b', weight: 5, opacity: 0.85, dashArray: legRoute.isEstimate ? '6 8' : undefined }} />}
        {travelled.length > 1 && <Polyline positions={travelled} pathOptions={{ color: '#059669', weight: 4, opacity: 0.9 }} />}
        {stops.map((s, idx) => {
          const st = ITEM_STATUS[s.status] || ITEM_STATUS.upcoming;
          const color = String(s._id) === String(highlightId) ? '#f59e0b' : st.dot;
          return (
            <Marker key={s._id} position={[s.coordinates.lat, s.coordinates.lng]} icon={pinIcon(idx + 1, color)} eventHandlers={onSelectItem ? { click: () => onSelectItem(s) } : undefined}>
              <Popup>
                <strong>{s.title}</strong>
                <br />
                Day {s.day} · {formatTime(s.scheduledStart, timezone)}–{formatTime(s.scheduledEnd, timezone)}
                <br />
                {st.label}
              </Popup>
            </Marker>
          );
        })}
        {travellers
          .filter((t) => t.coordinates)
          .map((t) => (
            <span key={t.userId}>
              {t.accuracy > 0 && <Circle center={[t.coordinates.lat, t.coordinates.lng]} radius={t.accuracy} pathOptions={{ color: '#1473ef', weight: 1, fillOpacity: 0.08 }} />}
              <Marker position={[t.coordinates.lat, t.coordinates.lng]} icon={travellerIcon(t.userName || 'Traveller', t.isDemo)} zIndexOffset={1000}>
                <Popup>
                  {t.userName}
                  {t.isDemo ? ' — DEMO simulated position' : ''}
                  <br />
                  Updated {new Date(t.timestamp).toLocaleTimeString()}
                  {t.accuracy ? ` · ±${Math.round(t.accuracy)} m` : ''}
                </Popup>
              </Marker>
            </span>
          ))}
      </MapContainer>
    </div>
  );
}
