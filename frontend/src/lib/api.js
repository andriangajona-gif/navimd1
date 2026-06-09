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

// Formatare distanță
export function formatDistance(meters) {
  if (!meters) return '0 m';
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

// Formatare durată
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

// Calcul distanță prin formula Haversine
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

// Solicitare traseu de la OSRM
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

// Căutare străzi cu extragerea numerelor reale de case
export async function searchStreets(query, city = 'Florești') {
  if (!query || query.trim().length < 2) return { results: [] };
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' ' + city)}&addressdetails=1&limit=10&accept-language=ro`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'ro' } });
    if (!res.ok) return { results: [] };
    const data = await res.json();
    
    // Generăm procesarea pentru fiecare stradă găsită
    const promises = data.map(async (item, idx) => {
      const rawName = item.address.road || item.address.street || item.name || query;
      
      let realHouseNumbers = [];
      try {
        // Interogăm suplimentar OSM pentru a găsi toate clădirile înregistrate pe această stradă specifică
        const housesUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(rawName + ', ' + city)}&addressdetails=1&limit=50&accept-language=ro`;
        const housesRes = await fetch(housesUrl, { headers: { 'Accept-Language': 'ro' } });
        if (housesRes.ok) {
          const housesData = await housesRes.json();
          // Extragem numerele caselor (housenumber) care nu sunt goale
          const numbers = housesData
            .map(h => h.address?.house_number || h.address?.housenumber)
            .filter(num => num !== undefined && num !== null && num !== '');
          
          // Eliminăm duplicatele și le sortăm numeric sau alfabetic
          if (numbers.length > 0) {
            realHouseNumbers = [...new Set(numbers)].sort((a, b) => {
              return parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b);
            });
          }
        }
      } catch (e) {
        console.warn("Eroare la extragerea caselor reale:", e);
      }

      // Rezervă (fallback): Dacă pe OSM strada nu are salvate numere de casă individuale,
      // generăm o listă extinsă mult mai completă (de la 1 până la 90) pentru a acoperi toate casele posibile.
      if (realHouseNumbers.length === 0) {
        realHouseNumbers = Array.from({ length: 90 }, (_, i) => String(i + 1));
      }

      return {
        id: item.place_id || idx,
        name: rawName,
        type: 'street',
        parent_name: city,
        count: realHouseNumbers.length,
        centroid: { lat: parseFloat(item.lat), lon: parseFloat(item.lon) },
        buildings: realHouseNumbers
      };
    });

    const mapped = await Promise.all(promises);
    return { results: mapped };
  } catch (e) {
    return { results: [] };
  }
}

// Geocodificare clădire specifică
export async function geocodeBuilding(streetName, buildingNumber, parentName) {
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

// Salvare istoric călătorii
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
