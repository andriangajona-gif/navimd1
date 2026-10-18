import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { STYLE_URL, getRoute, haversine } from '../lib/api';
import SearchPanel from './SearchPanel';
import NavigationPanel from './NavigationPanel';
import { Locate } from 'lucide-react';

// ===== FILTRU KALMAN =====
class KalmanFilter1D {
  constructor(processNoise = 0.1, measurementNoise = 2.0) {
    this.q = processNoise;
    this.r = measurementNoise;
    this.p = 1.0;
    this.x = 0;
    this.initialized = false;
  }
  update(measurement) {
    if (!this.initialized) {
      this.x = measurement;
      this.p = 1.0;
      this.initialized = true;
      return this.x;
    }
    this.p = this.p + this.q;
    const k = this.p / (this.p + this.r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * this.p;
    return this.x;
  }
}

class KalmanFilter2D {
  constructor(processNoise = 0.3, measurementNoise = 1.5) {
    this.filterLat = new KalmanFilter1D(processNoise, measurementNoise);
    this.filterLon = new KalmanFilter1D(processNoise, measurementNoise);
  }
  update(lat, lon) {
    return { lat: this.filterLat.update(lat), lon: this.filterLon.update(lon) };
  }
}

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
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

function findClosestPointOnRoute(lat, lon, coords) {
  if (!coords || coords.length < 2) {
    return { index: 0, point: coords?.[0] || [0, 0], distance: Infinity };
  }
  let minDist = Infinity;
  let bestIdx = 0;
  let bestPoint = coords[0];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i+1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) continue;
    let t = ((lon - a[0]) * dx + (lat - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projLon = a[0] + t * dx;
    const projLat = a[1] + t * dy;
    const d = haversine(lat, lon, projLat, projLon);
    if (d < minDist) {
      minDist = d;
      bestIdx = i;
      bestPoint = [projLon, projLat];
    }
  }
  return { index: bestIdx, point: bestPoint, distance: minDist };
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

const DEFAULT_CENTER = [28.8474, 47.0124];

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
      <polyline points={points.join(' ')} fill="none" stroke="#1d4ed8" strokeWidth="12" strokeOpacity="0.25" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points.join(' ')} fill="none" stroke="#2c7be5" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function weatherCodeToIcon(code) {
  if (code == null) return '❓';
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 95) return '⛈️';
  return '❓';
}

export default function NavigatorApp() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  const routeGeomRef = useRef(null);
  const wakeLockManagerRef = useRef(new WakeLockManager());
  const kalmanFilterRef = useRef(new KalmanFilter2D(0.3, 1.5));
  const snapPointRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const firstPositionRef = useRef(true);

  const [mapReady, setMapReady] = useState(false);
  const [mapInstance, setMapInstance] = useState(null);
  const [rawUserPos, setRawUserPos] = useState(null);
  const [filteredUserPos, setFilteredUserPos] = useState(null);
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
  const lastReroutedAtRef = useRef(0);
  const offRouteSinceRef = useRef(null);

  // Weather state: today + tomorrow (2 days)
  const [weather, setWeather] = useState(null);
  const [showWeatherPanel, setShowWeatherPanel] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const formattedTime = currentTime.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', hour12: false });

  // Fetch weather when we have a position (or fallback to center)
  useEffect(() => {
    let cancelled = false;
    const lat = filteredUserPos?.lat ?? rawUserPos?.lat ?? DEFAULT_CENTER[1];
    const lon = filteredUserPos?.lon ?? rawUserPos?.lon ?? DEFAULT_CENTER[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto&forecast_days=2`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data && data.daily) setWeather(data);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [filteredUserPos, rawUserPos]);

  useEffect(() => {
    if (mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: 17,
      minZoom: 6,
      maxZoom: 17, // ✅ Stable zoom level - no blank map
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: true,
      maxBounds: [[24.5, 45.0], [31.5, 49.0]],
    });

    map.on('load', () => { 
      setMapReady(true); 
      setMapInstance(map);
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
          ]);
          map.setLayoutProperty(layerId, 'text-font', ["Metropolis Bold"]);
          map.setLayoutProperty(layerId, 'text-allow-overlap', true);
          map.setLayoutProperty(layerId, 'text-ignore-placement', true);
          map.setPaintProperty(layerId, 'text-halo-width', 3.5);
          map.setPaintProperty(layerId, 'text-halo-color', '#ffffff');
          map.setPaintProperty(layerId, 'text-color', '#000000');
        });
      } catch (e) {
        console.warn('Stilizare case eșuată:', e);
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

  // ===== ELIMINAT PUNCTUL ALB DIN INTERIOR =====n