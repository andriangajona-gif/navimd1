export const STYLE_URL = {
  "version": 8,
  "sources": {
    "osm-tiles": {
      "type": "raster",
      "tiles": [
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      ],
      "tileSize": 256,
      "attribution": "&copy; OpenStreetMap contributors"
    }
  },
  "layers": [
    {
      "id": "osm-raster-layer",
      "type": "raster",
      "source": "osm-tiles",
      "minzoom": 0,
      "maxzoom": 19
    }
  ]
};

export function formatDistance(meters) {
  if (!meters) return '0 m';
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds) {
  if (!seconds) return '0 min';
  const mins = Math.round(seconds / 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs} ч ${remMins} мин` : `${hrs} ч`;
  }
  return `${mins} min`;
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getRoute(startLat, startLon, endLat, endLon, profile = 'driving') {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Eroare la calcularea traseului');
  const data = await res.json();
  if (!data.routes || data.routes.length === 0) throw new Error('Traseul nu a fost găsit');
  
  const route = data.routes[0];
  return {
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry,
    steps: route.legs[0].steps.map(s => ({
      distance: s.distance,
      duration: s.duration,
      name: s.name || '',
      instruction: s.maneuver?.instruction || 'Continuați deplasarea',
      type: s.maneuver?.type || '',
      modifier: s.maneuver?.modifier || '',
      location: s.maneuver?.location || null
    }))
  };
}

// RESTAURAT: URL-ul tău original neatins care funcționa perfect din prima
export async function searchStreets(query, city = 'Floresti') {
  if (!query || query.trim().length < 2) return { results: [] };
  try {
    const url = `https://040c1d37-142e-4f81-adfb-c6f7a7dce753@map.md/api/companies/webmap/search_street?q=${encodeURIComponent(query)}&location=${encodeURIComponent(city)}&lang=ro`;
    
    const res = await fetch(url);
    if (!res.ok) return { results: [] };
    
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    
    const results = items.map((item, idx) => {
      const streetName = item.name || query;
      
      // Extragerea masivului de clădiri conform JSON-ului brut de la map.md
      let realBuildings = [];
      if (item.buildings && Array.isArray(item.buildings)) {
        realBuildings = item.buildings.map(b => String(b));
      }

      // Extragerea coordonatelor corecte din obiectul centroid
      const lat = item.centroid?.lat || 47.893;
      const lon = item.centroid?.lon || 28.301;

      return {
        id: item.id || idx,
        name: streetName,
        type: 'street',
        parent_name: 'Florești',
        count: realBuildings.length, 
        centroid: { lat: parseFloat(lat), lon: parseFloat(lon) },
        buildings: realBuildings // Acum componenta vizuală va genera corect grila cu numerele caselor
      };
    });

    return { results };
  } catch (e) {
    console.error("Eroare rețea căutare:", e);
    return { results: [] };
  }
}

export async function geocodeBuilding(streetName, buildingNumber, parentName = 'Florești') {
  try {
    const fullQuery = `${streetName} ${buildingNumber}, ${parentName}`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullQuery)}&limit=1&accept-language=ro`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'ro' } });
    if (!res.ok) return { lat: null, lon: null };
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch (e) {}
  return { lat: null, lon: null };
}

export function recordTrip(track, label) {
  try {
    const history = JSON.parse(localStorage.getItem('trip_history') || '[]');
    history.push({ label, timestamp: Date.now(), pointsCount: track.length });
    localStorage.setItem('trip_history', JSON.stringify(history));
  } catch (e) {}
}

export function scoreRoute(track) { return track ? track.length : 0; }
export function getPreferredRoute(destLabel) {
  try {
    const existing = JSON.parse(localStorage.getItem('custom_routes') || '{}');
    return existing[destLabel]?.track || null;
  } catch (e) { return null; }
}
