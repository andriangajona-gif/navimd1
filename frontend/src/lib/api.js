import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, timeout: 45000 });

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
  const { data } = await api.get('/geocode', { params: { street, building, city } });
  return data;
}

export const STYLE_URL = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'osm-tiles', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 },
  ],
};

export function formatDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `${Math.round(m)} м`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} км`;
}

export function formatDuration(s) {
  if (s == null) return '';
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} ч ${m} мин`;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ===== GEOCODARE INVERSĂ (click pe hartă) =====
export async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'NaviMD/1.0' }
    });
    const data = await response.json();
    if (data && data.display_name) {
      // Scurtăm adresa la un format rezonabil (max 60 caractere)
      let short = data.display_name;
      if (short.length > 60) short = short.substring(0, 57) + '...';
      return short;
    }
    return null;
  } catch (err) {
    console.warn('Reverse geocode failed', err);
    return null;
  }
}

// ===== ISTORIC CĂUTĂRI =====
export async function saveSearch(query) {
  try {
    const { data } = await api.post('/search/save', null, { params: { query } });
    return data;
  } catch (err) {
    console.warn('Failed to save search:', err);
    return null;
  }
}

export async function getSearchHistory(limit = 20) {
  try {
    const { data } = await api.get('/search/history', { params: { limit } });
    return data.history || [];
  } catch (err) {
    console.warn('Failed to get search history:', err);
    return [];
  }
}

export async function deleteSearch(searchId) {
  try {
    const { data } = await api.delete(`/search/history/${searchId}`);
    return data;
  } catch (err) {
    console.warn('Failed to delete search:', err);
    return null;
  }
}
