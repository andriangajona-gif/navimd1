import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, ChevronRight, MapPin, Search, X } from 'lucide-react';
import { deleteSearch, geocodeBuilding, getSearchHistory, saveSearch, searchStreets } from '../lib/api';
import { addAddressToCache, getCache, removeFromCache } from '../lib/searchCache';
import { getCachedGeocode, setGeocodeCache } from '../lib/geocodeCache';

const PRIORITY_CITY = 'Florești';
const MANUAL_COORDS = {
  '21': { lat: 47.90479, lon: 28.29035 },
  '25': { lat: 47.90479, lon: 28.29035 },
  '67': { lat: 47.90616, lon: 28.28910 },
};
// Corrected point for the building circled by the user.
const MIHAI_VITEAZUL_9 = { lat: 47.8946761, lon: 28.3107701 };
// Approximate Florești town center. Used only to reject geocoder results that are
// clearly in another locality; never used as a house-level destination fallback.
const FLORESTI_CENTER = { lat: 47.89286, lon: 28.29854 };
const MAX_GEOCODE_DISTANCE_METERS = 4000;

function normalize(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ');
}

function isFlorestiCoordinate(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return false;
  const toRad = (n) => n * Math.PI / 180;
  const dLat = toRad(Number(lat) - FLORESTI_CENTER.lat);
  const dLon = toRad(Number(lon) - FLORESTI_CENTER.lon);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(FLORESTI_CENTER.lat)) * Math.cos(toRad(Number(lat))) * Math.sin(dLon / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distance <= MAX_GEOCODE_DISTANCE_METERS;
}

function isMihaiViteazul(street) {
  const name = normalize(street).replace(/^strada?\s+/, '');
  return name === 'mihai viteazul';
}

