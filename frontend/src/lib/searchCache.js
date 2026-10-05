/**
 * Search Cache Utility
 * Caches full addresses (street + building number) in localStorage
 */

import { setGeocodeCache, getCachedGeocode } from './geocodeCache';

const CACHE_KEY = 'search_cache_addresses';
const MAX_CACHE_SIZE = 100;

function normalizeCity(city) {
  if (!city) return 'floresti';
  return String(city)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]/g, '');
}

function isValidCoord(lat, lon) {
  if (!lat || !lon || typeof lat !== 'number' || typeof lon !== 'number') return false;
  const minLat = 45.3;
  const maxLat = 48.5;
  const minLon = 26.5;
  const maxLon = 30.9;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

export function initCache() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) {
    localStorage.setItem(CACHE_KEY, JSON.stringify([]));
  }
  return getCache();
}

export function getCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    const parsed = cached ? JSON.parse(cached) : [];
    const cleaned = Array.isArray(parsed)
      ? parsed
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            ...item,
            city: item.city || 'Florești',
            address: item.address || `${item.street || ''}, ${item.building || ''}, ${item.city || 'Florești'}`,
          }))
          .filter((item) => {
            const city = normalizeCity(item.city);
            const isFloresti = city.includes('floresti') || city.includes('floresti');
            const validCoords = !item.lat || !item.lon || isValidCoord(Number(item.lat), Number(item.lon));
            return isFloresti && validCoords;
          })
      : [];

    if (cleaned.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cleaned));
    }

    return cleaned;
  } catch (err) {
    console.warn('Failed to read cache:', err);
    return [];
  }
}

export function addAddressToCache(streetName, buildingNumber, city, lat = null, lon = null) {
  const fullAddress = `${streetName}, ${buildingNumber}, ${city}`;

  if (!fullAddress || fullAddress.trim().length < 5) return;

  try {
    let cache = getCache();
    const normalizedAddress = fullAddress.trim();
    const safeCity = city || 'Florești';

    if (lat != null && lon != null && !isValidCoord(Number(lat), Number(lon))) {
      console.warn(`Invalid coordinates for ${fullAddress}: lat=${lat}, lon=${lon}`);
      lat = null;
      lon = null;
    }

    cache = cache.filter((item) =>
      item.address.toLowerCase() !== normalizedAddress.toLowerCase()
    );

    const entry = {
      address: normalizedAddress,
      street: streetName,
      building: buildingNumber,
      city: safeCity,
      lat: lat,
      lon: lon,
      timestamp: Date.now(),
      validated: lat != null && lon != null,
    };

    cache.unshift(entry);
    cache = cache.slice(0, MAX_CACHE_SIZE);
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));

    if (lat != null && lon != null) {
      setGeocodeCache(streetName, buildingNumber, Number(lat), Number(lon), safeCity);
    }
  } catch (err) {
    console.warn('Failed to add address to cache:', err);
  }
}

export function getCachedAddress(street, building, city = 'Florești') {
  const cache = getCache();
  const address = cache.find((item) =>
    item.street.toLowerCase() === String(street).toLowerCase() &&
    item.building.toString() === building.toString() &&
    normalizeCity(item.city) === normalizeCity(city)
  );

  if (address && address.lat != null && address.lon != null && isValidCoord(Number(address.lat), Number(address.lon))) {
    return address;
  }

  const geocoded = getCachedGeocode(street, building, city);
  if (geocoded) {
    return {
      address: `${street}, ${building}, ${city}`,
      street,
      building,
      city,
      lat: geocoded.lat,
      lon: geocoded.lon,
      timestamp: Date.now(),
      validated: true,
    };
  }

  return null;
}

export function clearCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([]));
  } catch (err) {
    console.warn('Failed to clear cache:', err);
  }
}

export function removeFromCache(address) {
  try {
    let cache = getCache();
    cache = cache.filter((item) => item.address.toLowerCase() !== String(address).toLowerCase());
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to remove from cache:', err);
  }
}

export function getCacheStats() {
  const cache = getCache();
  const validated = cache.filter((item) => item.validated).length;
  return {
    totalItems: cache.length,
    validatedItems: validated,
    maxSize: MAX_CACHE_SIZE,
    items: cache,
  };
}
