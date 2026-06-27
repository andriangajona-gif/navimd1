const handleBuildingClick = async (b) => {
  if (!selectedStreet) return;
  let lat, lon;
  const streetName = selectedStreet.name;
  const city = selectedStreet.parent_name || 'Florești';
  const addressKey = `${streetName}|${b}|${city}`;

  if (streetName === "Strada 9 Mai" && MANUAL_COORDS[b]) {
    lat = MANUAL_COORDS[b].lat;
    lon = MANUAL_COORDS[b].lon;
  } else {
    const cached = getGeocodeCache(addressKey);
    if (cached) {
      lat = cached.lat;
      lon = cached.lon;
    } else {
      try {
        const geo = await geocodeBuilding(streetName, b, city);
        if (geo.lat && geo.lon) {
          lat = geo.lat;
          lon = geo.lon;
          saveGeocodeCache(addressKey, lat, lon);
        } else {
          const c = selectedStreet.centroid || { lat: 47.0124, lon: 28.8474 };
          lat = c.lat;
          lon = c.lon;
        }
      } catch (e) {
        console.warn('Geocoding error', e);
        const c = selectedStreet.centroid || { lat: 47.0124, lon: 28.8474 };
        lat = c.lat;
        lon = c.lon;
      }
    }
  }

  const fullAddress = `${streetName}, ${b}, ${city}`;
  const dest = {
    lat, lon,
    label: fullAddress,
    street: streetName,
    building: b,
    city: city,
  };

  // Setează bara de căutare cu adresa completă
  setQ(fullAddress);
  // Resetează selecția străzii pentru a ascunde lista de numere
  setSelectedStreet(null);
  setResults([]);
  setError(null);

  onSelectDestination(dest, false);
};
