/**
 * Cache full addresses for Florești. Versioned keys discard old entries that
 * may point to a different house or locality.
 */
import { setGeocodeCache, getCachedGeocode } from './geocodeCache';

const CACHE_KEY = 'search_cache_addresses_v4';
const MAX_CACHE_SIZE = 100;
const CENTER = { lat: 47.89286, lon: 28.29854 };

function normalizeCity(city) {
  return String(city || 'Florești').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').replace(/[.,]/g, '');
}
function isValidCoord(lat, lon) {
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !latitude || !longitude) return false;
  const toRad = (n) => n * Math.PI / 180;
  const dLat = toRad(latitude - CENTER.lat), dLon = toRad(longitude - CENTER.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(CENTER.lat)) * Math.cos(toRad(latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 4000;
}

export function initCache() {
  if (!localStorage.getItem(CACHE_KEY)) localStorage.setItem(CACHE_KEY, JSON.stringify([]));
  return getCache();
}
export function getCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    const cleaned = Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object')
      .map((item) => ({ ...item, city: item.city || 'Florești', address: item.address || `${item.street || ''}, ${item.building || ''}, ${item.city || 'Florești'}` }))
      .filter((item) => normalizeCity(item.city) === 'floresti' && (!item.lat || !item.lon || isValidCoord(item.lat, item.lon))) : [];
    if (cleaned.length !== parsed.length) localStorage.setItem(CACHE_KEY, JSON.stringify(cleaned));
    return cleaned;
  } catch (err) { console.warn('Failed to read cache:', err); return []; }
}
export function addAddressToCache(streetName, buildingNumber, city, lat = null, lon = null) {
  if (normalizeCity(city) !== 'floresti') return;
  const address = `${streetName}, ${buildingNumber}, ${city || 'Florești'}`.trim();
  try {
    let cache = getCache().filter((item) => item.address.toLowerCase() !== address.toLowerCase());
    const valid = lat != null && lon != null && isValidCoord(lat, lon);
    const entry = { address, street: streetName, building: buildingNumber, city: city || 'Florești', lat: valid ? Number(lat) : null, lon: valid ? Number(lon) : null, timestamp: Date.now(), validated: valid };
    cache = [entry, ...cache].slice(0, MAX_CACHE_SIZE);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    if (valid) setGeocodeCache(streetName, buildingNumber, Number(lat), Number(lon), city || 'Florești');
  } catch (err) { console.warn('Failed to add address to cache:', err); }
}
export function getCachedAddress(street, building, city = 'Florești') {
  const address = getCache().find((item) => item.street?.toLowerCase() === String(street).toLowerCase() && String(item.building) === String(building) && normalizeCity(item.city) === normalizeCity(city));
  if (address && isValidCoord(address.lat, address.lon)) return address;
  const geocoded = getCachedGeocode(street, building, city);
  return geocoded ? { address: `${street}, ${building}, ${city}`, street, building, city, ...geocoded, timestamp: Date.now(), validated: true } : null;
}
export function clearCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([])); }
  catch (err) { console.warn('Failed to clear cache:', err); }
}
export function removeFromCache(address) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(getCache().filter((item) => item.address.toLowerCase() !== String(address).toLowerCase()))); }
  catch (err) { console.warn('Failed to remove from cache:', err); }
}
export function getCacheStats() {
  const items = getCache();
  return { totalItems: items.length, validatedItems: items.filter((item) => item.validated).length, maxSize: MAX_CACHE_SIZE, items };
}
