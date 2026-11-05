/**
 * Geocode Cache - Stores verified coordinates for streets & buildings
 * Prevents recalculating same addresses multiple times
 */

// Bump the key to discard coordinates saved by the old, incorrect Florești bounds.
const GEOCODE_CACHE_KEY = 'geocode_cache_v2';
const MAX_GEOCODE_CACHE = 500;

const FALLBACK_COORDS = {
  // Approximate center of Florești, Moldova; used only when geocoding fails.
  default: { lat: 47.893, lon: 28.301 },
};

/**
 * Validate coordinates are within Moldova, rather than a tiny area near Chișinău.
 * This allows valid geocodes for Florești and nearby localities such as Varvareuca.
 */
function isValidCoord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const minLat = 45.3;
  const maxLat = 48.5;
  const minLon = 26.5;
  const maxLon = 30.9;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

/**
 * Get cache key for a street + building combo
 */
function getCacheKey(street, building, city = 'Florești') {
  return `${street}|${building}|${city}`.toLowerCase();
}

/**
 * Get all cached geocodes
 */
export function getGeocodeCache() {
  try {
    const cached = localStorage.getItem(GEOCODE_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch (err) {
    console.warn('Failed to read geocode cache:', err);
    return {};
  }
}

/**
 * Add or update a geocode in cache (only if it is in Moldova)
 */
export function setGeocodeCache(street, building, lat, lon, city = 'Florești') {
  if (!street || !building) return false;

  // Validate coordinates
  if (!isValidCoord(lat, lon)) {
    console.warn(`Invalid coordinates for ${street}, ${building}: lat=${lat}, lon=${lon}`);
    return false;
  }

  try {
    const cache = getGeocodeCache();
    const key = getCacheKey(street, building, city);
    
    cache[key] = {
      lat,
      lon,
      street,
      building,
      city,
      timestamp: Date.now(),
      validated: true,
    };

    // Limit cache size
    const keys = Object.keys(cache);
    if (keys.length > MAX_GEOCODE_CACHE) {
      // Remove oldest entries
      keys
        .sort((a, b) => cache[a].timestamp - cache[b].timestamp)
        .slice(0, keys.length - MAX_GEOCODE_CACHE)
        .forEach(k => delete cache[k]);
    }

    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch (err) {
    console.warn('Failed to set geocode cache:', err);
    return false;
  }
}

/**
 * Get cached geocode for street + building
 */
export function getCachedGeocode(street, building, city = 'Florești') {
  try {
    const cache = getGeocodeCache();
    const key = getCacheKey(street, building, city);
    const cached = cache[key];

    if (cached && isValidCoord(cached.lat, cached.lon)) {
      return { lat: cached.lat, lon: cached.lon };
    }
    return null;
  } catch (err) {
    console.warn('Failed to get cached geocode:', err);
    return null;
  }
}

/**
 * Clear entire geocode cache
 */
export function clearGeocodeCache() {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify({}));
  } catch (err) {
    console.warn('Failed to clear geocode cache:', err);
  }
}

/**
 * Get fallback coordinates for a street (centroid)
 * Used when API geocoding fails
 */
export function getFallbackCoord(street) {
  return FALLBACK_COORDS[street?.toLowerCase()] || FALLBACK_COORDS.default;
}

/**
 * Cache statistics
 */
export function getGeocodeCacheStats() {
  const cache = getGeocodeCache();
  return {
    totalItems: Object.keys(cache).length,
    maxSize: MAX_GEOCODE_CACHE,
    cache,
  };
}
