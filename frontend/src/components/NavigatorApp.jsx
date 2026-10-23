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
    const b = coords[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
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
    const d = pointToSegMeters(lat, lon, coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
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

  const [weather, setWeather] = useState(null);

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const formattedTime = currentTime.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', hour12: false });

  const isNight = (() => {
    const h = currentTime.getHours();
    return h < 6 || h >= 19;
  })();

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
      maxZoom: 17,
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
        const houseLayers = layers.filter((l) =>
          l.id.includes('house') ||
          l.id.includes('building-number') ||
          l.id.includes('address')
        );
        houseLayers.forEach((layer) => {
          const layerId = layer.id;
          map.setLayoutProperty(layerId, 'text-size', [
            'interpolate', ['linear'], ['zoom'],
            14, 11,
            16, 22,
            17, 32,
          ]);
          map.setLayoutProperty(layerId, 'text-font', ['Metropolis Bold']);
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

  const updateUserMarker = useCallback((lat, lon) => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lon, lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([lon, lat]);
    }
  }, [mapReady]);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    const onPos = (pos) => {
      const { latitude, longitude, heading, accuracy, speed } = pos.coords;
      const now = Date.now();
      if (now - lastUpdateTimeRef.current < 100) return;
      lastUpdateTimeRef.current = now;

      const filtered = kalmanFilterRef.current.update(latitude, longitude);
      setRawUserPos({ lat: latitude, lon: longitude, heading, accuracy, speed });
      setFilteredUserPos({ lat: filtered.lat, lon: filtered.lon, heading, accuracy, speed });

      if (firstPositionRef.current && mapRef.current) {
        firstPositionRef.current = false;
        const map = mapRef.current;
        map.flyTo({
          center: [filtered.lon, filtered.lat],
          zoom: 17,
          duration: 1200,
        });
        setFollowing(true);
      }

      if (navStarted && routeGeomRef.current && filtered) {
        const coords = routeGeomRef.current;
        if (coords.length >= 2) {
          const { point, distance } = findClosestPointOnRoute(filtered.lat, filtered.lon, coords);
          if (distance < 30) {
            snapPointRef.current = { lat: point[1], lon: point[0], distance };
            updateUserMarker(point[1], point[0]);
          } else {
            snapPointRef.current = null;
            updateUserMarker(filtered.lat, filtered.lon);
          }
        } else {
          updateUserMarker(filtered.lat, filtered.lon);
        }
      } else if (filtered) {
        updateUserMarker(filtered.lat, filtered.lon);
      }
    };

    const onErr = (e) => {
      console.warn('geoloc err', e.message);
      setError('Nu s-a putut obține geolocația.');
    };

    const options = {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 5000,
    };

    navigator.geolocation.getCurrentPosition(onPos, onErr, options);
    watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, options);

    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [navStarted, updateUserMarker]);

  useEffect(() => {
    const wl = wakeLockManagerRef.current;
    if (navStarted) wl.acquire();
    else wl.release();
    return () => { wl.release(); };
  }, [navStarted]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const wl = wakeLockManagerRef.current;
      if (document.visibilityState === 'visible' && navStarted) wl.acquire();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [navStarted]);

  useEffect(() => {
    if (!mapReady || !filteredUserPos) return;
    const map = mapRef.current;
    if (!map) return;

    const displayPos = snapPointRef.current || filteredUserPos;
    if (!displayPos) return;

    if (following && navStarted && route) {
      const bearing = compass ?? filteredUserPos.heading ?? 0;
      map.easeTo({
        center: [displayPos.lon, displayPos.lat],
        zoom: 17,
        bearing: isNaN(bearing) ? 0 : bearing,
        pitch: 0,
        duration: 400,
        padding: { top: 280, bottom: 150, left: 0, right: 0 },
      });
    } else if (following && route) {
      map.easeTo({
        center: [displayPos.lon, displayPos.lat],
        zoom: 17,
        bearing: 0,
        pitch: 0,
        duration: 500,
      });
    }
  }, [filteredUserPos, mapReady, following, route, navStarted, compass]);

  useEffect(() => {
    if (!filteredUserPos || !routeGeomRef.current || !navStarted) return;
    const fullCoords = routeGeomRef.current;
    if (fullCoords.length < 2) return;
    const pos = snapPointRef.current || filteredUserPos;
    if (!pos) return;
    const { index, point } = findClosestPointOnRoute(pos.lat, pos.lon, fullCoords);
    const newCoords = [point, ...fullCoords.slice(index + 1)];
    setRouteCoords(newCoords);
  }, [filteredUserPos, navStarted]);

  const drawRoute = useCallback((geo) => {
    routeGeomRef.current = geo.coordinates;
    setRouteCoords(geo.coordinates);
  }, []);

  const resetAll = useCallback(() => {
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null; }
    const map = mapRef.current;
    if (map) {
      map.easeTo({ pitch: 0, bearing: 0, zoom: 17, duration: 600 });
    }
    routeGeomRef.current = null;
    snapPointRef.current = null;
    setRoute(null); setRouteCoords(null); setDestination(null);
    setCurrentStep(0); setNavStarted(false);
    offRouteSinceRef.current = null;
  }, []);

  const clearRoute = useCallback(() => {
    resetAll();
  }, [resetAll]);

  const handleSelectDestination = useCallback(async (dest, useCustom = false) => {
    setError(null);
    if (!rawUserPos) { setError('Aștept semnal GPS.'); return; }
    setDestination(dest);
    const map = mapRef.current;
    if (destMarkerRef.current) destMarkerRef.current.remove();

    const el = document.createElement('div');
    el.className = 'dest-marker';
    el.innerHTML = '<svg width="28" height="36" viewBox="0 0 24 32" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0zm0 16c-2.2 0-4-1.8-4-4s1.8-4 4-4 4 1.8 4 4-1.8 4-4 4z"/></svg>';
    el.style.color = '#ef4444';
    destMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([dest.lon, dest.lat]).addTo(map);

    try {
      const r = await getRoute(rawUserPos.lat, rawUserPos.lon, dest.lat, dest.lon, profile);
      setRoute(r); setCurrentStep(0); setNavStarted(false);
      drawRoute(r.geometry);
      const coords = r.geometry.coordinates;
      const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      map.fitBounds(bounds, {
        padding: { top: 120, bottom: 240, left: 40, right: 40 },
        maxZoom: 17,
        duration: 800,
      });
      setFollowing(false);
    } catch (e) {
      setError('Nu s-a putut construi ruta.');
    }
  }, [rawUserPos, drawRoute, profile]);

  const startNavigation = useCallback(() => {
    if (!route || !rawUserPos) return;
    setNavStarted(true);
    setFollowing(true);
    offRouteSinceRef.current = null;
    const map = mapRef.current;
    if (map) {
      if (routeGeomRef.current) {
        const pos = snapPointRef.current || { lat: rawUserPos.lat, lon: rawUserPos.lon };
        const { index, point } = findClosestPointOnRoute(pos.lat, pos.lon, routeGeomRef.current);
        const newCoords = [point, ...routeGeomRef.current.slice(index + 1)];
        setRouteCoords(newCoords);
      }
      map.easeTo({
        center: [rawUserPos.lon, rawUserPos.lat],
        zoom: 17,
        bearing: compass ?? rawUserPos.heading ?? 0,
        pitch: 0,
        duration: 700,
        padding: { top: 280, bottom: 150, left: 0, right: 0 },
      });
    }
  }, [route, rawUserPos, compass]);

  useEffect(() => {
    if (!route || !filteredUserPos || !navStarted) return;
    const pos = snapPointRef.current || filteredUserPos;
    if (!pos) return;

    const steps = route.steps || [];
    let nextIdx = currentStep;
    for (let i = currentStep; i < steps.length; i++) {
      const loc = steps[i].location;
      if (!loc) continue;
      const d = haversine(pos.lat, pos.lon, loc[1], loc[0]);
      if (d < 25 && i + 1 < steps.length) nextIdx = i + 1;
    }
    if (nextIdx !== currentStep) setCurrentStep(nextIdx);

    const coords = route.geometry?.coordinates || [];
    const distOff = distToRouteMeters(pos.lat, pos.lon, coords);
    const now = Date.now();

    if (distOff > 35) {
      if (offRouteSinceRef.current == null) offRouteSinceRef.current = now;
      const elapsed = now - offRouteSinceRef.current;
      const canReroute = now - lastReroutedAtRef.current > 6000;
      if (elapsed > 2000 && canReroute && destination && !rerouting) {
        lastReroutedAtRef.current = now;
        offRouteSinceRef.current = null;
        setRerouting(true);
        getRoute(pos.lat, pos.lon, destination.lat, destination.lon, profile)
          .then((r) => {
            setRoute(r);
            setCurrentStep(0);
            drawRoute(r.geometry);
            if (routeGeomRef.current) {
              const { point } = findClosestPointOnRoute(pos.lat, pos.lon, routeGeomRef.current);
              snapPointRef.current = { lat: point[1], lon: point[0], distance: 0 };
            }
          })
          .catch(() => {})
          .finally(() => setRerouting(false));
      }
    } else {
      offRouteSinceRef.current = null;
    }

    if (destination) {
      const dArr = haversine(pos.lat, pos.lon, destination.lat, destination.lon);
      if (dArr < 20) {
        setTimeout(() => {
          resetAll();
        }, 2000);
      }
    }
  }, [filteredUserPos, route, currentStep, destination, navStarted, profile, drawRoute, rerouting, resetAll]);

  const recenter = () => {
    if (filteredUserPos && mapRef.current) {
      const pos = snapPointRef.current || filteredUserPos;
      mapRef.current.flyTo({ center: [pos.lon, pos.lat], zoom: 17, duration: 600 });
      setFollowing(true);
    }
  };

  const weatherBadgeClass = isNight
    ? 'bg-black/60 text-white border border-white/20'
    : 'bg-white/20 text-black border border-white/30';

  return (
    <div className="App" style={{ position: 'relative' }}>
      <div ref={mapContainerRef} className="absolute inset-0" />
      {mapInstance && routeCoords && (
        <RouteOverlay routeCoords={routeCoords} map={mapInstance} />
      )}
      {!route && (
        <SearchPanel
          onSelectDestination={handleSelectDestination}
          userPos={rawUserPos}
        />
      )}

      <div className="absolute left-4 right-4 bottom-4 z-10 pointer-events-none">
        <div className={`pointer-events-auto mx-auto w-full max-w-[1050px] rounded-2xl px-6 py-3 shadow-lg border backdrop-blur-sm flex items-center ${isNight ? 'bg-black/55 text-white border-white/10' : 'bg-white/30 text-black border-white/30'}`}>
          <div className="flex items-center gap-2">
            <div className={`rounded-lg h-10 w-10 flex items-center justify-center text-xl ${isNight ? 'bg-white/06' : 'bg-white/70'}`}>
              {weather ? weatherCodeToIcon(weather.daily.weathercode?.[0]) : '⏳'}
            </div>
            {weather && (
              <div className="text-sm font-semibold">{Math.round(weather.daily.temperature_2m_max[0])}°</div>
            )}
            <div className="text-sm opacity-80 ml-2">Azi</div>
          </div>

          <div className="flex-1" />

          <div className="ml-auto text-right">
            <div className="text-6xl font-extrabold tracking-tight">{formattedTime}</div>
          </div>
        </div>
      </div>

      <div className="absolute right-3 bottom-48 z-30 flex flex-col gap-2">
        <button
          onClick={recenter}
          className="w-11 h-11 rounded-full bg-white/30 backdrop-blur-sm border border-white/40 shadow-md flex items-center justify-center text-black/80 active:scale-95 transition-transform"
        >
          <Locate size={20} />
        </button>
      </div>

      {route && (
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
