import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'https://navimd1-7mbm.vercel.app'; 
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const api = axios.create({
  baseURL: BACKEND_URL,
});

export async function searchStreets(q) {
  const { data } = await api.get(`/search?q=${encodeURIComponent(q)}`);
  return data;
}

export async function getRoute(fromLat, fromLon, toLat, toLon, profile = 'driving') {
  const { data } = await api.post('/route', {
    from_lat: fromLat,
    from_lon: fromLon,
    to_lat: toLat,
    to_lon: toLon,
    profile: profile
  });
  return data;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // в метрах
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} м`;
  return `${(meters / 1000).toFixed(1)} км`;
}

export function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} мин`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs} ч ${remMins} мин`;
}

export async function recordTrip(track, label) {
  try {
    await api.post('/trips', { track, label });
  } catch (e) {
    console.warn('Не удалось сохранить трек на сервере:', e);
  }
}

export function getPreferredRoute(destLabel) {
  return null; 
}
