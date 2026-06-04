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

export const STYLE_URL = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export function speak(text, lang = 'ru-RU') {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch (e) { /* noop */ }
}

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
