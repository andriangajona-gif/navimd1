import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft, Download } from 'lucide-react';
import { getRoute, haversine } from '../lib/api';

const PRIORITY_CITY = 'Florești';

// ===== INDEXEDDB =====
const DB_NAME = 'NavigatorMD';
const DB_VERSION = 1;
const STORE_NAME = 'streets';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getStreetsFromDB() {
  if (!db) db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveStreetsToDB(streets) {
  if (!db) db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    // Șterge datele vechi
    store.clear();
    streets.forEach(s => store.add(s));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== DESCĂRCARE DATE OSM =====
async function fetchOSMData(city = 'Florești') {
  const query = `
    [out:json][timeout:60];
    area[name="${city}"]->.searchArea;
    (
      way["highway"~"^(primary|secondary|tertiary|residential|unclassified|service)$"](area.searchArea);
      way["addr:housenumber"](area.searchArea);
    );
    out body;
    >;
    out skel qt;
  `;
  
  const url = 'https://overpass-api.de/api/interpreter';
  const response = await fetch(url, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  
  if (!response.ok) throw new Error('Eroare la descărcare');
  const data = await response.json();
  return processOSMData(data);
}

function processOSMData(osmData) {
  const nodes = {};
  const streets = {};
  
  // Extrage nodurile
  osmData.elements.forEach(el => {
    if (el.type === 'node') {
      nodes[el.id] = { lat: el.lat, lon: el.lon };
    }
  });
  
  // Extrage străzile și numerele
  osmData.elements.forEach(el => {
    if (el.type === 'way' && el.tags) {
      const name = el.tags.name;
      const housenumber = el.tags['addr:housenumber'];
      const highway = el.tags.highway;
      
      if (name && (highway === 'residential' || highway === 'primary' || highway === 'secondary' || highway === 'tertiary' || highway === 'unclassified' || highway === 'service')) {
        // Calculează centroidul
        let lat = 0, lon = 0, count = 0;
        el.nodes.forEach(nodeId => {
          const node = nodes[nodeId];
          if (node) {
            lat += node.lat;
            lon += node.lon;
            count++;
          }
        });
        if (count > 0) {
          lat /= count;
          lon /= count;
          if (!streets[name]) {
            streets[name] = { name, buildings: [], centroid: { lat, lon }, count: 0 };
          }
          streets[name].count++;
        }
      }
      
      // Adaugă numărul casei
      if (housenumber && name) {
        if (!streets[name]) {
          streets[name] = { name, buildings: [], centroid: { lat: 0, lon: 0 }, count: 0 };
        }
        if (!streets[name].buildings.includes(housenumber)) {
          streets[name].buildings.push(housenumber);
        }
      }
    }
  });
  
  // Sortare numere
  Object.keys(streets).forEach(key => {
    streets[key].buildings = streets[key].buildings.sort((a, b) => {
      const na = parseInt(a);
      const nb = parseInt(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  });
  
  return Object.values(streets);
}

// ===== FUNCȚIE SORTARE =====
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

export default function SearchPanel({ onSelectDestination, userPos }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedStreet, setSelectedStreet] = useState(null);
  const [error, setError] = useState(null);
  const [searchHistory, setSearchHistory] = useState([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [allStreets, setAllStreets] = useState([]);
  const debounceRef = useRef(null);

  // Încarcă datele la pornire
  useEffect(() => {
    loadLocalData();
    loadHistory();
  }, []);

  const loadLocalData = async () => {
    try {
      const streets = await getStreetsFromDB();
      if (streets && streets.length > 0) {
        setAllStreets(streets);
        setHasData(true);
      }
    } catch (e) {
      console.warn('Nu s-au putut încărca datele locale:', e);
    }
  };

  const loadHistory = async () => {
    try {
      const stored = localStorage.getItem('search_history');
      if (stored) setSearchHistory(JSON.parse(stored));
    } catch (e) {}
  };

  const saveHistory = (query) => {
    const updated = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
    setSearchHistory(updated);
    localStorage.setItem('search_history', JSON.stringify(updated));
  };

  // ===== DESCĂRCARE DATE =====
  const handleDownloadData = async () => {
    setIsDownloading(true);
    setError(null);
    try {
      const streets = await fetchOSMData(PRIORITY_CITY);
      await saveStreetsToDB(streets);
      setAllStreets(streets);
      setHasData(true);
      alert(`Date descărcate! S-au găsit ${streets.length} străzi.`);
    } catch (e) {
      setError('Eroare la descărcare: ' + e.message);
    } finally {
      setIsDownloading(false);
    }
  };

  // ===== CĂUTARE LOCALĂ =====
  const searchLocal = (query) => {
    if (!allStreets.length) return [];
    const qLower = query.toLowerCase();
    return allStreets
      .filter(s => s.name.toLowerCase().includes(qLower))
      .slice(0, 20);
  };

  // ===== CĂUTARE CU DEBOUNCE =====
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2 || selectedStreet) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);

    debounceRef.current = setTimeout(() => {
      const found = searchLocal(query);
      setResults(found);
      setLoading(false);
      if (found.length === 0 && query.length >= 2) {
        setError('Nu s-a găsit nicio stradă');
      } else {
        setError(null);
      }
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [q, selectedStreet, allStreets]);

  const handleStreetClick = (street) => {
    setSelectedStreet(street);
    saveHistory(street.name);
  };

  const handleBuildingClick = (b) => {
    if (!selectedStreet) return;
    const { centroid } = selectedStreet;
    const dest = {
      lat: centroid.lat,
      lon: centroid.lon,
      label: `${selectedStreet.name}, ${b}, ${PRIORITY_CITY}`,
      street: selectedStreet.name,
      building: b,
      city: PRIORITY_CITY,
    };
    onSelectDestination(dest, false);
    resetAfterSelect();
  };

  const resetAfterSelect = () => {
    setQ('');
    setSelectedStreet(null);
    setResults([]);
    setError(null);
  };

  const reset = () => {
    setQ('');
    setSelectedStreet(null);
    setResults([]);
    setError(null);
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
              {/* Buton de descărcare date */}
              {!hasData && (
                <div className="p-3 border-b border-white/30">
                  <button
                    onClick={handleDownloadData}
                    disabled={isDownloading}
                    className="w-full py-2 px-3 bg-amber-500/70 text-white rounded-xl flex items-center justify-center gap-2 font-medium hover:bg-amber-500/90 transition"
                  >
                    <Download size={18} />
                    {isDownloading ? 'Descărcare...' : `Descarcă harta ${PRIORITY_CITY}`}
                  </button>
                  {error && <div className="mt-2 text-red-700 text-sm">{error}</div>}
                </div>
              )}

              {q.trim().length >= 2 && (
                <>
                  {loading && <div className="px-4 py-3 text-black/70">Поиск...</div>}
                  {error && <div className="px-4 py-3 text-red-700">{error}</div>}
                  {!loading && results.length === 0 && q.length >= 2 && !error && <div className="px-4 py-3 text-black/70">Ничего не найдено</div>}
                  {results.map(s => (
                    <button
                      key={s.name}
                      onClick={() => handleStreetClick(s)}
                      className="w-full text-left px-3 py-2.5 flex gap-3 hover:bg-white/20 border-b border-white/30"
                    >
                      <div className="w-9 h-9 rounded-full bg-amber-500/70 flex items-center justify-center text-white"><MapPin size={18} /></div>
                      <div className="flex-1">
                        <div className="text-black font-medium">{s.name}</div>
                        <div className="text-black/60 text-xs">{PRIORITY_CITY} · {s.buildings.length} домов</div>
                      </div>
                      <ChevronRight size={16} className="text-black/40" />
                    </button>
                  ))}
                </>
              )}

              {q.trim().length === 1 && searchHistory.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[12px] font-semibold text-black/70 border-b border-white/30">📜 Căutări recente</div>
                  {searchHistory.map(item => (
                    <div key={item} className="flex items-center justify-between px-3 py-2 hover:bg-white/20 border-b border-white/30">
                      <button
                        onClick={() => {
                          setQ(item);
                          setOpen(true);
                        }}
                        className="flex-1 text-left text-black"
                      >
                        {item}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {selectedStreet && (
            <div className="p-3">
              <div className="text-black font-bold mb-2">Выберите номер дома ({selectedStreet.buildings.length}):</div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {sortBuildings(selectedStreet.buildings).map(b => (
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
