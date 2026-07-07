/**
 * Search Cache Utility
 * Caches full addresses (street + building number) in localStorage with autocomplete by first letter
 */

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
 * Add a full address to cache (street + building number + coordinates)
 * Example: "Strada 1 Mai, 15, Florești"
 */
export function addAddressToCache(streetName, buildingNumber, city, lat = null, lon = null) {
  const fullAddress = `${streetName}, ${buildingNumber}, ${city}`;
  
  if (!fullAddress || fullAddress.trim().length < 5) return;

  try {
    let cache = getCache();
    const normalizedAddress = fullAddress.trim();

    // Remove if already exists (we'll add it to the top)
    cache = cache.filter(item => 
      item.address.toLowerCase() !== normalizedAddress.toLowerCase()
    );

    // Add to the beginning (most recent first)
    cache.unshift({
      address: normalizedAddress,
      street: streetName,
      building: buildingNumber,
      city: city,
      lat: lat,
      lon: lon,
      timestamp: Date.now(),
    });

    // Keep only the most recent entries
    cache = cache.slice(0, MAX_CACHE_SIZE);

    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to add address to cache:', err);
  }
}

/**
 * Get cached addresses filtered by first letter
 * If letter is empty, return all recent addresses
 */
export function getAutocompleteByFirstLetter(letter) {
  const cache = getCache();

  if (!letter || letter.length === 0) {
    return cache;
  }

  const firstLetter = letter.charAt(0).toLowerCase();
  return cache.filter(item =>
    item.address.charAt(0).toLowerCase() === firstLetter
  );
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
  return {
    totalItems: cache.length,
    maxSize: MAX_CACHE_SIZE,
    items: cache,
  };
}