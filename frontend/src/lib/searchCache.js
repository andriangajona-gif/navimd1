/**
 * Search Cache Utility
 * Caches full addresses (street + building number) in localStorage
 */

import { setGeocodeCache, getCachedGeocode, isValidCoord } from './geocodeCache';

const CACHE_KEY = 'search_cache_addresses';
const MAX_CACHE_SIZE = 100;

/**
 * Initialize cache from localStorage
 */
export function initCache() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) {
    localStorage.setItem(CACHE_KEY, JSON.stringify([]));
  }
  return getCache();
}

/**
 * Get all cached addresses
 */
export function getCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch (err) {
    console.warn('Failed to read cache:', err);
    return [];
  }
}

/**
 * Validate coordinates before caching
 */
function isValidCoord(lat, lon) {
  if (!lat || !lon || typeof lat !== 'number' || typeof lon !== 'number') return false;
  const minLat = 46.9;
  const maxLat = 47.1;
  const minLon = 28.7;
  const maxLon = 28.95;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

/**
 * Add a full address to cache (street + building number + coordinates)
 * Also syncs to geocode cache for faster lookup
 */
export function addAddressToCache(streetName, buildingNumber, city, lat = null, lon = null) {
  const fullAddress = `${streetName}, ${buildingNumber}, ${city}`;
  
  if (!fullAddress || fullAddress.trim().length < 5) return;

  try {
    let cache = getCache();
    const normalizedAddress = fullAddress.trim();

    // Validate coordinates before adding
    if (lat && lon && !isValidCoord(lat, lon)) {
      console.warn(`Invalid coordinates for ${fullAddress}: lat=${lat}, lon=${lon}`);
      lat = null;
      lon = null;
    }

    // Remove if already exists (we'll add it to the top)
    cache = cache.filter(item => 
      item.address.toLowerCase() !== normalizedAddress.toLowerCase()
    );

    const entry = {
      address: normalizedAddress,
      street: streetName,
      building: buildingNumber,
      city: city,
      lat: lat,
      lon: lon,
      timestamp: Date.now(),
      validated: lat && lon ? true : false,
    };

    // Add to the beginning (most recent first)
    cache.unshift(entry);

    // Keep only the most recent entries
    cache = cache.slice(0, MAX_CACHE_SIZE);

    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));

    // Also cache in geocode cache if coordinates are valid
    if (lat && lon) {
      setGeocodeCache(streetName, buildingNumber, lat, lon, city);
    }
  } catch (err) {
    console.warn('Failed to add address to cache:', err);
  }
}

/**
 * Get a cached address with validated coordinates
 */
export function getCachedAddress(street, building, city = 'Florești') {
  const cache = getCache();
  const address = cache.find(item => 
    item.street.toLowerCase() === street.toLowerCase() &&
    item.building.toString() === building.toString() &&
    item.city.toLowerCase() === city.toLowerCase()
  );

  if (address && address.lat && address.lon && isValidCoord(address.lat, address.lon)) {
    return address;
  }

  // Try geocode cache
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

/**
 * Clear entire cache
 */
export function clearCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([]));
  } catch (err) {
    console.warn('Failed to clear cache:', err);
  }
}

/**
 * Remove a specific address from cache
 */
export function removeFromCache(address) {
  try {
    let cache = getCache();
    cache = cache.filter(item => item.address.toLowerCase() !== address.toLowerCase());
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to remove from cache:', err);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  const cache = getCache();
  const validated = cache.filter(item => item.validated).length;
  return {
    totalItems: cache.length,
    validatedItems: validated,
    maxSize: MAX_CACHE_SIZE,
    items: cache,
  };
}
