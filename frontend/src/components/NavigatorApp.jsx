import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { STYLE_URL, getRoute, speak, formatDistance, formatDuration, haversine } from '../lib/api';
import SearchPanel from './SearchPanel';
import NavigationPanel from './NavigationPanel';
import { Locate, Volume2, VolumeX, X } from 'lucide-react';

// Helpers for routing: bearing & closest distance to line
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
  // Approximate using equirectangular projection
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

// Default Moldova center (Chișinău)
const DEFAULT_CENTER = [28.8474, 47.0124];

export default function NavigatorApp() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const watchIdRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [userPos, setUserPos] = useState(null); // {lat, lon, heading}
  const [destination, setDestination] = useState(null); // {lat, lon, label}
  const [route, setRoute] = useState(null); // backend response
  const [currentStep, setCurrentStep] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const [profile] = useState('driving');
  const [error, setError] = useState(null);
  const [following, setFollowing] = useState(true);
  const [navStarted, setNavStarted] = useState(false);
  const [rerouting, setRerouting] = useState(false);
  const lastSpokenStepRef = useRef(-1);
  const lastReroutedAtRef = useRef(0);
  const offRouteSinceRef = useRef(null);

  // Init map
  useEffect(() => {
    if (mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: 12,
      minZoom: 6,
      maxZoom: 19,
      attributionControl: false,
      pitchWithRotate: true,
      dragRotate: true,
      maxBounds: [[24.5, 45.0], [31.5, 49.0]],
    });
    map.on('load', () => setMapReady(true));
    map.on('error', (e) => {
      // eslint-disable-next-line no-console
      console.warn('map err', e?.error?.message || e);
    });
    map.on('dragstart', () => setFollowing(false));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Geolocation watch
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const onPos = (pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, heading: pos.coords.heading };
      setUserPos(p);
    };
    const onErr = (e) => {
      // eslint-disable-next-line no-console
      console.warn('geoloc err', e.message);
      setError('Не удалось получить геолокацию. Разрешите доступ к местоположению в браузере.');
    };
    navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 10000 });
    watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true, maximumAge: 1500, timeout: 15000,
    });
    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // Update user marker on map
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
      // Compute bearing: prefer GPS heading, fallback to next route point bearing
      let bearing = userPos.heading;
      if (bearing == null || isNaN(bearing)) {
        const coords = route.geometry?.coordinates || [];
        // Find nearest segment and use its forward bearing
        let best = 0, bestD = Infinity;
        for (let i = 0; i < coords.length - 1; i++) {
          const d = haversine(userPos.lat, userPos.lon, coords[i][1], coords[i][0]);
          if (d < bestD) { bestD = d; best = i; }
        }
        const a = coords[best], b = coords[Math.min(best + 1, coords.length - 1)];
        if (a && b) bearing = calcBearing(a[1], a[0], b[1], b[0]);
      }
      map.easeTo({
        center: [userPos.lon, userPos.lat],
        zoom: 17.5,
        bearing: bearing ?? 0,
        pitch: 55,
        duration: 700,
        padding: { top: 280, bottom: 0, left: 0, right: 0 },
      });
    } else if (following && route) {
      map.easeTo({ center: [userPos.lon, userPos.lat], duration: 600 });
    }
  }, [userPos, mapReady, following, route, navStarted]);

  // Draw / update route line
  const drawRoute = useCallback((geo) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('route');
    const data = { type: 'Feature', geometry: geo, properties: {} };
    if (src) {
      src.setData(data);
    } else {
      map.addSource('route', { type: 'geojson', data });
      map.addLayer({
        id: 'route-line-shadow', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1d4ed8', 'line-width': 9, 'line-opacity': 0.25 },
      });
      map.addLayer({
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2c7be5', 'line-width': 6 },
      });
    }
  }, []);

  const clearRoute = useCallback(() => {
    const map = mapRef.current; if (!map) return;
    if (map.getLayer('route-line')) map.removeLayer('route-line');
    if (map.getLayer('route-line-shadow')) map.removeLayer('route-line-shadow');
    if (map.getSource('route')) map.removeSource('route');
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null; }
    map.easeTo({ pitch: 0, bearing: 0, zoom: 14, duration: 600 });
    setRoute(null); setDestination(null); setCurrentStep(0); setNavStarted(false); lastSpokenStepRef.current = -1;
    offRouteSinceRef.current = null;
  }, []);

  // Handle when a building/destination is selected from SearchPanel
  const handleSelectDestination = useCallback(async (dest) => {
    setError(null);
    if (!userPos) {
      setError('Ожидаем GPS-сигнал. Разрешите доступ к местоположению.');
      return;
    }
    setDestination(dest);
    // Place destination marker
    const map = mapRef.current;
    if (destMarkerRef.current) destMarkerRef.current.remove();
    const el = document.createElement('div');
    el.className = 'dest-marker';
    el.innerHTML = '<svg width="28" height="36" viewBox="0 0 24 32" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z"/></svg>';
    destMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([dest.lon, dest.lat]).addTo(map);

    try {
      const r = await getRoute(userPos.lat, userPos.lon, dest.lat, dest.lon, profile);
      setRoute(r);
      setCurrentStep(0);
      setNavStarted(false);
      lastSpokenStepRef.current = -1;
      drawRoute(r.geometry);
      // Fit bounds to show full route preview
      const coords = r.geometry.coordinates;
      const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, { padding: { top: 120, bottom: 240, left: 40, right: 40 }, duration: 800 });
      setFollowing(false);
    } catch (e) {
      setError('Не удалось построить маршрут. Попробуйте ещё раз.');
    }
  }, [userPos, drawRoute, profile]);

  // Start active navigation (after pressing "Старт")
  const startNavigation = useCallback(() => {
    if (!route || !userPos) return;
    setNavStarted(true);
    setFollowing(true);
    offRouteSinceRef.current = null;
    const map = mapRef.current;
    if (map) {
      const coords = route.geometry?.coordinates || [];
      let bearing = userPos.heading;
      if ((bearing == null || isNaN(bearing)) && coords.length >= 2) {
        bearing = calcBearing(coords[0][1], coords[0][0], coords[1][1], coords[1][0]);
      }
      map.easeTo({
        center: [userPos.lon, userPos.lat],
        zoom: 17.5,
        bearing: bearing ?? 0,
        pitch: 55,
        duration: 900,
        padding: { top: 280, bottom: 0, left: 0, right: 0 },
      });
    }
    if (voiceOn && route.steps?.length) {
      const total = `Маршрут построен. ${formatDistance(route.distance)}, примерно ${formatDuration(route.duration)}. ${route.steps[0].instruction}.`;
      speak(total);
      lastSpokenStepRef.current = 0;
    }
  }, [route, userPos, voiceOn]);

  // Voice navigation + off-route detection (only after Старт)
  useEffect(() => {
    if (!route || !userPos || !navStarted) return;
    const steps = route.steps || [];
    // Find next step ahead based on proximity to step.location
    let nextIdx = currentStep;
    for (let i = currentStep; i < steps.length; i++) {
      const loc = steps[i].location;
      if (!loc) continue;
      const d = haversine(userPos.lat, userPos.lon, loc[1], loc[0]);
      if (d < 30 && i + 1 < steps.length) {
        nextIdx = i + 1;
      }
    }
    if (nextIdx !== currentStep) {
      setCurrentStep(nextIdx);
      if (voiceOn && lastSpokenStepRef.current !== nextIdx && steps[nextIdx]) {
        speak(steps[nextIdx].instruction);
        lastSpokenStepRef.current = nextIdx;
      }
    }

    // Off-route detection: if > 40m from route polyline for >3s, recompute
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
        if (voiceOn) speak('Перестраиваю маршрут');
        getRoute(userPos.lat, userPos.lon, destination.lat, destination.lon, profile)
          .then((r) => {
            setRoute(r);
            setCurrentStep(0);
            lastSpokenStepRef.current = -1;
            drawRoute(r.geometry);
          })
          .catch(() => { /* ignore */ })
          .finally(() => setRerouting(false));
      }
    } else {
      offRouteSinceRef.current = null;
    }

    // Arrival
    if (destination) {
      const dArr = haversine(userPos.lat, userPos.lon, destination.lat, destination.lon);
      if (dArr < 25 && lastSpokenStepRef.current !== 9999) {
        if (voiceOn) speak('Вы прибыли в пункт назначения');
        lastSpokenStepRef.current = 9999;
      }
    }
  }, [userPos, route, currentStep, voiceOn, destination, navStarted, profile, drawRoute, rerouting]);

  const recenter = () => {
    if (userPos && mapRef.current) {
      mapRef.current.flyTo({ center: [userPos.lon, userPos.lat], zoom: 16, duration: 600 });
      setFollowing(true);
    }
  };

  return (
    <div className="App">
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* Search at top */}
      {!route && (
        <SearchPanel
          onSelectDestination={handleSelectDestination}
          userPos={userPos}
        />
      )}

      {/* Right floating controls */}
      <div className="absolute right-3 top-3 z-30 flex flex-col gap-2">
        <button
          onClick={() => setVoiceOn(v => !v)}
          className="w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center text-stone-700 active:scale-95 transition-transform"
          aria-label="toggle voice"
        >
          {voiceOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        <button
          onClick={recenter}
          className="w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center text-stone-700 active:scale-95 transition-transform"
          aria-label="locate me"
        >
          <Locate size={20} />
        </button>
      </div>

      {error && (
        <div className="absolute top-20 left-3 right-3 z-40 bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-3 py-2 shadow flex items-start gap-2">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600"><X size={16} /></button>
        </div>
      )}

      {/* Navigation bottom panel */}
      {route && (
        <NavigationPanel
          route={route}
          currentStep={currentStep}
          destination={destination}
          onCancel={clearRoute}
          navStarted={navStarted}
          onStart={startNavigation}
          rerouting={rerouting}
        />
      )}
    </div>
  );
}
