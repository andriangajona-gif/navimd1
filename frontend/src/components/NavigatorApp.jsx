import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { STYLE_URL, getRoute, formatDistance, formatDuration, haversine, recordTrip, scoreRoute, getPreferredRoute } from '../lib/api';
import SearchPanel from './SearchPanel';
import NavigationPanel from './NavigationPanel';
import { Locate } from 'lucide-react';

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function distToRouteMeters(lat, lon, coords) {
  if (!coords || coords.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = pointToSegMeters(lat, lon, coords[i][1], coords[i][0], coords[i+1][1], coords[i+1][0]);
    if (d < min) min = d;
  }
  return min;
}

function pointToSegMeters(pLat, pLon, aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const lat0 = toRad((aLat + bLat) / 2);
  const ax = R * toRad(aLon) * Math.cos(lat0), ay = R * toRad(aLat);
  const bx = R * toRad(bLon) * Math.cos(lat0), by = R * toRad(bLat);
  const px = R * toRad(pLon) * Math.cos(lat0), py = R * toRad(pLat);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const DEFAULT_CENTER = [28.8474, 47.0124];

export function getCustomRoute(destLabel) {
  try {
    const existing = JSON.parse(localStorage.getItem('custom_routes') || '{}');
    return existing[destLabel] || null;
  } catch (e) { return null; }
}

function saveCustomRoute(destLabel, track) {
  try {
    const existing = JSON.parse(localStorage.getItem('custom_routes') || '{}');
    existing[destLabel] = { track, savedAt: Date.now() };
    localStorage.setItem('custom_routes', JSON.stringify(existing));
  } catch (e) {}
}

class WakeLockManager {
  constructor() { this.wakeLock = null; }
  async acquire() {
    try {
      if ('wakeLock' in navigator) {
        if (this.wakeLock) return true;
        this.wakeLock = await navigator.wakeLock.request('screen');
        return true;
      }
    } catch (e) {}
    return false;
  }
  async release() {
    if (this.wakeLock) {
      try { await this.wakeLock.release(); this.wakeLock = null; } catch (e) {}
    }
  }
}

function RouteOverlay({ routeCoords, map }) {
  const [points, setPoints] = useState([]);

  useEffect(() => {
    if (!map || !routeCoords || routeCoords.length === 0) {
      setPoints([]);
      return;
    }
    const update = () => {
      setPoints(routeCoords.map(([lng, lat]) => {
        const p = map.project([lng, lat]);
        return `${p.x},${p.y}`;
      }));
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    map.on('rotate', update);
    map.on('pitch', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
      map.off('rotate', update);
      map.off('pitch', update);
    };
  }, [map, routeCoords]);

  if (points.length < 2) return null;
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 10 }}>
      <polyline points={points.join(' ')} fill="none" stroke="#1d4ed8" strokeWidth="10" strokeOpacity="0.3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points.join(' ')} fill="none" stroke="#2c7be5" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NavigatorApp() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  const routeGeomRef = useRef(null);
  const gpsTrackRef = useRef([]);
  const wakeLockManagerRef = useRef(new WakeLockManager());

  const [mapReady, setMapReady] = useState(false);
  const [mapInstance, setMapInstance] = useState(null);
  const [userPos, setUserPos] = useState(null);
  const [compass, setCompass] = useState(null);
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [routeCoords, setRouteCoords] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [profile] = useState('driving');
  const [error, setError] = useState(null);
  const [following, setFollowing] = useState(true);
  const [navStarted, setNavStarted] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [arrivedDest, setArrivedDest] = useState(null);
  const lastReroutedAtRef = useRef(0);
  const offRouteSinceRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) return;
    
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL, 
      center: DEFAULT_CENTER,
      zoom: 12,
      minZoom: 4,
      maxZoom: 19,
      attributionControl: false,
      pitchWithRotate: true,
      dragRotate: true,
      maxBounds: [[24.5, 45.0], [31.5, 49.0]]
    });

    map.on('load', () => { 
      setMapReady(true); 
      setMapInstance(map);
      
      // Принудительный ресайз для мобилок
      setTimeout(() => { map.resize(); }, 300);
    });

    map.on('error', (e) => console.warn('map err', e?.error?.message || e));
    map.on('dragstart', () => setFollowing(false));
    mapRef.current = map;
    
    return () => { 
      if (mapRef.current) {
        mapRef.current.remove(); 
        mapRef.current = null; 
      }
    };
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const deg = e.webkitCompassHeading ?? e.alpha;
      if (deg != null) setCompass(deg);
    };
    if (window.DeviceOrientationEvent) {
      if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
        window.addEventListener('deviceorientation', handler, true);
      }
    }
    return () => window.removeEventListener('deviceorientation', handler, true);
  }, []);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const onPos = (pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, heading: pos.coords.heading };
      setUserPos(p);
      if (navStarted) {
        gpsTrackRef.current.push([pos.coords.longitude, pos.coords.latitude]);
      }
    };
    const onErr = (e) => {
      console.warn('geoloc err', e.message);
      setError('Не удалось получить геолокацию.');
    };
    navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 10000 });
    watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true, maximumAge: 1500, timeout: 15000,
    });
    return () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); };
  }, [navStarted]);

  useEffect(() => {
    const wakeLockManager = wakeLockManagerRef.current;
    if (navStarted) wakeLockManager.acquire();
    else wakeLockManager.release();
    return () => { wakeLockManager.release(); };
  }, [navStarted]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const wakeLockManager = wakeLockManagerRef.current;
      if (document.visibilityState === 'visible' && navStarted) wakeLockManager.acquire();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [navStarted]);

  useEffect(() => {
    if (!mapReady || !userPos) return;
    const map = mapRef.current;
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      const core = document.createElement('div');
      core.className = 'user-dot-core';
      el.appendChild(core);
      userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([userPos.lon, userPos.lat]).addTo(map);
      map.flyTo({ center: [userPos.lon, userPos.lat], zoom: 15, duration: 800 });
    } else {
      userMarkerRef.current.setLngLat([userPos.lon, userPos.lat]);
    }
    
    if (following && navStarted && route) {
      const bearing = compass ?? userPos.heading ?? 0;
      map.easeTo({
        center: [userPos.lon, userPos.lat], 
        zoom: 18,
        bearing: isNaN(bearing) ? 0 : bearing,
        pitch: 60, 
        duration: 500,
        padding: { top: 100, bottom: 450, left: 0, right: 0 }, 
      });
    } else if (following && route) {
      map.easeTo({ 
        center: [userPos.lon, userPos.lat], 
        zoom: 17,
        bearing: 0,
        pitch: 0,
        duration: 600 
      });
    }
  }, [userPos, mapReady, following, route, navStarted, compass]);

  useEffect(() => {
    if (!userPos || !routeGeomRef.current || !navStarted) return;
    const coords = routeGeomRef.current;
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < coords.length - 1; i++) {
      const d = pointToSegMeters(userPos.lat, userPos.lon, coords[i][1], coords[i][0], coords[i+1][1], coords[i+1][0]);
      if (d < minDist) { minDist = d; closestIdx = i; }
    }
    setRouteCoords(coords.slice(closestIdx));
  }, [userPos, navStarted]);

  const drawRoute = useCallback((geo) => {
    routeGeomRef.current = geo.coordinates;
    setRouteCoords(geo.coordinates);
  }, []);

  const resetAll = useCallback(() => {
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null; }
    const map = mapRef.current;
    if (map) map.easeTo({ pitch: 0, bearing: 0, zoom: 14, duration: 600 });
    routeGeomRef.current = null;
    gpsTrackRef.current = [];
    setRoute(null); setRouteCoords(null); setDestination(null);
    setCurrentStep(0); setNavStarted(false);
    offRouteSinceRef.current = null;
    setShowSavePrompt(false);
    setArrivedDest(null);
  }, []);

  const handleSaveRoute = useCallback(() => {
    if (arrivedDest && gpsTrackRef.current.length > 5) {
      saveCustomRoute(arrivedDest.label, gpsTrackRef.current);
      recordTrip(gpsTrackRef.current, arrivedDest.label);
    }
    resetAll();
  }, [arrivedDest, resetAll]);

  const handleSkipSave = useCallback(() => {
    if (arrivedDest && gpsTrackRef.current.length > 5) {
      recordTrip(gpsTrackRef.current, arrivedDest.label);
    }
    resetAll();
  }, [arrivedDest, resetAll]);

  const clearRoute = useCallback(() => {
    if (navStarted && gpsTrackRef.current.length > 5) {
      setArrivedDest(destination);
      setShowSavePrompt(true);
    } else {
      resetAll();
    }
  }, [navStarted, destination, resetAll]);

  const handleSelectDestination = useCallback(async (dest, useCustom = false) => {
    setError(null);
    if (!userPos) { setError('Ожидаем GPS-сигнал.'); return; }
    setDestination(dest);
    const map = mapRef.current;
    if (destMarkerRef.current) destMarkerRef.current.remove();
    
    const el = document.createElement('div');
    el.className = 'dest-marker';
    el.innerHTML = '<svg width="28" height="36" viewBox="0 0 24 32" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z"/></svg>';
    destMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([dest.lon, dest.lat]).addTo(map);

    if (useCustom) {
      const custom = getCustomRoute(dest.label);
      const preferred = getPreferredRoute(dest.label);
      const track = custom?.track || preferred;
      if (track) {
        const fakeRoute = {
          distance: 0, duration: 0,
          geometry: { type: 'LineString', coordinates: track },
          steps: [{ distance: 0, duration: 0, name: '', instruction: 'Следуйте по вашему личному маршруту', type: 'depart', modifier: '', location: track[0] }]
        };
        setRoute(fakeRoute); setCurrentStep(0); setNavStarted(false);
        drawRoute(fakeRoute.geometry);
        const bounds = track.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(track[0], track[0]));
        map.fitBounds(bounds, { padding: { top: 120, bottom: 240, left: 40, right: 40 }, duration: 800 });
        setFollowing(false);
        return;
      }
    }

    try {
      const r = await getRoute(userPos.lat, userPos.lon, dest.lat, dest.lon, profile);
      setRoute(r); setCurrentStep(0); setNavStarted(false);
      drawRoute(r.geometry);
      const coords = r.geometry.coordinates;
      const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, { padding: { top: 120, bottom: 240, left: 40, right: 40 }, duration: 800 });
      setFollowing(false);
    } catch (e) {
      setError('Не удалось построить маршрут.');
    }
  }, [userPos, drawRoute, profile]);

  const startNavigation = useCallback(() => {
    if (!route || !userPos) return;
    gpsTrackRef.current = [];
    setNavStarted(true);
    setFollowing(true);
    offRouteSinceRef.current = null;
    const map = mapRef.current;
    if (map) {
      map.easeTo({
        center: [userPos.lon, userPos.lat], 
        zoom: 18,
        bearing: compass ?? userPos.heading ?? 0,
        pitch: 60,
        duration: 900,
        padding: { top: 100, bottom: 450, left: 0, right: 0 },
      });
    }
  }, [route, userPos, compass]);

  useEffect(() => {
    if (!route || !userPos || !navStarted) return;
    const steps = route.steps || [];
    let nextIdx = currentStep;
    for (let i = currentStep; i < steps.length; i++) {
      const loc = steps[i].location;
      if (!loc) continue;
      const d = haversine(userPos.lat, userPos.lon, loc[1], loc[0]);
      if (d < 30 && i + 1 < steps.length) nextIdx = i + 1;
    }
    if (nextIdx !== currentStep) setCurrentStep(nextIdx);

    const coords = route.geometry?.coordinates || [];
    const distOff = distToRouteMeters(userPos.lat, userPos.lon, coords);
    const now = Date.now();
    
    if (distOff > 40) {
      if (offRouteSinceRef.current == null) offRouteSinceRef.current = now;
      const elapsed = now - offRouteSinceRef.current;
      const canReroute = now - lastReroutedAtRef.current > 8000;
      if (elapsed > 3000 && canReroute && destination && !rerouting) {
        lastReroutedAtRef.current = now;
        offRouteSinceRef.current = null;
        setRerouting(true);
        getRoute(userPos.lat, userPos.lon, destination.lat, destination.lon, profile)
          .then((r) => { setRoute(r); setCurrentStep(0); drawRoute(r.geometry); })
          .catch(() => {})
          .finally(() => setRerouting(false));
      }
    } else {
      offRouteSinceRef.current = null;
    }
    
    if (destination) {
      const dArr = haversine(userPos.lat, userPos.lon, destination.lat, destination.lon);
      if (dArr < 25) {
        setTimeout(() => {
          setArrivedDest(destination);
          setShowSavePrompt(true);
        }, 2000);
      }
    }
  }, [userPos, route, currentStep, destination, navStarted, profile, drawRoute, rerouting]);

  const recenter = () => {
    if (userPos && mapRef.current) {
      mapRef.current.flyTo({ center: [userPos.lon, userPos.lat], zoom: 16, duration: 600 });
      setFollowing(true);
    }
  };

  return (
    <div className="App" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div 
        ref={mapContainerRef} 
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }} 
      />
      
      {mapInstance && routeCoords && (
        <RouteOverlay routeCoords={routeCoords} map={mapInstance} />
      )}
      {!route && (
        <SearchPanel
          onSelectDestination={handleSelectDestination}
          userPos={userPos}
          getCustomRoute={getCustomRoute}
          getPreferredRoute={getPreferredRoute}
        />
      )}

      <div className="absolute right-3 bottom-48 z-30 flex flex-col gap-2">
        <button
          onClick={recenter}
          className="w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center text-stone-700 active:scale-95 transition-transform"
        >
          <Locate size={20} />
        </button>
      </div>

      {showSavePrompt && (
        <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl p-5 shadow-xl w-full max-w-sm">
            <div className="text-[17px] font-bold text-stone-900 mb-2">🎉 Вы прибыли!</div>
            <div className="text-[14px] text-stone-500 mb-5">
              Сохранить ваш путь к <span className="font-medium text-stone-700">{arrivedDest?.label}</span>? Система запомнит его и будет предлагать в будущем.
            </div>
            <div className="flex gap-3">
              <button onClick={handleSkipSave} className="flex-1 py-3 rounded-xl border border-stone-200 text-stone-600 text-[15px] font-medium">
                Не сохранять
              </button>
              <button onClick={handleSaveRoute} className="flex-1 py-3 rounded-xl bg-amber-500 text-white text-[15px] font-semibold">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {route && !showSavePrompt && (
        <NavigationPanel
          route={route}
          currentStep={currentStep}
          destination={destination}
          onCancel={clearRoute}
          onFinish={clearRoute}
          navStarted={navStarted}
          onStart={startNavigation}
          rerouting={rerouting}
        />
      )}
    </div>
  );
}
