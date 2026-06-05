import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft } from 'lucide-react';
import { searchStreets, geocodeBuilding } from '../lib/api';

export default function SearchPanel({ onSelectDestination }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedStreet, setSelectedStreet] = useState(null);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    if (selectedStreet) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const data = await searchStreets(q, 'Florești');
        const items = (data.results || []).filter(it => it.type === 'street');
        setResults(items);
      } catch (e) {
        setError('Ошибка поиска');
      } finally { setLoading(false); }
    }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q, selectedStreet]);

  const handleStreetClick = (street) => {
    setSelectedStreet(street);
  };

  const handleBuildingClick = async (b) => {
    if (!selectedStreet) return;
    const c = selectedStreet.centroid || { lat: 47.0124, lon: 28.8474 };
    let lat = c.lat, lon = c.lon;
    try {
      const geo = await geocodeBuilding(selectedStreet.name, b, selectedStreet.parent_name);
      if (geo.lat && geo.lon) { lat = geo.lat; lon = geo.lon; }
    } catch (e) { /* fallback to centroid */ }
    onSelectDestination({
      lat, lon,
      label: `${selectedStreet.name}, ${b}, ${selectedStreet.parent_name}`,
      street: selectedStreet.name,
      building: b,
      city: selectedStreet.parent_name,
    });
    setOpen(false); setQ(''); setSelectedStreet(null); setResults([]);
  };

  const reset = () => { setQ(''); setResults([]); setSelectedStreet(null); setError(null); };

  return (
    <div className="absolute top-3 left-3 right-3 z-30">
      <div className="bg-white rounded-xl shadow-md flex items-center px-3 py-2 gap-2">
        {selectedStreet ? (
          <button onClick={() => setSelectedStreet(null)} className="text-stone-600" aria-label="back">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <Search size={20} className="text-stone-500" />
        )}
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={selectedStreet ? `${selectedStreet.name}, ${selectedStreet.parent_name}` : q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedStreet ? 'Выберите номер дома...' : 'Поиск улицы...'}
          readOnly={!!selectedStreet}
          className="flex-1 outline-none text-[15px] text-stone-800 placeholder:text-stone-400 bg-transparent"
        />
        {(q || selectedStreet) && (
          <button onClick={reset} className="text-stone-400 hover:text-stone-600" aria-label="clear">
            <X size={18} />
          </button>
        )}
      </div>

      {open && (q.length >= 2 || selectedStreet) && (
        <div className="mt-2 bg-white rounded-xl shadow-lg max-h-[60vh] overflow-y-auto scrollbar-thin">
          {loading && (
            <div className="px-4 py-3 text-sm text-stone-500">Поиск...</div>
          )}
          {error && (
            <div className="px-4 py-3 text-sm text-red-600">{error}</div>
          )}
          {!selectedStreet && !loading && results.length === 0 && q.length >= 2 && !error && (
            <div className="px-4 py-3 text-sm text-stone-500">Ничего не найдено</div>
          )}
          {!selectedStreet && results.map((s) => (
            <button
              key={s.id}
              onClick={() => handleStreetClick(s)}
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-stone-50 active:bg-stone-100 border-b border-stone-100 last:border-b-0"
            >
              <div className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center text-amber-700 shrink-0">
                <MapPin size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-stone-800 font-medium truncate">{s.name}</div>
                <div className="text-[12px] text-stone-500 truncate">
                  {s.parent_name} · {s.count} домов
                </div>
              </div>
              <ChevronRight size={16} className="text-stone-400 shrink-0" />
            </button>
          ))}
          {selectedStreet && (
            <div className="p-3">
              <div className="text-[12px] text-stone-500 mb-2 px-1">Номера домов ({selectedStreet.buildings?.length || 0})</div>
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
                {(selectedStreet.buildings || []).map((b) => (
                  <button
                    key={b}
                    onClick={() => handleBuildingClick(b)}
                    className="px-2 py-2 rounded-lg border border-stone-200 bg-white text-[13px] text-stone-800 hover:bg-amber-50 hover:border-amber-300 active:scale-95 transition-all flex items-center justify-center gap-1"
                  >
                    <Building2 size={12} className="text-stone-400" />
                    <span className="truncate">{b}</span>
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
