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


def normalize(value: str) -> str:
    value = str(value or "").strip().lower()
    value = value.replace("ș", "s").replace("ş", "s").replace("ț", "t").replace("ţ", "t")
    value = re.sub(r"[^\w]+", "", value)
    return value


def distance_meters(lat1, lon1, lat2, lon2):
    radius = 6371000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    )
    return radius * 2 * atan2(sqrt(a), sqrt(1 - a))


def extract_coordinates(data):
    if isinstance(data, dict):
        for lat_key, lon_key in (
            ("lat", "lon"),
            ("lat", "lng"),
            ("latitude", "longitude"),
        ):
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


async def geocode_with_nominatim(street: str, building: str):
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
                "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                "tileSize": 256,
                "attribution": "© OpenStreetMap contributors",
            }
        },
        "layers": [
            {
                "id": "](#)***

