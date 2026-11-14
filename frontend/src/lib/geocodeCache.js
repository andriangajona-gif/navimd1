/**
 * Geocode cache for verified address coordinates.
 * Entries from previous versions are intentionally ignored because they may
 * contain coordinates for a different house/locality.
 */
const GEOCODE_CACHE_KEY = 'geocode_cache_v3';
const MAX_GEOCODE_CACHE = 500;
const FLORESTI_CENTER = { lat: 47.89286, lon: 28.29854 };
const MAX_DISTANCE_METERS = 4000;

function isValidCoord(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  const toRad = (n) => n * Math.PI / 180;
  const dLat = toRad(latitude - FLORESTI_CENTER.lat);
  const dLon = toRad(longitude - FLORESTI_CENTER.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(FLORESTI_CENTER.lat)) * Math.cos(toRad(latitude)) * Math.sin(dLon / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distance <= MAX_DISTANCE_METERS;
}

function getCacheKey(street, building, city = 'Florești') {
  return `${String(street).trim()}|${String(building).trim()}|${String(city).trim()}`.toLowerCase();
}

export function getGeocodeCache() {
  try { return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}'); }
  catch (err) { console.warn('Failed to read geocode cache:', err); return {}; }
}

export function setGeocodeCache(street, building, lat, lon, city = 'Florești') {
  if (!street || building == null || !isValidCoord(lat, lon)) return false;
  try {
    const cache = getGeocodeCache();
    cache[getCacheKey(street, building, city)] = { lat: Number(lat), lon: Number(lon), street, building, city, timestamp: Date.now(), validated: true };
    const keys = Object.keys(cache);
    if (keys.length > MAX_GEOCODE_CACHE) {
      keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp).slice(0, keys.length - MAX_GEOCODE_CACHE).forEach((key) => delete cache[key]);
    }
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch (err) { console.warn('Failed to save geocode cache:', err); return false; }
}

export function getCachedGeocode(street, building, city = 'Florești') {
  const cached = getGeocodeCache()[getCacheKey(street, building, city)];
  return cached && isValidCoord(cached.lat, cached.lon) ? { lat: Number(cached.lat), lon: Number(cached.lon) } : null;
}

export function clearGeocodeCache() {
  try { localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify({})); }
  catch (err) { console.warn('Failed to clear geocode cache:', err); }
}

// Kept for compatibility with any other caller; never use this as a house
// destination when exact geocoding failed.
export function getFallbackCoord() {
  return { ...FLORESTI_CENTER };
}

export function getGeocodeCacheStats() {
  const cache = getGeocodeCache();
  return { totalItems: Object.keys(cache).length, maxSize: MAX_GEOCODE_CACHE, cache };
}
