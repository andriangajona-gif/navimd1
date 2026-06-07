import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { STYLE_URL, getRoute, speak, formatDistance, formatDuration, haversine, recordTrip, getPreferredRoute } from '../lib/api';
import SearchPanel from './SearchPanel';
import NavigationPanel from './NavigationPanel';
import { Locate, Volume2, VolumeX, X, Compass } from 'lucide-react';

// --- Funcții utilitare ---
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

export function getCustomRoute(destLabel) {
  try { return JSON.parse(localStorage.getItem('custom_routes') || '{}')[destLabel] || null; } 
  catch (e) { return null; }
}

function saveCustomRoute(destLabel, track) {
  try {
    const existing = JSON.parse(localStorage.getItem('custom_routes') || '{}');
    existing[destLabel] = { track, savedAt: Date.now() };
    localStorage.setItem('custom_routes', JSON.stringify(existing));
  } catch (e) {}
}

export default function NavigatorApp() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  
  const [mapReady, setMapReady] = useState(false);
  const [userPos, setUserPos] = useState(null);
  const [compass, setCompass] = useState(null);
  const [destination, setDestination] = useState(null);
  const [route, setRoute] = useState(null);
  const [navStarted, setNavStarted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [following, setFollowing] = useState(true);
  const [error, setError] = useState(null);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  
  // 1. Inițializare hartă
  useEffect(() => {
    if (mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: STYLE_URL,
      center: [28.8474, 47.0124],
      zoom: 12
    });

    map.on('load', () => {
      // Adăugăm sursa și layer-ul pentru rută imediat la load
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2c7be5', 'line-width': 8, 'line-opacity': 0.8 }
      });
      setMapReady(true);
    });
    mapRef.current = map;
  }, []);

  // 2. Funcție pentru desenarea rutei (înlocuiește vechiul RouteOverlay)
  const drawRouteOnMap = useCallback((coords) => {
    if (!mapRef.current || !mapRef.current.getSource('route')) return;
    mapRef.current.getSource('route').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords }
    });
  }, []);

  // 3. Logica de actualizare poziție și centrare
  useEffect(() => {
    if (!mapReady || !userPos) return;
    
    // Actualizare marker utilizator
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-dot'; // Asigură-te că ai stilul CSS definit
      userMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([userPos.lon, userPos.lat]).addTo(mapRef.current);
    } else {
      userMarkerRef.current.setLngLat([userPos.lon, userPos.lat]);
    }

    // Urmărire automată
    if (following) {
      mapRef.current.easeTo({
        center: [userPos.lon, userPos.lat],
        zoom: navStarted ? 17.5 : 15,
        bearing: navStarted ? (compass ?? userPos.heading ?? 0) : 0,
        padding: navStarted ? { top: 280, bottom: 0, left: 0, right: 0 } : {}
      });
    }
  }, [userPos, mapReady, following, navStarted, compass]);

  // Restul logicii tale (Geolocation, startNavigation, etc.) rămâne similară,
  // dar asigură-te că apelezi `drawRouteOnMap(r.geometry.coordinates)` 
  // în loc de vechiul `drawRoute`.

  return (
    <div className="App" style={{ position: 'relative', height: '100vh', width: '100%' }}>
      <div ref={mapContainerRef} className="absolute inset-0" />
      {/* SearchPanel, NavigationPanel, Buttons etc. rămân la fel */}
    </div>
  );
}
