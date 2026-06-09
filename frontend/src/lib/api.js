import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, timeout: 15000 });

export async function searchStreets(q, location = 'Florești') {
  const { data } = await api.get('/search', { params: { q, location, lang: 'ro' } });
  return data;
}

export async function getRoute(fromLat, fromLon, toLat, toLon, profile = 'driving') {
  const { data } = await api.post('/route', {
    from_lat: fromLat, from_lon: fromLon, to_lat: toLat, to_lon: toLon, profile,
  });
  return data;
}

export async function geocodeBuilding(street, building, city = 'Florești') {
  const cityName = city && city.includes('raion') ? 'Florești' : (city || 'Florești');
  const { data } = await api.get('/geocode', { params: { street, building, city: cityName } });
  return data;
}

// ===== Система учёта дорог =====

const ROAD_STATS_KEY = 'road_stats';
const TRIP_HISTORY_KEY = 'trip_history';

export function recordTrip(track, destLabel) {
  try {
    const history = JSON.parse(localStorage.getItem(TRIP_HISTORY_KEY) || '[]');
    history.push({
      track,
      dest: destLabel,
      timestamp: Date.now(),
    });
    if (history.length > 50) history.splice(0, history.length - 50);
    localStorage.setItem(TRIP_HISTORY_KEY, JSON.stringify(history));

    const stats = JSON.parse(localStorage.getItem(ROAD_STATS_KEY) || '{}');
    for (let i = 0; i < track.length - 1; i++) {
      const key = segmentKey(track[i], track[i + 1]);
      stats[key] = (stats[key] || 0) + 1;
    }
    localStorage.setItem(ROAD_STATS_KEY, JSON.stringify(stats));
  } catch (e) {}
}

function segmentKey(p1, p2) {
  const r = (n) => Math.round(n * 1000) / 1000;
  return `${r(p1[1])},${r(p1[0])}-${r(p2[1])},${r(p2[0])}`;
}

export function scoreRoute(coords) {
  try {
    const stats = JSON.parse(localStorage.getItem(ROAD_STATS_KEY) || '{}');
    if (Object.keys(stats).length === 0) return 0;
    let score = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const key = segmentKey(coords[i], coords[i + 1]);
      score += stats[key] || 0;
    }
    return score;
  } catch (e) { return 0; }
}

export function getTopRoads() {
  try {
    const history = JSON.parse(localStorage.getItem(TRIP_HISTORY_KEY) || '[]');
    const destCount = {};
    history.forEach(trip => {
      destCount[trip.dest] = (destCount[trip.dest] || 0) + 1;
    });
    return Object.entries(destCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dest, count]) => ({ dest, count }));
  } catch (e) { return []; }
}

export function getPreferredRoute(destLabel) {
  try {
    const history = JSON.parse(localStorage.getItem(TRIP_HISTORY_KEY) || '[]');
    const trips = history.filter(t => t.dest === destLabel);
    if (trips.length < 2) return null;
    trips.sort((a, b) => b.timestamp - a.timestamp);
    return trips[0].track;
  } catch (e) { return null; }
}

// Принудительный экспорт заглушки, чтобы сборщик Vercel не ругался
export function speak(text) {
  console.log("Голос заглушен:", text);
}

// Современный векторный стиль с поддержкой динамических шрифтов
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export function formatDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m)} м`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} км`;
}

export function formatDuration(s) {
  if (s == null) return '';
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  return `${h} ч ${m} мин`;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
