import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft } from 'lucide-react';
import { searchStreets, geocodeBuilding, saveSearch, getSearchHistory, deleteSearch } from '../lib/api';
import { 
  getCache,
  addAddressToCache, 
  removeFromCache,
  getCachedAddress,
} from '../lib/searchCache';
import { getFallbackCoord, getCachedGeocode, setGeocodeCache } from '../lib/geocodeCache';

const MANUAL_COORDS = {
  "21": { lat: 47.90479, lon: 28.29035 },
  "25": { lat: 47.90479, lon: 28.29035 },
  "67": { lat: 47.90616, lon: 28.28910 },
};

// Căutarea și geocodarea sunt limitate la acest oraș.
const PRIORITY_CITY = 'Florești';

function normalizePlaceName(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ');
}

export default function SearchPanel({ onSelectDestination, userPos }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedStreet, setSelectedStreet] = useState(null);
  const [error, setError] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);
  const [cachedAddresses, setCachedAddresses] = useState([]);
  const [showCacheOnFocus, setShowCacheOnFocus] = useState(false);
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

  const handleInputFocus = () => {
    setOpen(true);
    if (q.trim().length === 0) {
      const cached = getCache();
      setCachedAddresses(cached);
      setShowCacheOnFocus(true);
    }
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setQ(value);
    setOpen(true);
    if (value.trim().length > 0) {
      setShowCacheOnFocus(false);
      setCachedAddresses([]);
    } else {
      const cached = getCache();
      setCachedAddresses(cached);
      setShowCacheOnFocus(true);
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

        // Strictly exclude matches from Varvareuca and all other localities.
        const items = (data.results || [])
          .filter(it => it.type === 'street')
          .filter(it => normalizePlaceName(it.parent_name) === normalizePlaceName(PRIORITY_CITY))
          .map(it => it.name === "str. 9 Mai" ? { ...it, name: "Strada 9 Mai" } : it);

        setResults(items);
        if (items.length === 0) {
          setError('Ничего не найдено');
        } else {
          setError(null);
          await saveSearch(query);
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
    setCachedAddresses([]);
    setShowCacheOnFocus(false);
  };

  const handleCachedAddressClick = async (cachedAddress) => {
    let lat = cachedAddress.lat;
    let lon = cachedAddress.lon;

    if (!lat || !lon) {
      const geocoded = getCachedGeocode(cachedAddress.street, cachedAddress.building, PRIORITY_CITY);
      if (geocoded) {
        lat = geocoded.lat;
        lon = geocoded.lon;
      }
    }

    if (!lat || !lon) {
      try {
        const geo = await geocodeBuilding(cachedAddress.street, cachedAddress.building, PRIORITY_CITY);
        if (geo.lat && geo.lon) {
          lat = geo.lat;
          lon = geo.lon;
          setGeocodeCache(cachedAddress.street, cachedAddress.building, lat, lon, PRIORITY_CITY);
          addAddressToCache(cachedAddress.street, cachedAddress.building, PRIORITY_CITY, lat, lon);
        }
      } catch (e) {
        console.warn('Geocoding error for cached address:', e);
      }
    }

    if (!lat || !lon) {
      const fallback = getFallbackCoord(cachedAddress.street);
      lat = fallback.lat;
      lon = fallback.lon;
    }

    const dest = {
      lat,
      lon,
      label: `${cachedAddress.street}, ${cachedAddress.building}, ${PRIORITY_CITY}`,
      street: cachedAddress.street,
      building: cachedAddress.building,
      city: PRIORITY_CITY,
    };

    onSelectDestination(dest, false);
    resetAfterSelect();
  };

  const handleBuildingClick = async (b) => {
    if (!selectedStreet) return;
    let lat, lon;
    const streetName = selectedStreet.name;
    const city = PRIORITY_CITY;

    // Correct known map.md mismatch: Cantemir house 3 is placed at house 15.
    // Use the verified house-3 point captured from the Florești map instead.
    if (/^str(?:ada)?\.?\s+dimitrie\s+cantemir$/i.test(streetName.trim()) && String(b) === '3') {
      lat = 47.89300;
      lon = 28.30100;
    } else if (streetName === "Strada 9 Mai" && MANUAL_COORDS[b]) {
      lat = MANUAL_COORDS[b].lat;
      lon = MANUAL_COORDS[b].lon;
    } else {
      const cached = getCachedGeocode(streetName, b, city);
      if (cached) {
        lat = cached.lat;
        lon = cached.lon;
      } else {
        try {
          const geo = await geocodeBuilding(streetName, b, city);
          if (geo.lat && geo.lon) {
            lat = geo.lat;
            lon = geo.lon;
          } else {
            const c = selectedStreet.centroid || getFallbackCoord(streetName);
            lat = c.lat;
            lon = c.lon;
          }
        } catch (e) {
          console.warn('Geocoding error', e);
          const c = selectedStreet.centroid || getFallbackCoord(streetName);
          lat = c.lat;
          lon = c.lon;
        }
      }
    }

    const dest = {
      lat,
      lon,
      label: `${streetName}, ${b}, ${city}`,
      street: streetName,
      building: b,
      city,
    };

    addAddressToCache(streetName, b, city, lat, lon);
    onSelectDestination(dest, false);
    resetAfterSelect();
  };

  const handleDeleteHistoryItem = async (id) => {
    await deleteSearch(id);
    loadHistory();
  };

  const handleDeleteCacheItem = (address) => {
    removeFromCache(address);
    setCachedAddresses(cachedAddresses.filter(item => item.address !== address));
  };

  const resetAfterSelect = () => {
    setQ('');
    setSelectedStreet(null);
    setResults([]);
    setError(null);
    setCachedAddresses([]);
    setShowCacheOnFocus(false);
  };

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setQ('');
    setResults([]);
    setSelectedStreet(null);
    setError(null);
    setCachedAddresses([]);
    setShowCacheOnFocus(false);
  };

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
          onFocus={handleInputFocus}
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
              {showCacheOnFocus && cachedAddresses.length > 0 && q.trim().length === 0 && (
                <div>
                  <div className="px-3 py-2 text-[12px] font-semibold text-black/70 border-b border-white/30">📍 Adrese recent vizitate</div>
                  {cachedAddresses.map((item, idx) => (
                    <div key={`cache-${idx}`} className="flex items-center justify-between px-3 py-2 hover:bg-white/20 border-b border-white/30">
                      <button onClick={() => handleCachedAddressClick(item)} className="flex-1 text-left">
                        <div className="font-medium text-black">{item.address}</div>
                        <div className="text-[10px] text-black/50">
                          {new Date(item.timestamp).toLocaleDateString('ro-RO')} {item.validated ? '✓' : ''}
                        </div>
                      </button>
                      <button onClick={() => handleDeleteCacheItem(item.address)} className="text-black/40 hover:text-red-500"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              {q.trim().length >= 2 && (
                <>
                  {loading && <div className="px-4 py-3 text-black/70">Поиск...</div>}
                  {error && <div className="px-4 py-3 text-red-700">{error}</div>}
                  {!loading && results.length === 0 && q.length >= 2 && !error && <div className="px-4 py-3 text-black/70">Ничего не найдено</div>}
                  {results.map(s => (
                    <button key={s.id} onClick={() => handleStreetClick(s)} className="w-full text-left px-3 py-2.5 flex gap-3 hover:bg-white/20 border-b border-white/30 bg-amber-50/30">
                      <div className="w-9 h-9 rounded-full bg-amber-500/70 flex items-center justify-center text-white"><MapPin size={18} /></div>
                      <div className="flex-1">
                        <div className="text-black font-medium">{s.name}<span className="text-amber-600 text-xs ml-2">⭐</span></div>
                        <div className="text-black/60 text-xs">{PRIORITY_CITY} · {s.count} домов</div>
                      </div>
                      <ChevronRight size={16} className="text-black/40" />
                    </button>
                  ))}
                </>
              )}

              {q.trim().length === 1 && cachedAddresses.length === 0 && searchHistory.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[12px] font-semibold text-black/70 border-b border-white/30">📜 Căutări recente</div>
                  {searchHistory.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-3 py-2 hover:bg-white/20 border-b border-white/30">
                      <button onClick={() => { setQ(item.query); setOpen(true); }} className="flex-1 text-left text-black">{item.query}</button>
                      <button onClick={() => handleDeleteHistoryItem(item.id)} className="text-black/40 hover:text-red-500"><X size={14} /></button>
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
                  <button key={b} onClick={() => handleBuildingClick(b)} className="px-2 py-3 rounded-xl bg-white/40 border border-white/50 text-black font-bold hover:bg-white/60 flex justify-center gap-1">
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
