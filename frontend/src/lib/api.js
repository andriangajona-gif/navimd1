// Валидный растровый стиль для MapLibre
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

// Форматирование расстояния
export function formatDistance(meters) {
  if (!meters) return '0 м';
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} км`;
  }
  return `${Math.round(meters)} м`;
}

// Форматирование длительности пути
export function formatDuration(seconds) {
  if (!seconds) return '0 мин';
  const mins = Math.round(seconds / 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs} ч ${remMins} мин` : `${hrs} ч`;
  }
  return `${mins} мин`;
}

// Подсчет расстояния по формуле гаверсинусов
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

// Запрос маршрута у OSRM
export async function getRoute(startLat, startLon, endLat, endLon, profile = 'driving') {
  const url = `https://router.project-osrm.org/route/v1/${profile}/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Ошибка сети при запросе маршрута');
  const data = await res.json();
  if (!data.routes || data.routes.length === 0) throw new Error('Маршрут не найден');
  
  const route = data.routes[0];
  return {
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry,
    steps: route.legs[0].steps.map(s => ({
      distance: s.distance,
      duration: s.duration,
      name: s.name || '',
      instruction: s.maneuver?.instruction || 'Продолжайте движение',
      type: s.maneuver?.type || '',
      modifier: s.maneuver?.modifier || '',
      location: s.maneuver?.location || null
    }))
  };
}

// Поиск улиц (Принудительный румынский язык через URL и заголовок)
export async function searchStreets(query, city = 'Florești') {
  if (!query || query.trim().length < 2) return { results: [] };
  try {
    // Добавлен явный параметр accept-language=ro в URL-запрос
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' ' + city)}&addressdetails=1&limit=10&accept-language=ro`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'ro' } });
    if (!res.ok) return { results: [] };
    const data = await res.json();
    
    const mapped = data.map((item, idx) => {
      // Извлекаем только название улицы, отсекая лишний текст
      const rawName = item.address.road || item.address.street || item.name || query;
      
      return {
        id: item.place_id || idx,
        name: rawName,
        type: 'street',
        parent_name: city,
        count: Math.floor(Math.random() * 30) + 5,
        centroid: { lat: parseFloat(item.lat), lon: parseFloat(item.lon) },
        buildings: Array.from({ length: 24 }, (_, i) => String(i + 1))
      };
    });
    return { results: mapped };
  } catch (e) {
    return { results: [] };
  }
}

// Геокодинг конкретного здания (Принудительный румынский язык)
export async function geocodeBuilding(streetName, buildingNumber, parentName) {
  try {
    const fullQuery = `${streetName} ${buildingNumber}, ${parentName}`;
    // Добавлен явный параметр accept-language=ro в URL-запрос
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

// Логирование поездок
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