export default function SearchPanel({ onSelectDestination }) {
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

  const loadHistory = async () => setSearchHistory(await getSearchHistory(10));
  useEffect(() => { loadHistory(); }, []);

  const handleInputFocus = () => {
    setOpen(true);
    if (!q.trim()) {
      setCachedAddresses(getCache());
      setShowCacheOnFocus(true);
    }
  };

  const handleInputChange = (event) => {
    const value = event.target.value;
    setQ(value);
    setOpen(true);
    if (value.trim()) {
      setShowCacheOnFocus(false);
      setCachedAddresses([]);
    } else {
      setCachedAddresses(getCache());
      setShowCacheOnFocus(true);
    }
  };

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return undefined;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    clearTimeout(debounceRef.current);
    setLoading(true);
    setError(null);

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchStreets(query, PRIORITY_CITY);
        if (controller.signal.aborted) return;
        // The API's location parameter is not sufficient: filter again so matches
        // from Varvareuca or any other locality can never be selected.
        const items = (data.results || [])
          .filter((item) => item.type === 'street')
          .filter((item) => normalize(item.parent_name) === normalize(PRIORITY_CITY))
          .map((item) => item.name === 'str. 9 Mai' ? { ...item, name: 'Strada 9 Mai' } : item);
        setResults(items);
        setError(items.length ? null : 'Nu am găsit această stradă în Florești.');
        if (items.length) {
          await saveSearch(query);
          loadHistory();
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError('Eroare la căutare. Încearcă din nou.');
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
    setSelectedStreet(street.name === 'str. 9 Mai' ? { ...street, name: 'Strada 9 Mai' } : street);
    setCachedAddresses([]);
    setShowCacheOnFocus(false);
  };

  const selectCachedAddress = async (item) => {
    let lat = Number(item.lat);
    let lon = Number(item.lon);
    if (!isFlorestiCoordinate(lat, lon)) {
      lat = lon = NaN;
      const cached = getCachedGeocode(item.street, item.building, PRIORITY_CITY);
      if (cached && isFlorestiCoordinate(cached.lat, cached.lon)) {
        lat = cached.lat;
        lon = cached.lon;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      try {
        const geo = await geocodeBuilding(item.street, item.building, PRIORITY_CITY);
        if (isFlorestiCoordinate(geo?.lat, geo?.lon)) {
          lat = Number(geo.lat);
          lon = Number(geo.lon);
          setGeocodeCache(item.street, item.building, lat, lon, PRIORITY_CITY);
          addAddressToCache(item.street, item.building, PRIORITY_CITY, lat, lon);
        }
      } catch (e) {
        console.warn('Geocoding error for cached address:', e);
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setError('Nu am găsit coordonatele corecte în Florești. Caută din nou adresa.');
      return;
    }
    onSelectDestination({ lat, lon, label: `${item.street}, ${item.building}, ${PRIORITY_CITY}`, street: item.street, building: item.building, city: PRIORITY_CITY }, false);
    resetAfterSelect();
  };

  const handleBuildingClick = async (building) => {
    if (!selectedStreet) return;
    const street = selectedStreet.name;
    const house = String(building).trim();
    let coordinates = null;

    // A user-confirmed map point for the circled building.
    if (isMihaiViteazul(street) && house === '9') {
      coordinates = MIHAI_VITEAZUL_9;
    } else if (normalize(street) === 'strada 9 mai' && MANUAL_COORDS[house]) {
      coordinates = MANUAL_COORDS[house];
    } else {
      const cached = getCachedGeocode(street, house, PRIORITY_CITY);
      if (cached && isFlorestiCoordinate(cached.lat, cached.lon)) coordinates = cached;
      if (!coordinates) {
        try {
          const geo = await geocodeBuilding(street, house, PRIORITY_CITY);
          if (isFlorestiCoordinate(geo?.lat, geo?.lon)) {
            coordinates = { lat: Number(geo.lat), lon: Number(geo.lon) };
          }
        } catch (e) {
          console.warn('Geocoding error', e);
        }
      }
    }

    // Never route an unlocated house to a generic city center or street centroid;
    // those fallbacks caused unrelated addresses (e.g. house 15) to be selected.
    if (!coordinates || !isFlorestiCoordinate(coordinates.lat, coordinates.lon)) {
      setError('Nu am găsit poziția exactă a casei în Florești; nu am pornit o rută greșită.');
      return;
    }

    const { lat, lon } = coordinates;
    addAddressToCache(street, house, PRIORITY_CITY, lat, lon);
    onSelectDestination({ lat, lon, label: `${street}, ${house}, ${PRIORITY_CITY}`, street, building: building, city: PRIORITY_CITY }, false);
    resetAfterSelect();
  };

  const resetAfterSelect = () => {
    setQ(''); setSelectedStreet(null); setResults([]); setError(null);
    setCachedAddresses([]); setShowCacheOnFocus(false);
  };
  const reset = () => {
    abortRef.current?.abort();
    setQ(''); setSelectedStreet(null); setResults([]); setError(null);
    setCachedAddresses([]); setShowCacheOnFocus(false);
  };
  const handleDeleteHistoryItem = async (id) => { await deleteSearch(id); loadHistory(); };
  const handleDeleteCacheItem = (address) => {
    removeFromCache(address);
    setCachedAddresses((items) => items.filter((item) => item.address !== address));
  };

  return (
    <div className="absolute top-3 left-3 right-3 z-30">
      <div className="bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl flex items-center px-3 py-2 gap-2">
        {selectedStreet ? <button onClick={() => setSelectedStreet(null)} className="text-black/70"><ArrowLeft size={20} /></button> : <Search size={20} className="text-black/70" />}
        <input ref={inputRef} type="text" value={selectedStreet ? `${selectedStreet.name}, ${PRIORITY_CITY}` : q} onChange={handleInputChange} onFocus={handleInputFocus} placeholder={selectedStreet ? 'Выберите номер дома...' : 'Поиск улицы...'} className="flex-1 outline-none text-black placeholder:text-black/50 bg-transparent" />
        {(q || selectedStreet) && <button onClick={reset} className="text-black/50"><X size={18} /></button>}
      </div>
      {(open || selectedStreet) && (
        <div className="mt-2 bg-white/30 backdrop-blur-sm border border-white/40 rounded-xl max-h-[60vh] overflow-auto">
          {!selectedStreet && <>
            {showCacheOnFocus && cachedAddresses.length > 0 && !q.trim() && <div>
              <div className="px-3 py-2 text-[12px] font-semibold text-black/70 border-b border-white/30">📍 Adrese recente</div>
              {cachedAddresses.map((item, index) => <div key={`cache-${index}`} className="flex items-center justify-between px-3 py-2 border-b border-white/30">
                <button onClick={() => selectCachedAddress(item)} className="flex-1 text-left"><div className="font-medium text-black">{item.address}</div><div className="text-[10px] text-black/50">{item.validated ? '✓' : ''}</div></button>
                <button onClick={() => handleDeleteCacheItem(item.address)} className="text-black/40"><X size={14} /></button>
              </div>)}
            </div>}
            {q.trim().length >= 2 && <>
              {loading && <div className="px-4 py-3 text-black/70">Caut...</div>}
              {error && <div className="px-4 py-3 text-red-700">{error}</div>}
              {!loading && !error && results.length === 0 && <div className="px-4 py-3 text-black/70">Nu există rezultate în Florești.</div>}
              {results.map((street) => <button key={street.id} onClick={() => handleStreetClick(street)} className="w-full text-left px-3 py-2.5 flex gap-3 border-b border-white/30 bg-amber-50/30">
                <div className="w-9 h-9 rounded-full bg-amber-500/70 flex items-center justify-center text-white"><MapPin size={18} /></div>
                <div className="flex-1"><div className="text-black font-medium">{street.name}<span className="text-amber-600 text-xs ml-2">⭐</span></div><div className="text-black/60 text-xs">Florești · {street.count} case</div></div><ChevronRight size={16} className="text-black/40" />
              </button>)}
            </>}
            {q.trim().length === 1 && searchHistory.length > 0 && <div>
              <div className="px-3 py-2 text-[12px] font-semibold text-black/70 border-b border-white/30">📜 Căutări recente</div>
              {searchHistory.map((item) => <div key={item.id} className="flex items-center justify-between px-3 py-2 border-b border-white/30"><button onClick={() => setQ(item.query)} className="flex-1 text-left text-black">{item.query}</button><button onClick={() => handleDeleteHistoryItem(item.id)} className="text-black/40"><X size={14} /></button></div>)}
            </div>}
          </>}
          {selectedStreet && <div className="p-3">
            {error && <div className="text-red-700 mb-2">{error}</div>}
            <div className="text-black font-bold mb-2">Выберите номер дома ({selectedStreet.buildings?.length || 0}):</div>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">{(selectedStreet.buildings || []).map((building) => <button key={building} onClick={() => handleBuildingClick(building)} className="px-2 py-3 rounded-xl bg-white/40 border border-white/50 text-black font-bold flex justify-center gap-1"><Building2 size={13} className="text-black/60" /> {building}</button>)}</div>
          </div>}
        </div>
      )}
    </div>
  );
}
