import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft, Plus } from 'lucide-react';
import { searchStreets, geocodeBuilding, saveSearch, getSearchHistory, deleteSearch } from '../lib/api';

const MANUAL_COORDS = {
  "21": { lat: 47.90479, lon: 28.29035 },
  "25": { lat: 47.90479, lon: 28.29035 },
  "67": { lat: 47.90616, lon: 28.28910 },
};

const PRIORITY_CITY = 'Florești';
const LOCAL_STORAGE_KEY = 'custom_buildings';

// ===== NUMERE ADĂUGATE MANUAL (hardcodate) =====
const EXTRA_BUILDINGS = {
  "Strada 9 Mai|Florești": ["68", "69", "70"],
  "Mihai Eminescu|Florești": ["28"],
};

// ===== FUNCȚIE SORTARE INTELIGENTĂ =====
function sortBuildings(numbers) {
  return [...numbers].sort((a, b) => {
    const parse = (s) => {
      const match = s.match(/^(\d+)(?:\/([A-Za-z]+))?$/);
      if (match) {
        return { num: parseInt(match[1], 10), letter: match[2] || '' };
      }
      return { num: Infinity, letter: s };
    };
    const aParts = parse(a);
    const bParts = parse(b);
    if (aParts.num !== bParts.num) return aParts.num - bParts.num;
    return aParts.letter.localeCompare(bParts.letter);
  });
}

// ===== FUNCȚIE PENTRU A OBTINE TOATE NUMERELE =====
function getBuildingsWithExtras(streetName, city, apiBuildings) {
  const key = `${streetName}|${city}`;
  const extras = EXTRA_BUILDINGS[key] || [];
  
  let saved = [];
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      saved = data[key] || [];
    }
  } catch (e) {}
  
  const all = [...apiBuildings, ...extras, ...saved];
  const unique = [...new Set(all)];
  return sortBuildings(unique);
}

// ===== FUNCȚIE PENTRU A SALVA UN NUMĂR ÎN LOCALSTORAGE =====
function saveBuildingToLocal(streetName, city, buildingNumber) {
  const key = `${streetName}|${city}`;
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    let data = stored ? JSON.parse(stored) : {};
    if (!data[key]) data[key] = [];
    if (!data[key].includes(buildingNumber)) {
      data[key].push(buildingNumber);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    }
  } catch (e) {
    console.warn('Failed to save building:', e);
  }
}

export default function SearchPanel({ onSelectDestination, userPos }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedStreet, setSelectedStreet] = useState(null);
  const [error, setError] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newBuilding, setNewBuilding] = useState('');
  const [currentBuildings, setCurrentBuildings] = useState([]);
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

  // ===== ACTUALIZEAZĂ LISTA DE NUMERE CÂND SE SCHIMBĂ STRADA =====
  useEffect(() => {
    if (!selectedStreet) {
      setCurrentBuildings([]);
      return;
    }
    const streetName = selectedStreet.name;
    const city = selectedStreet.parent_name || PRIORITY_CITY;
    const apiBuildings = selectedStreet.buildings || [];
    const buildings = getBuildingsWithExtras(streetName, city, apiBuildings);
    setCurrentBuildings(buildings);
  }, [selectedStreet]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || selectedStreet) {
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

        const florestiItems = items.filter(it => it.parent_name === PRIORITY_CITY);
        const otherItems = items.filter(it => it.parent_name !== PRIORITY_CITY);
        const sortedItems = [...florestiItems, ...otherItems];
        setResults(sortedItems);

        if (sortedItems.length === 0) {
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
  }, [q, selectedStreet]);

  const handleStreetClick = (street) => {
    if (street.name === "str. 9 Mai") {
      street = { ...street, name: "Strada 9 Mai" };
    }
    setSelectedStreet(street);
    setShowAddInput(false);
    setNewBuilding('');
  };

  const handleBuildingClick = async (b) => {
    if (!selectedStreet) return;
    let lat, lon;
    const streetName = selectedStreet.name;
    const city = PRIORITY_CITY;

    if (streetName === "Strada 9 Mai" && MANUAL_COORDS[b]) {
      lat = MANUAL_COORDS[b].lat;
      lon = MANUAL_COORDS[b].lon;
    } else {
      const centroid = selectedStreet.centroid;
      if (centroid && centroid.lat && centroid.lon) {
        lat = centroid.lat;
        lon = centroid.lon;
      } else {
        lat = 47.8936;
        lon = 28.2933;
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

  // ===== FUNCȚIA DE ADĂUGARE – ACTUALIZEAZĂ DIRECT LISTA =====
  const handleAddBuilding = () => {
    if (!selectedStreet) return;
    const streetName = selectedStreet.name;
    const city = PRIORITY_CITY;
    const num = newBuilding.trim();
    if (!num) return;
    
    // Salvează în localStorage
    saveBuildingToLocal(streetName, city, num);
    
    // Actualizează direct lista curentă
    const updatedBuildings = [...currentBuildings, num];
    const unique = [...new Set(updatedBuildings)];
    const sorted = sortBuildings(unique);
    setCurrentBuildings(sorted);
    
    setNewBuilding('');
    setShowAddInput(false);
  };

  const handleDeleteHistoryItem = async (id) => {
    await deleteSearch(id);
    loadHistory();
  };

  const resetAfterSelect = () => {
    setQ('');
    setSelectedStreet(null);
    setResults([]);
    setError(null);
    setShowAddInput(false);
    setNewBuilding('');
    setCurrentBuildings([]);
  };

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setQ(''); setResults([]); setSelectedStreet(null);
    setError(null);
    setShowAddInput(false);
    setNewBuilding('');
    setCurrentBuildings([]);
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
          value={selectedStreet ? `${selectedStreet.name}, ${PRIORITY_CITY}` : q}
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
              <div className="text-black font-bold mb-2">Выберите номер дома ({currentBuildings.length}):</div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {currentBuildings.map(b => (
                  <button
                    key={b}
                    onClick={() => handleBuildingClick(b)}
                    className="px-2 py-3 rounded-xl bg-white/40 border border-white/50 text-black font-bold hover:bg-white/60 flex justify-center gap-1"
                  >
                    <Building2 size={13} className="text-black/60" /> {b}
                  </button>
                ))}
                {/* Butonul „+” pentru adăugare */}
                <button
                  onClick={() => setShowAddInput(true)}
                  className="px-2 py-3 rounded-xl bg-amber-500/30 border border-amber-400 text-amber-800 font-bold hover:bg-amber-500/50 flex items-center justify-center gap-1"
                >
                  <Plus size={16} />
                </button>
              </div>

              {/* Input pentru adăugare număr */}
              {showAddInput && (
                <div className="mt-3 flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newBuilding}
                    onChange={(e) => setNewBuilding(e.target.value)}
                    placeholder="Introdu numărul (ex: 68)"
                    className="flex-1 px-3 py-2 rounded-xl bg-white/40 border border-white/50 text-black placeholder:text-black/50 outline-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddBuilding();
                      if (e.key === 'Escape') {
                        setShowAddInput(false);
                        setNewBuilding('');
                      }
                    }}
                  />
                  <button
                    onClick={handleAddBuilding}
                    className="px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold"
                  >
                    Adaugă
                  </button>
                  <button
                    onClick={() => {
                      setShowAddInput(false);
                      setNewBuilding('');
                    }}
                    className="px-4 py-2 rounded-xl bg-white/40 border border-white/50 text-black"
                  >
                    Anulează
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
