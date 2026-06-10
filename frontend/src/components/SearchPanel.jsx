import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft, Star, Clock, Plus, Loader2 } from 'lucide-react';
import { searchStreets, geocodeBuilding, getBuildings } from '../lib/api';

// Corecții manuale pentru Strada 9 Mai
const MANUAL_COORDS = {
  "21": { lat: 47.90479, lon: 28.29035 },
  "25": { lat: 47.90479, lon: 28.29035 },
  "67": { lat: 47.90616, lon: 28.28910 },
};

export default function SearchPanel({ onSelectDestination, getCustomRoute, getPreferredRoute }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedStreet, setSelectedStreet] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [error, setError] = useState(null);
  const [pendingDest, setPendingDest] = useState(null);
  const [pendingHasCustom, setPendingHasCustom] = useState(false);
  const [pendingHasPreferred, setPendingHasPreferred] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Căutare străzi
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
        const data = await searchStreets(query, 'Florești');
        if (controller.signal.aborted) return;
        let items = (data.results || []).filter(it => it.type === 'street');
        items = items.map(it => it.name === "str. 9 Mai" ? { ...it, name: "Strada 9 Mai" } : it);
        setResults(items);
        if (items.length === 0) setError('Ничего не найдено');
        else setError(null);
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

  const handleStreetClick = async (street) => {
    if (street.name === "str. 9 Mai") {
      street = { ...street, name: "Strada 9 Mai" };
    }
    setSelectedStreet(street);
    setBuildings([]);
    setLoadingBuildings(true);
    try {
      const data = await getBuildings(street.name, street.parent_name || 'Florești');
      if (data.buildings && Array.isArray(data.buildings)) {
        setBuildings(data.buildings);
      } else {
        setBuildings([]);
      }
    } catch (e) {
      console.warn('Failed to load buildings', e);
      setBuildings([]);
    } finally {
      setLoadingBuildings(false);
    }
  };

  const handleBuildingClick = async (b) => {
    if (!selectedStreet) return;
    let lat, lon;

    if (selectedStreet.name === "Strada 9 Mai" && MANUAL_COORDS[b]) {
      lat = MANUAL_COORDS[b].lat;
      lon = MANUAL_COORDS[b].lon;
    } 
    else if (selectedStreet.name === "Strada 9 Mai") {
      const c = selectedStreet.centroid || { lat: 47.90500, lon: 28.28970 };
      lat = c.lat;
      lon = c.lon;
    } 
    else {
      try {
        const geo = await geocodeBuilding(selectedStreet.name, b, selectedStreet.parent_name);
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
      label: `${selectedStreet.name}, ${b}, ${selectedStreet.parent_name}`,
      street: selectedStreet.name,
      building: b,
      city: selectedStreet.parent_name,
    };

    const hasCustom = !!(getCustomRoute && getCustomRoute(dest.label));
    const hasPreferred = !!(getPreferredRoute && getPreferredRoute(dest.label));

    setPendingDest(dest);
    setPendingHasCustom(hasCustom);
    setPendingHasPreferred(hasPreferred);
    setOpen(false);
  };

  const handleChooseStandard = () => {
    if (pendingDest) {
      onSelectDestination(pendingDest, false);
      setPendingDest(null); setQ(''); setSelectedStreet(null); setBuildings([]);
    }
  };

  const handleChooseCustom = () => {
    if (pendingDest) {
      onSelectDestination(pendingDest, true);
      setPendingDest(null); setQ(''); setSelectedStreet(null); setBuildings([]);
    }
  };

  const reset = () => {
    if (abortRef.current) abortRef.current.abort();
    setQ(''); setResults([]); setSelectedStreet(null); setBuildings([]);
    setError(null); setPendingDest(null);
  };

  // Fereastra de selecție a rutei (modificată – eliminat butonul "Записать мой собственный маршрут")
  if (pendingDest) {
    return (
      <div className="absolute inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-end">
        <div className="bg-white/30 backdrop-blur-sm border-t border-white/40 rounded-t-2xl p-5 w-full">
          <div className="text-[17px] font-bold text-black mb-1">Маршрут к дому</div>
          <div className="text-[14px] text-black/80 mb-4 bg-white/30 p-2.5 rounded-lg">{pendingDest.street}, дом {pendingDest.building}</div>
          {(pendingHasCustom || pendingHasPreferred) ? (
            <button onClick={handleChooseCustom} className="w-full mb-3 py-3.5 rounded-xl bg-amber-500 text-white font-bold flex justify-center gap-2">
              {pendingHasCustom ? <Star size={18} fill="currentColor" /> : <Clock size={18} />}
              {pendingHasCustom ? 'Поехать моим сохранённым путём' : 'Включить привычный маршрут'}
            </button>
          ) : null /* Eliminat butonul "Записать мой собственный маршрут" */}
          <button onClick={handleChooseStandard} className="w-full py-3.5 rounded-xl bg-white/40 border border-white/50 text-black font-semibold">
            Поехать стандартным навигатором
          </button>
          <button onClick={reset} className="w-full mt-3 py-2 text-black/50">Отмена</button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-3 left-3 right-3 z-30">
      {/* Bara de căutare glass */}
      <div className="bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl flex items-center px-3 py-2 gap-2">
        {selectedStreet ? (
          <button onClick={() => setSelectedStreet(null)} className="text-black/70"><ArrowLeft size={20} /></button>
        ) : (
          <Search size={20} className="text-black/70" />
        )}
        <input
          type="text"
          value={selectedStreet ? `${selectedStreet.name}, ${selectedStreet.parent_name}` : q}
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
              {loading && <div className="px-4 py-3 text-black/70">Поиск...</div>}
              {error && <div className="px-4 py-3 text-red-700">{error}</div>}
              {!loading && results.length === 0 && q.length >= 2 && !error && <div className="px-4 py-3 text-black/70">Ничего не найдено</div>}
              {results.map(s => (
                <button key={s.id} onClick={() => handleStreetClick(s)} className="w-full text-left px-3 py-2.5 flex gap-3 hover:bg-white/20 border-b border-white/30">
                  <div className="w-9 h-9 rounded-full bg-amber-500/70 flex items-center justify-center text-white"><MapPin size={18} /></div>
                  <div className="flex-1">
                    <div className="text-black font-medium">{s.name}</div>
                    <div className="text-black/60 text-xs">{s.parent_name}</div>
                  </div>
                  <ChevronRight size={16} className="text-black/40" />
                </button>
              ))}
            </>
          )}

          {selectedStreet && (
            <div className="p-3">
              <div className="text-black font-bold mb-2">
                {loadingBuildings ? (
                  <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Загрузка номеров...</span>
                ) : (
                  `Выберите номер дома (${buildings.length})`
                )}
              </div>
              {!loadingBuildings && (
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {buildings.map(b => (
                    <button
                      key={b}
                      onClick={() => handleBuildingClick(b)}
                      className="px-2 py-3 rounded-xl bg-white/40 border border-white/50 text-black font-bold hover:bg-white/60 flex justify-center gap-1"
                    >
                      <Building2 size={13} className="text-black/60" /> {b}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
