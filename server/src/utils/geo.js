const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in meters between {lat,lng} points. */
function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Equirectangular projection around a reference latitude; accurate enough for
// point-to-route distances over a few hundred kilometres.
function project(p, refLat) {
  const x = toRad(p.lng) * Math.cos(toRad(refLat)) * EARTH_RADIUS_M;
  const y = toRad(p.lat) * EARTH_RADIUS_M;
  return { x, y };
}

/**
 * Distance in meters from `point` to a polyline given as [[lat,lng], ...], plus the
 * distance along the line to the closest point (useful for progress).
 */
function distanceToPolyline(point, polyline) {
  if (!polyline || polyline.length === 0) return { distance: Infinity, along: 0 };
  if (polyline.length === 1) {
    return { distance: haversine(point, { lat: polyline[0][0], lng: polyline[0][1] }), along: 0 };
  }
  const refLat = point.lat;
  const p = project(point, refLat);
  let best = Infinity;
  let bestAlong = 0;
  let travelled = 0;
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const a = project({ lat: polyline[i][0], lng: polyline[i][1] }, refLat);
    const b = project({ lat: polyline[i + 1][0], lng: polyline[i + 1][1] }, refLat);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen = Math.hypot(dx, dy);
    const t = segLen === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / segLen ** 2));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) {
      best = d;
      bestAlong = travelled + t * segLen;
    }
    travelled += segLen;
  }
  return { distance: best, along: bestAlong, total: travelled };
}

function polylineLength(polyline) {
  let total = 0;
  for (let i = 0; i < (polyline?.length || 0) - 1; i += 1) {
    total += haversine(
      { lat: polyline[i][0], lng: polyline[i][1] },
      { lat: polyline[i + 1][0], lng: polyline[i + 1][1] }
    );
  }
  return total;
}

/** Straight line between two points, densified so it renders sensibly on a map. */
function straightLine(a, b, segments = 20) {
  const out = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    out.push([a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t]);
  }
  return out;
}

const isValidCoordinates = (c) =>
  !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;

module.exports = { haversine, distanceToPolyline, polylineLength, straightLine, isValidCoordinates };
