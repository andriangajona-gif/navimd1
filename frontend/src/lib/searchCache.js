/**
 * Search Cache Utility
 * Caches search queries in localStorage and provides autocomplete by first letter
 */

const CACHE_KEY = 'search_cache_streets';
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
 * Get all cached searches
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
 * Add a search query to cache (avoid duplicates)
 */
export function addToCache(query) {
  if (!query || query.trim().length === 0) return;

  try {
    let cache = getCache();
    const normalizedQuery = query.trim();

    // Remove if already exists (we'll add it to the top)
    cache = cache.filter(item => item.query.toLowerCase() !== normalizedQuery.toLowerCase());

    // Add to the beginning (most recent first)
    cache.unshift({
      query: normalizedQuery,
      timestamp: Date.now(),
    });

    // Keep only the most recent entries
    cache = cache.slice(0, MAX_CACHE_SIZE);

    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to add to cache:', err);
  }
}

/**
 * Get cached searches filtered by first letter
 * If letter is empty, return all recent searches
 */
export function getAutocompleteByFirstLetter(letter) {
  const cache = getCache();

  if (!letter || letter.length === 0) {
    return cache;
  }

  const firstLetter = letter.charAt(0).toLowerCase();
  return cache.filter(item =>
    item.query.charAt(0).toLowerCase() === firstLetter
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
 * Remove a specific query from cache
 */
export function removeFromCache(query) {
  try {
    let cache = getCache();
    cache = cache.filter(item => item.query.toLowerCase() !== query.toLowerCase());
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
