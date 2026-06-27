import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, timeout: 45000 });

// ===== CACHE PENTRU GEOCODARE (cu expirare) =====
const GEOCODE_CACHE_KEY = 'geocode_cache_v2';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 de zile

export function saveGeocodeCache(addressKey, lat, lon) {
  try {
    const cache = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
    cache[addressKey] = { lat, lon, timestamp: Date.now() };
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {}
}

export function getGeocodeCache(addressKey) {
  try {
    const cache = JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
    const entry = cache[addressKey];
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL)) {
      return entry;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ===== API FUNCȚII =====
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
  // Verifică cache-ul înainte de a face cerere
  const addressKey = `${street}|${building}|${city}`;
  const cached = getGeocodeCache(addressKey);
  if (cached) {
    return { lat: cached.lat, lon: cached.lon };
  }
  
  try {
    const { data } = await api.get('/geocode', { params: { street, building, city } });
    if (data.lat && data.lon) {
      saveGeocodeCache(addressKey, data.lat, data.lon);
    }
    return data;
  } catch (err) {
    console.warn('Geocode error:', err);
    return { lat: null, lon: null };
  }
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
