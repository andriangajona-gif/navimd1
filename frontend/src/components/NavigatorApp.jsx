import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { STYLE_URL, getRoute, speak, formatDistance, formatDuration, haversine } from '../lib/api';
import SearchPanel from './SearchPanel';
import NavigationPanel from './NavigationPanel';
import { Locate, Volume2, VolumeX, X } from 'lucide-react';

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

// corecție: am redenumit intern în caz că aveai nevoie de ea
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

export default function NavigatorApp() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const watchIdRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [userPos, setUserPos] = useState(null);
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
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
      console.warn('map err', e?.error?.message || e);
    });
    map.on('dragstart', () => setFollowing(false));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const onPos = (pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, heading: pos.coords.heading };
      setUserPos(p);
    };
    const onErr = (e) => {
      console.warn('geoloc err', e.message);
      setError('Nu s-a putut obține geolocația. Permiteți accesul la locație în browser.');
    };
    navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: true, timeout: 10000 });
    watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true, maximumAge: 1500, timeout: 15000,
    });
    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

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
      let bearing = userPos.heading;
      if (bearing == null || isNaN(bearing)) {
        const coords = route.geometry?.coordinates || [];
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
        id: 'route-line-shadow',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1d4ed8', 'line-width': 12, 'line-opacity': 0.4 },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2c7be5', 'line-width': 8 },
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

  const handleSelectDestination = useCallback(async (dest) => {
    setError(null);
    if (!userPos) {
      setError('Așteptăm semnalul GPS. Permiteți accesul la locație.');
      return;
    }
    setDestination(dest);
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
      
      if (map.isStyleLoaded()) {
        drawRoute(r.geometry);
      } else {
        map.once('idle', () => drawRoute(r.geometry));
      }
      
      // CORECTAT: maplibregl cu LngLatBounds implementat complet
      const coords = r.geometry.coordinates;
      if (coords && coords.length > 0) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c), 
          new maplibregl.LngLatBounds(coords[0], coords[0])
        );
        map.fitBounds(bounds, { padding: 80, duration: 1000 });
      }
    } catch (err) {
      console.error("Eroare la generarea rutei:", err);
      setError("Ruta nu a putut fi calculată.");
    }
  }, [userPos, profile, drawRoute]);

  return (
    <div className="relative w-full h-screen overflow-hidden">
      <div ref={mapContainerRef} className="w-full h-full" />

      {error && (
        <div className="absolute top-4 left-4 right-4 bg-red-500 text-white p-3 rounded-lg shadow-lg z-50 flex items-center justify-between">
          <span className="text-sm font-medium">{error}</span>
          <button onClick={() => setError(null)}><X size={18} /></button>
        </div>
      )}

      {!navStarted ? (
        <SearchPanel onSelectDestination={handleSelectDestination} />
      ) : (
        <NavigationPanel 
          route={route} 
          currentStep={currentStep} 
          onCancel={clearRoute} 
        />
      )}

      {destination && !navStarted && (
        <div className="absolute bottom-6 left-4 right-4 bg-white p-4 rounded-xl shadow-xl z-10 flex flex-col gap-3">
          <div>
            <h3 className="font-bold text-lg text-slate-800">{destination.name || 'Destinație selectată'}</h3>
            <p className="text-sm text-slate-500">{formatDistance(route?.distance || 0)} • {formatDuration(route?.duration || 0)}</p>
