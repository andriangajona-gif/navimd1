import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
// Обязательный импорт CSS-стилей для корректного рендеринга слоев Canvas
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

  // Инициализация карты в ВЕКТОРНОМ режиме с фиксом для Safari CORS
  useEffect(() => {
    if (mapRef.current) return;
    
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL, 
      center: DEFAULT_CENTER,
      zoom: 12,
      minZoom: 6,
      maxZoom: 18,
      attributionControl: false,
      pitchWithRotate: true,
      dragRotate: true,
      maxBounds: [[24.5, 45.0], [31.5, 49.0]],
      // Переопределение заголовков запросов для обхода политики CORS на смартфонах
      transformRequest: (url, resourceType) => {
        if (resourceType === 'Tile' || resourceType === 'Style') {
          return {
            url: url,
            headers: { 'Accept': 'application/x-protobuf, application/json' }
          };
        }
        return { url: url };
      }
    });

    map.on('load', () => { 
      setMapReady(true); 
      setMapInstance(map);

      // === КАСТОМИЗАЦИЯ НОМЕРОВ ДОМОВ ===
      try {
        const layers = map.getStyle().layers;
        const houseLayers = layers.filter(l => 
          l.id.includes('house') || 
          l.id.includes('building-number') || 
          l.id.includes('address')
        );

        houseLayers.forEach(layer => {
          const layerId = layer.id;
          map.setLayoutProperty(layerId, 'text-size', [
            'interpolate', ['linear'], ['zoom'],
            14, 11,
            16, 22,
            17, 32,
            18, 42
          ]);
          map.setLayoutProperty(layerId, 'text-font', ["Metropolis Bold"]);
          map.setLayoutProperty(layerId, 'text-allow-overlap', true);
          map.setLayoutProperty(layerId, 'text-ignore-placement', true);
          map.setPaintProperty(layerId, 'text-halo-width', 3.5);
          map.setPaintProperty(layerId, 'text-halo-color', '#ffffff');
          map.setPaintProperty(layerId, 'text-color', '#000000');
        });
      } catch (e) {
        console.warn('Ошибка стилизации домов:', e);
      }
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

  // Компас
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

  // Геолокация
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

  // Блокировка экрана (WakeLock)
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

  // Ведение по маркеру и вращение
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
        pitch: 70, 
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

  // Обрезка линии маршру
