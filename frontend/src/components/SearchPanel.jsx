import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft } from 'lucide-react';
import { searchStreets, geocodeBuilding, saveSearch, getSearchHistory, deleteSearch } from '../lib/api';
import { 
  getAutocompleteByFirstLetter, 
  addToCache, 
  removeFromCache 
} from '../lib/searchCache';

const MANUAL_COORDS = {
  "21": { lat: 47.90479, lon: 28.29035 },
  "25": { lat: 47.90479, lon: 28.29035 },
  "67": { lat: 47.90616, lon: 28.28910 },
};

// Orașul prioritar
const PRIORITY_CITY = 'Florești';

export default function SearchPanel({ onSelectDestination, userPos }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedStreet, setSelectedStreet] = useState(null);
  const [error, setError] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);
  const [cachedSuggestions, setCachedSuggestions] = useState([]);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const history = await getSearchHistory(10);
    setSearchHistory(history);
  };

  // Handle input change with cache autocomplete
  const handleInputChange = (e) => {
    const value = e.target.value;
    setQ(value);
    setOpen(true);

    // Get cached suggestions based on first letter
    if (value.trim().length === 1) {
      const firstLetter = value.charAt(0);
      const suggestions = getAutocompleteByFirstLetter(firstLetter);
      setCachedSuggestions(suggestions);
    } else if (value.trim().length === 0) {
      setCachedSuggestions([]);
    }
  };

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setLoading(true);
    setError(null);

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchStreets(query, PRIORITY_CITY);
        if (controller.signal.aborted) return;
        let items = (data.results || []).filter(it => it.type === 'street');
        items = items.map(it => it.name === "str. 9 Mai" ? { ...it, name: "Strada 9 Mai" } : it);

        // === PRIORITIZEAZĂ FLOREȘTI ===
        const florestiItems = items.filter(it => it.parent_name === PRIORITY_CITY);
        const otherItems = items.filter(it => it.parent_name !== PRIORITY_CITY);

        // Afișează mai întâi cele din Florești, apoi celelalte
        const sortedItems = [...florestiItems, ...otherItems];
        setResults(sortedItems);

        if (sortedItems.length === 0) {
          setError('Ничего не найдено');
        } else {
          setError(null);
          // Add to cache on successful search
          await saveSearch(query);
          addToCache(query);
          loadHistory();
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError('Ошибка поиска. Попробуйте позже.');
          console.warn(e);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [q]);

  const handleStreetClick = (street) => {
    if (street.name === "str. 9 Mai") {
      street = { ...street, name: "Strada 9 Mai" };
    }
    setSelectedStreet(street);
    setCachedSuggestions([]); // Clear suggestions when street is selected
  };

  const handleCachedSuggestionClick = (query) => {
    setQ(query);
    setCachedSuggestions([]);
    setOpen(true);
  };

  const handleBuildingClick = async (b) => {
    if (!selectedStreet) return;
    let lat, lon;
    const streetName = selectedStreet.name;
    // FORȚEAZĂ orașul PRIORITY_CITY pentru geocodare
    const city = PRIORITY_CITY;

    if (streetName === "Strada 9 Mai" && MANUAL_COORDS[b]) {
      lat = MANUAL_COORDS[b].lat;
      lon = MANUAL_COORDS[b].lon;
    } else {
      try {
        const geo = await geocodeBuilding(streetName, b, city);
        if (geo.lat && geo.lon) {
          lat = geo.lat;
          lon = geo.lon;
        } else {
          const c = selectedStreet.centroid || { lat: 47.0124, lon: 28.8474 };
          lat = c.lat;
          lon = c.lon;
        }
      } catch (e) {
        console.warn('Geocoding error', e);
        const c = selectedStreet.centroid || { lat: 47.0124, lon: 28.8474 };
        lat = c.lat;
        lon = c.lon;
      }
    }

    const dest = {
      lat, lon,
      label: `${streetName}, ${b}, ${city}`,
      street: streetName,
      building: b,
      city: city,
    };

    onSelectDestination(dest, false);
    resetAfterSelect();
  };

  const handleDeleteHistoryItem = async (id) => {
    await deleteSearch(id);
    loadHistory();
  };

  const handleDeleteCacheItem = (query) => {
    removeFromCache(query);
    setCachedSuggestions(cachedSuggestions.filter(item => item.query !== query));
  };

  const resetAfterSelect = () => {
    setQ('');
    setSelectedStreet(null);
    setResults([]);
    setError(null);
    setCachedSuggestions([]);
  };

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setQ('');
    setResults([]);
    setSelectedStreet(null);
    setError(null);
    setCachedSuggestions([]);
  };

  const showHistory = !selectedStreet && q.trim().length === 1 && searchHistory.length > 0 && cachedSuggestions.length === 0;

  return (
    <div className="absolute top-3 left-3 right-3 z-30">
      <div className="bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl flex items-center px-3 py-2 gap-2">
        {selectedStreet ? (
          <button onClick={() => setSelectedStreet(null)} className="text-black/70"><ArrowLeft size={20} /></button>
        ) : (
          <Search size={20} className="text-black/70" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={selectedStreet ? `${selectedStreet.name}, ${PRIORITY_CITY}` : q}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          placeholder={selectedStreet ? 'Выберите номер дома...' : 'Поиск улицы...'}
          readOnly={false}
          className="flex-1 outline-none text-black placeholder:text-black/50 bg-transparent"
        />
        {(q || selectedStreet) && <button onClick={reset} className="text-black/50"><X size={18} /></button>}
      </div>

      {(open || selectedStreet) && (
        <div className="mt-2 bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl max-h-[60vh] overflow-auto">
          {!selectedStreet && (
            <>
              {/* === CACHED SUGGESTIONS (FIRST LETTER) === */}
              {cachedSuggestions.length > 0 && q.trim().length === 1 && (
                <div>
                  <div className="px-3 py-2 text-[12px] font-semibold text-black/70 border-b border-white/30">⚡ Căutări din cache - prima literă "{q.toUpperCase()}"</div>
                  {cachedSuggestions.map((item, idx) => (
                    <div key={`cache-${idx}`} className="flex items-center justify-between px-3 py-2 hover:bg-white/20 border-b border-white/30">
                      <button
                        onClick={() => handleCachedSuggestionClick(item.query)}
                        className="flex-1 text-left text-black text-sm"
                      >
                        {item.query}
                      </button>
                      <button
                        onClick={() => handleDeleteCacheItem(item.query)}
                        className="text-black/40 hover:text-red-500"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* === API SEARCH RESULTS === */}
              {q.trim().length >= 2 && (
                <>
                  {loading && <div className="px-4 py-3 text-black/70">Поиск...</div>}
                  {error && <div className="px-4 py-3 text-red-700">{error}</div>}
                  {!loading && results.length === 0 && q.length >= 2 && !error && <div className="px-4 py-3 text-black/70">Ничего не найдено</div>}
                  {results.map(s => {
                    const isPriority = s.parent_name === PRIORITY_CITY;
                    return (
                      <button
                        key={s.id}
                        onClick={() => handleStreetClick(s)}
                        className={`w-full text-left px-3 py-2.5 flex gap-3 hover:bg-white/20 border-b border-white/30 ${
                          isPriority ? 'bg-amber-50/30' : ''
                        }`}
                      >
                        <div className="w-9 h-9 rounded-full bg-amber-500/70 flex items-center justify-center text-white"><MapPin size={18} /></div>
                        <div className="flex-1">
                          <div className="text-black font-medium">
                            {s.name}
                            {isPriority && <span className="text-amber-600 text-xs ml-2">⭐</span>}
                          </div>
                          <div className="text-black/60 text-xs">
                            {s.parent_name || PRIORITY_CITY} · {s.count} домов
                          </div>
                        </div>
                        <ChevronRight size={16} className="text-black/40" />
                      </button>
                    );
                  })}
                </>
              )}

              {/* === RECENT SEARCHES (FULL HISTORY) === */}
              {showHistory && (
                <div>
                  <div className="px-3 py-2 text-[12px] font-semibold text-black/70 border-b border-white/30">📜 Căutări recente</div>
                  {searchHistory.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2 hover:bg-white/20 border-b border-white/30">
                      <button
                        onClick={() => {
                          setQ(item.query);
                          setOpen(true);
                        }}
                        className="flex-1 text-left text-black"
                      >
                        {item.query}
                      </button>
                      <button
                        onClick={() => handleDeleteHistoryItem(item.id)}
                        className="text-black/40 hover:text-red-500"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {selectedStreet && (
            <div className="p-3">
              <div className="text-black font-bold mb-2">Выберите номер дома ({selectedStreet.buildings?.length || 0}):</div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {(selectedStreet.buildings || []).map(b => (
                  <button
                    key={b}
                    onClick={() => handleBuildingClick(b)}
                    className="px-2 py-3 rounded-xl bg-white/40 border border-white/50 text-black font-bold hover:bg-white/60 flex justify-center gap-1"
                  >
                    <Building2 size={13} className="text-black/60" /> {b}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
