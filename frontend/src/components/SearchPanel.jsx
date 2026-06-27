import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft } from 'lucide-react';
import { searchStreets, geocodeBuilding, saveSearch, getSearchHistory, deleteSearch } from '../lib/api';

const MANUAL_COORDS = {
  "21": { lat: 47.90479, lon: 28.29035 },
  "25": { lat: 47.90479, lon: 28.29035 },
  "67": { lat: 47.90616, lon: 28.28910 },
};

const DEFAULT_CITY = 'Florești';

export default function SearchPanel({ onSelectDestination, userPos }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]); // toate străzile brute (nefiltrate)
  const [filteredResults, setFilteredResults] = useState([]); // străzile din orașul selectat
  const [selectedStreet, setSelectedStreet] = useState(null);
  const [error, setError] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);
  const [citySelection, setCitySelection] = useState(null); // { streetName, cities: [] }
  const [selectedCity, setSelectedCity] = useState(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const history = await getSearchHistory(10);
    setSearchHistory(history);
  };

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || selectedStreet) {
      setResults([]);
      setFilteredResults([]);
      setError(null);
      setLoading(false);
      setCitySelection(null);
      setSelectedCity(null);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    setLoading(true);
    setError(null);
    setCitySelection(null);
    setSelectedCity(null);

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchStreets(query, 'Florești'); // trimitem Florești ca locație preferată
        if (controller.signal.aborted) return;
        let items = (data.results || []).filter(it => it.type === 'street');
        items = items.map(it => it.name === "str. 9 Mai" ? { ...it, name: "Strada 9 Mai" } : it);
        setResults(items);

        if (items.length === 0) {
          setError('Ничего не найдено');
          setFilteredResults([]);
        } else {
          setError(null);
          // Grupare după oraș
          const cityMap = {};
          items.forEach(item => {
            const city = item.parent_name || 'Necunoscut';
            if (!cityMap[city]) cityMap[city] = [];
            cityMap[city].push(item);
          });
          const cities = Object.keys(cityMap);

          // Dacă există mai multe orașe, salvăm pentru selecție
          if (cities.length > 1) {
            // Prioritizează Florești (dacă există)
            const sortedCities = cities.sort((a, b) => {
              if (a === DEFAULT_CITY) return -1;
              if (b === DEFAULT_CITY) return 1;
              return a.localeCompare(b);
            });
            setCitySelection({ streetName: query, cities: sortedCities, cityMap });
            setFilteredResults([]); // încă nu afișăm străzile
          } else {
            // Un singur oraș – afișează direct
            setSelectedCity(cities[0]);
            setFilteredResults(items);
            setCitySelection(null);
            // Salvează căutarea
            await saveSearch(query);
            loadHistory();
          }
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
  }, [q, selectedStreet]);

  // Când utilizatorul alege un oraș din selecție
  const handleCitySelect = (city) => {
    if (!citySelection) return;
    const { cityMap, streetName } = citySelection;
    const streets = cityMap[city] || [];
    setSelectedCity(city);
    setFilteredResults(streets);
    setCitySelection(null); // închidem selecția
    // Salvează căutarea (cu orașul ales)
    saveSearch(streetName);
    loadHistory();
  };

  const handleStreetClick = (street) => {
    if (street.name === "str. 9 Mai") {
      street = { ...street, name: "Strada 9 Mai" };
    }
    setSelectedStreet(street);
  };

  const handleBuildingClick = async (b) => {
    if (!selectedStreet) return;
    let lat, lon;
    const streetName = selectedStreet.name;
    // Folosește orașul selectat (selectedCity) sau cel din stradă
    const city = selectedCity || selectedStreet.parent_name || DEFAULT_CITY;

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

  const resetAfterSelect = () => {
    setQ('');
    setSelectedStreet(null);
    setResults([]);
    setFilteredResults([]);
    setError(null);
    setCitySelection(null);
    setSelectedCity(null);
  };

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setQ(''); setResults([]); setFilteredResults([]); setSelectedStreet(null);
    setError(null);
    setCitySelection(null);
    setSelectedCity(null);
  };

  const showHistory = !selectedStreet && q.trim().length === 1 && searchHistory.length > 0;

  return (
    <div className="absolute top-3 left-3 right-3 z-30">
      <div className="bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl flex items-center px-3 py-2 gap-2">
        {selectedStreet ? (
          <button onClick={() => setSelectedStreet(null)} className="text-black/70"><ArrowLeft size={20} /></button>
        ) : (
          <Search size={20} className="text-black/70" />
        )}
        <input
          type="text"
          value={selectedStreet ? `${selectedStreet.name}, ${selectedCity || selectedStreet.parent_name || DEFAULT_CITY}` : q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedStreet ? 'Выберите номер дома...' : 'Поиск улицы...'}
          readOnly={!!selectedStreet}
          className="flex-1 outline-none text-black placeholder:text-black/50 bg-transparent"
        />
        {(q || selectedStreet) && <button onClick={reset} className="text-black/50"><X size={18} /></button>}
      </div>

      {(open || selectedStreet) && (
        <div className="mt-2 bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl max-h-[60vh] overflow-auto">
          {!selectedStreet && (
            <>
              {/* Secțiunea de selecție oraș (când există mai multe orașe) */}
              {citySelection && (
                <div className="p-3">
                  <div className="text-black font-bold mb-2">Alege orașul pentru „{citySelection.streetName}”:</div>
                  <div className="grid grid-cols-2 gap-2">
                    {citySelection.cities.map(city => (
                      <button
                        key={city}
                        onClick={() => handleCitySelect(city)}
                        className={`px-3 py-2 rounded-xl border text-black font-medium hover:bg-white/30 ${
                          city === DEFAULT_CITY 
                            ? 'bg-amber-500/30 border-amber-500 text-amber-900 font-bold' 
                            : 'bg-white/20 border-white/50'
                        }`}
                      >
                        {city} {city === DEFAULT_CITY && '⭐'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Afișează rezultatele căutării (după selecția orașului) */}
              {q.trim().length >= 2 && !citySelection && (
                <>
                  {loading && <div className="px-4 py-3 text-black/70">Поиск...</div>}
                  {error && <div className="px-4 py-3 text-red-700">{error}</div>}
                  {!loading && filteredResults.length === 0 && q.length >= 2 && !error && <div className="px-4 py-3 text-black/70">Ничего не найдено</div>}
                  {filteredResults.map(s => (
                    <button key={s.id} onClick={() => handleStreetClick(s)} className="w-full text-left px-3 py-2.5 flex gap-3 hover:bg-white/20 border-b border-white/30">
                      <div className="w-9 h-9 rounded-full bg-amber-500/70 flex items-center justify-center text-white"><MapPin size={18} /></div>
                      <div className="flex-1">
                        <div className="text-black font-medium">{s.name}</div>
                        <div className="text-black/60 text-xs">{selectedCity || s.parent_name || DEFAULT_CITY} · {s.count} домов</div>
                      </div>
                      <ChevronRight size={16} className="text-black/40" />
                    </button>
                  ))}
                </>
              )}

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
