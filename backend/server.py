import os
import re
from math import atan2, cos, radians, sin, sqrt

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Navigator MD Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")

MAPMD_API_KEY = os.getenv("MAPMD_API_KEY")
MAPMD_SEARCH_URL = os.getenv("MAPMD_SEARCH_URL")
MAPMD_GEOCODE_URL = os.getenv("MAPMD_GEOCODE_URL")

FLORESTI_CENTER = (47.89286, 28.29854)
MAX_DISTANCE_METERS = 4000


def normalize(value):
    value = str(value or "").strip().lower()
    value = value.replace("ș", "s").replace("ş", "s")
    value = value.replace("ț", "t").replace("ţ", "t")
    return re.sub(r"[^\w]+", "", value)


def distance_meters(lat1, lon1, lat2, lon2):
    radius = 6371000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1))
        * cos(radians(lat2))
        * sin(dlon / 2) ** 2
    )
    return radius * 2 * atan2(sqrt(a), sqrt(1 - a))


def extract_coordinates(data):
    if isinstance(data, dict):
        pairs = (
            ("lat", "lon"),
            ("lat", "lng"),
            ("latitude", "longitude"),
        )

        for lat_key, lon_key in pairs:
            lat = data.get(lat_key)
            lon = data.get(lon_key)

            if lat is not None and lon is not None:
                try:
                    return float(lat), float(lon)
                except (TypeError, ValueError):
                    pass

        for key in ("result", "data", "geometry", "location", "center"):
            found = extract_coordinates(data.get(key))
            if found:
                return found

    if isinstance(data, list):
        for item in data:
            found = extract_coordinates(item)
            if found:
                return found

    return None


async def nominatim_geocode(street, building):
    query = f"{street} {building}, Florești, Moldova"

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(
            "https://nominatim.openstreetmap.org/search",
            params={
                "q": query,
                "format": "json",
                "addressdetails": 1,
                "countrycodes": "md",
                "limit": 5,
            },
            headers={"User-Agent": "Navigator-MD/1.0"},
        )
        response.raise_for_status()
        return response.json()


@api_router.get("/map_style")
async def map_style():
    return {
        "version": 8,
        "name": "osm-style",
        "sources": {
            "osm": {
                "type": "raster",
                "tiles": [
                    "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                ],
                "tileSize": 256,
                "attribution": "© OpenStreetMap contributors",
            }
        },
        "layers": [
            {
                "id": "osm-tiles",
                "type": "raster",
                "source": "osm",
                "minzoom": 0,
                "maxzoom": 19,
            }
        ],
    }


@api_router.get("/search")
async def search(
    q: str = Query(..., min_length=2),
    location: str = "Florești",
    lang: str = "ro",
):
    if normalize(location) != "floresti":
        raise HTTPException(
            status_code=400,
            detail="Only Florești is supported",
        )

    if MAPMD_SEARCH_URL:
        headers = {}
        if MAPMD_API_KEY:
            headers["Authorization"] = f"Bearer {MAPMD_API_KEY}"

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(
                    MAPMD_SEARCH_URL,
                    params={
                        "q": q,
                        "location": location,
                        "lang": lang,
                    },
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail="Street search unavailable",
            ) from exc

        items = (
            data
            if isinstance(data, list)
            else data.get("results", [])
        )
    else:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={
                        "q": f"{q}, Florești, Moldova",
                        "format": "json",
                        "addressdetails": 1,
                        "countrycodes": "md",
                        "limit": 20,
                    },
                    headers={"User-Agent": "Navigator-MD/1.0"},
                )
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail="Street search unavailable",
            ) from exc

        items = []

        for item in data:
            address = item.get("address") or {}
            locality = (
                address.get("city")
                or address.get("town")
                or address.get("village")
                or address.get("municipality")
            )

            if normalize(locality) != "floresti":
                continue

            items.append(
                {
                    "id": str(
                        item.get("osm_id")
                        or item.get("place_id")
                    ),
                    "name": (
                        item.get("name")
                        or item.get("display_name")
                        or q
                    ),
                    "parent_name": "Florești",
                    "type": "street",
                    "count": 0,
                    "buildings": [],
                }
            )

    results = []

    for item in items:
        if item.get("type") not in (None, "street"):
            continue

        parent = (
            item.get("parent_name")
            or item.get("city")
            or item.get("locality")
        )

        if parent and normalize(parent) != "floresti":
            continue

        item["parent_name"] = "Florești"
        item["type"] = "street"
        item.setdefault("buildings", [])
        results.append(item)

    return {"results": results}


@api_router.get("/geocode")
async def geocode(
    street: str,
    building: str,
    city: str = "Florești",
):
    if normalize(city) != "floresti":
        raise HTTPException(
            status_code=400,
            detail="Only Florești addresses are supported",
        )

    coordinates = None

    if MAPMD_GEOCODE_URL:
        headers = {}

        if MAPMD_API_KEY:
            headers["Authorization"] = f"Bearer {MAPMD_API_KEY}"

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(
                    MAPMD_GEOCODE_URL,
                    params={
                        "street": street,
                        "building": building,
                        "city": city,
                        "lang": "ro",
                    },
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()

            coordinates = extract_coordinates(data)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail="Geocoding unavailable",
            ) from exc
    else:
        try:
            data = await nominatim_geocode(street, building)

            for item in data:
                try:
                    lat = float(item["lat"])
                    lon = float(item["lon"])
                    coordinates = (lat, lon)
                    break
                except (KeyError, TypeError, ValueError):
                    continue
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502,
                detail="Geocoding unavailable",
            ) from exc

    if not coordinates:
        raise HTTPException(
            status_code=404,
            detail="Exact address not found",
        )

    lat, lon = coordinates

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(
            status_code=404,
            detail="Invalid geocoding result",
        )

    if distance_meters(
        lat,
        lon,
        *FLORESTI_CENTER,
    ) > MAX_DISTANCE_METERS:
        raise HTTPException(
            status_code=404,
            detail="Address is outside Florești",
        )

    return {
        "lat": lat,
        "lon": lon,
        "street": street,
        "building": building,
        "city": "Florești",
    }


app.include_router(api_router)
