import React, { useState, useEffect, useRef } from 'react';
import { Search, X, MapPin, Building2, ChevronRight, ArrowLeft, Star, Clock, Plus } from 'lucide-react';
import { searchStreets, geocodeBuilding } from '../lib/api';

// Corecții manuale pentru Strada 9 Mai (Florești)
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
  const [error, setError] = useState(null);
  const [pendingDest, setPendingDest] = useState(null);
  const [pendingHasCustom, setPendingHasCustom] = useState(false);
  const [pendingHasPreferred, setPendingHasPreferred] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!q || q.length < 2) { setResults([]); return; }
    if (selectedStreet) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const data = await searchStreets(q, 'Florești');
        let items = (data.results || []).filter(it => it.type === 'street');
        // Corectăm numele străzii "str. 9 Mai" în "Strada 9 Mai"
        items = items.map(it => {
          if (it.name === "str. 9 Mai") {
            return { ...it, name: "Strada 9 Mai" };
          }
          return it;
        });
        setResults(items);
      } catch (e) {
        setError('Ошибка поиска');
      } finally { setLoading(false); }
    }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q, selectedStreet]);

  const handleStreetClick = (street) => {
    if (street.name === "str. 9 Mai") {
      street = { ...street, name: "Strada 9 Mai" };
    }
    setSelectedStreet(street);
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
      setPendingDest(null); setQ(''); setSelectedStreet(null); setResults([]);
    }
  };

  const handleChooseCustom = () => {
    if (pendingDest) {
      onSelectDestination(pendingDest, true);
      setPendingDest(null); setQ(''); setSelectedStreet(null); setResults([]);
    }
  };

  const handleCreateOwnRoute = () => {
    if (pendingDest) {
      onSelectDestination(pendingDest, false);
      setPendingDest(null); setQ(''); setSelectedStreet(null); setResults([]);
    }
  };

  const reset = () => {
    setQ(''); setResults([]); setSelectedStreet(null);
    setError(null); setPendingDest(null);
  };

  // Fereastra de selecție a rutei (glass)
  if (pendingDest) {
    return (
      <div className="absolute inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-end">
        <div className="bg-white/20 backdrop-blur-sm border-t border-white/30 rounded-t-2xl p-5 w-full shadow-xl animate-in slide-in-from-bottom duration-200">
          <div className="text-[17px] font-bold text-white drop-shadow-md mb-1">Маршрут к дому</div>
          <div className="text-[14px] text-white/80 font-semibold mb-4 truncate bg-white/10 rounded-lg p-2.5 border border-white/20">
            {pendingDest.street}, дом {pendingDest.building}
          </div>

          {(pendingHasCustom || pendingHasPreferred) ? (
            <button
              onClick={handleChooseCustom}
              className="w-full mb-3 py-3.5 rounded-xl bg-amber-500/80 backdrop-blur-sm text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-98 transition-transform shadow-lg"
            >
              {pendingHasCustom ? <Star size={18} fill="currentColor" /> : <Clock size={18} />}
              {pendingHasCustom ? 'Поехать моим сохранённым путём' : 'Включить привычный маршрут'}
            </button>
          ) : (
            <button
              onClick={handleCreateOwnRoute}
              className="w-full mb-3 py-3.5 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white text-[15px] font-bold flex items-center justify-center gap-2 active:scale-98 transition-transform"
            >
              <Plus size={18} />
              Записать мой собственный маршрут
            </button>
          )}

          <button
            onClick={handleChooseStandard}
            className="w-full py-3.5 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white text-[15px] font-semibold active:bg-white/30"
          >
            Поехать стандартным навигатором
          </button>

          <button onClick={reset} className="w-full mt-3 py-2 text-white/60 text-[14px] font-medium">
            Отмена
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-3 left-3 right-3 z-30">
      {/* Bara de căutare glass */}
      <div className="bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl shadow-md flex items-center px-3 py-2 gap-2">
        {selectedStreet ? (
          <button onClick={() => setSelectedStreet(null)} className="text-white/80" aria-label="back">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <Search size={20} className="text-white/80" />
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
          className="flex-1 outline-none text-[15px] text-white placeholder:text-white/60 bg-transparent"
        />
        {(q || selectedStreet) && (
          <button onClick={reset} className="text-white/60 hover:text-white/90" aria-label="clear">
            <X size={18} />
          </button>
        )}
      </div>

      {open && (q.length >= 2 || selectedStreet) && (
        <div className="mt-2 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl shadow-lg max-h-[60vh] overflow-y-auto scrollbar-thin">
          {loading && <div className="px-4 py-3 text-sm text-white/80">Поиск...</div>}
          {error && <div className="px-4 py-3 text-sm text-red-200">{error}</div>}
          {!selectedStreet && !loading && results.length === 0 && q.length >= 2 && !error && (
            <div className="px-4 py-3 text-sm text-white/80">Ничего не найдено</div>
          )}
          {!selectedStreet && results.map((s) => (
            <button
              key={s.id}
              onClick={() => handleStreetClick(s)}
              className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-white/10 active:bg-white/20 border-b border-white/20 last:border-b-0"
            >
              <div className="w-9 h-9 rounded-full bg-amber-500/50 flex items-center justify-center text-white shrink-0">
                <MapPin size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] text-white font-medium truncate drop-shadow-sm">{s.name}</div>
                <div className="text-[12px] text-white/70 truncate">{s.parent_name} · {s.count} домов</div>
              </div>
              <ChevronRight size={16} className="text-white/50 shrink-0" />
            </button>
          ))}
          {selectedStreet && (
            <div className="p-3">
              <div className="text-[14px] font-bold text-white mb-2.5 px-1 drop-shadow-sm">Выберите номер дома ({selectedStreet.buildings?.length || 0}):</div>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {(selectedStreet.buildings || []).map((b) => (
                  <button
                    key={b}
                    onClick={() => handleBuildingClick(b)}
                    className="px-2 py-3 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white text-[14px] font-bold hover:bg-white/30 active:scale-95 transition-all flex items-center justify-center gap-1 shadow-sm"
                  >
                    <Building2 size={13} className="text-white/70 shrink-0" />
                    <span className="truncate drop-shadow-sm">{b}</span>
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
