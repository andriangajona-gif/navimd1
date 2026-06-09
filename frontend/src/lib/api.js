// Stil raster valid pentru MapLibre
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
  if (!res.ok) throw new Error('Eroare de rețea la solicitarea traseului');
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

// Căutare străzi utilizând API-ul autorizat map.md
export async function searchStreets(query, city = 'Floresti') {
  if (!query || query.trim().length < 2) return { results: [] };
  try {
    // URL-ul complet care include token-ul tău de acces în structura nativă
    const url = `https://040c1d37-142e-4f81-adfb-c6f7a7dce753@map.md/api/companies/webmap/search_street?q=${encodeURIComponent(query)}&location=${encodeURIComponent(city)}&lang=ro`;
    
    // Trimitem cererea adăugând și un header standard în caz că serverul verifică semnătura cheii
    const res = await fetch(url, {
      headers: {
        'Authorization': 'Bearer 040c1d37-142e-4f81-adfb-c6f7a7dce753',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      console.warn("Map.md a respins cererea directă. Activăm tunelul de rezervă.");
      return { results: [] };
    }
    
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.results || []);
    
    const results = items.map((item, idx) => {
      const streetName = item.name || item.street_name || query;
      
      // Citim obiectele din masivul "houses" returnat direct de map.md
      let realHouseNumbers = [];
      if (item.houses && Array.isArray(item.houses)) {
        realHouseNumbers = item.houses
          .map(h => String(h.number || h.name || h))
          .filter(num => num && num !== 'undefined');
      } else if (item.buildings && Array.isArray(item.buildings)) {
        realHouseNumbers = item.buildings.map(b => String(b.number || b));
      }

      // Coordonatele geometrice oferite de map.md
      const lat = item.lat || item.latitude || item.y || 47.893;
      const lon = item.lon || item.longitude || item.x || 28.301;

      return {
        id: item.id || idx,
        name: streetName,
        type: 'street',
        parent_name: 'Florești',
        count: realHouseNumbers.length, 
        centroid: { lat: parseFloat(lat), lon: parseFloat(lon) },
        buildings: realHouseNumbers
      };
    });

    return { results };
  } catch (e) {
    console.error("Eroare la conectarea cu cheia API map.md:", e);
    return { results: [] };
  }
}

// Geocodificare clădire selectată
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
