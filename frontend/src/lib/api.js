// Поиск улиц с принудительным форсированием румынского языка
export async function searchStreets(query, city = 'Florești') {
  if (!query || query.trim().length < 2) return { results: [] };
  try {
    // Добавлен явный параметр &accept-language=ro прямо в URL
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ' ' + city)}&addressdetails=1&limit=10&accept-language=ro`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'ro' } });
    if (!res.ok) return { results: [] };
    const data = await res.json();
    
    const mapped = data.map((item, idx) => {
      // Проверяем наличие оригинального имени в road или местном теге
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
