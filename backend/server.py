import logging
import os
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from math import atan2, cos, radians, sin, sqrt
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("navigator_md")

app = FastAPI(title="Navigator MD Backend", version="0.5.0")
api_router = APIRouter(prefix="/api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAPMD_API_KEY = os.getenv("MAPMD_API_KEY", "").strip()
MAPMD_SEARCH_URL = "https://map.md/api/companies/webmap/search_street"
PHOTON_URL = "https://photon.komoot.io/api/"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSRM_BASE_URL = "https://router.project-osrm.org"
FLORESTI_CENTER = (47.89286, 28.29854)
MAX_FLORESTI_DISTANCE_METERS = 4000

STREET_NAME_MAPPING = {
    "Strada 9 Mai": "str. 9 Mai",
    "Strada Alexandru Donnici": "str. Alexandru Donnici",
    "Strada Constantin Stamati": "str. Constantin Stamati",
    "Strada Boris Glavan": "str. Boris Glavan",
    "Strada Libertății": "str. Libertății",
}
STREET_REVERSE_MAPPING = {value: key for key, value in STREET_NAME_MAPPING.items()}
# Partial-search fallback for Florești streets; provider results are merged with this list.
FLORESTI_STREETS = [
    "Strada 1 Mai",
    "Strada Mihai Viteazul",
    "Strada 9 Mai",
    "Strada Alexandru Donnici",
    "Strada Constantin Stamati",
    "Strada Boris Glavan",
    "Strada Libertății",
    "Strada Crinilor",
    "Strada Decebal",
]
geocode_cache: dict[str, dict[str, Any]] = {}
search_history: list[dict[str, Any]] = []

MONGO_URL = os.getenv("MONGO_URL", "").strip()
DB_NAME = os.getenv("DB_NAME", "navigator_md")
mongo_client = None
mongo_collection = None
if MONGO_URL:
    try:
        from motor.motor_asyncio import AsyncIOMotorClient

        mongo_client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=3000)
        mongo_collection = mongo_client[DB_NAME]["searches"]
    except Exception:
        logger.exception("MongoDB init failed; search history will be in memory")


class RouteRequest(BaseModel):
    from_lat: float = Field(ge=-90, le=90)
    from_lon: float = Field(ge=-180, le=180)
    to_lat: float = Field(ge=-90, le=90)
    to_lon: float = Field(ge=-180, le=180)
    profile: str = "driving"


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "", text.lower().replace("ş", "s").replace("ţ", "t"))


def normalize_street(value: Any) -> str:
    text = normalize(value)
    for prefix in ("strada", "str", "street", "ulita", "ul"):
        if text.startswith(prefix):
            return text[len(prefix):]
    return text


def distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return radius * 2 * atan2(sqrt(a), sqrt(1 - a))


def in_floresti(lat: float, lon: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lon <= 180 and distance_meters(lat, lon, *FLORESTI_CENTER) <= MAX_FLORESTI_DISTANCE_METERS


def photon_coordinates(feature: dict[str, Any], street: str, building: str) -> tuple[float, float] | None:
    props = feature.get("properties") or {}
    number = str(props.get("housenumber") or props.get("house_number") or "").strip()
    name = str(props.get("name") or "")
    # Do not accept a road/street centroid. Require the exact house number.
    if normalize(number) != normalize(building):
        if not re.search(rf"(?<![a-z0-9]){re.escape(building)}(?![a-z0-9])", name, re.I):
            return None

    actual_street = str(props.get("street") or props.get("road") or "")
    if not actual_street or normalize_street(actual_street) != normalize_street(street):
        return None

    locality = str(props.get("city") or props.get("town") or props.get("village") or props.get("municipality") or "")
    if locality and normalize(locality) != "floresti":
        return None

    coords = (feature.get("geometry") or {}).get("coordinates")
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    try:
        lon, lat = float(coords[0]), float(coords[1])
    except (TypeError, ValueError):
        return None
    return (lat, lon) if in_floresti(lat, lon) else None


def nominatim_coordinates(item: dict[str, Any], street: str, building: str) -> tuple[float, float] | None:
    address = item.get("address") or {}
    number = str(address.get("house_number") or address.get("building") or "").strip()
    actual_street = str(address.get("road") or address.get("pedestrian") or address.get("residential") or address.get("street") or "")
    locality = str(address.get("city") or address.get("town") or address.get("village") or address.get("municipality") or "")
    if normalize(number) != normalize(building) or normalize_street(actual_street) != normalize_street(street):
        return None
    if locality and normalize(locality) != "floresti":
        return None
    try:
        lat, lon = float(item["lat"]), float(item["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    return (lat, lon) if in_floresti(lat, lon) else None


async def mapmd_search(query: str, location: str, lang: str) -> list[dict[str, Any]]:
    if not MAPMD_API_KEY:
        return []
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(MAPMD_SEARCH_URL, params={"q": query, "location": location, "lang": lang}, auth=(MAPMD_API_KEY, ""))
            response.raise_for_status()
            data = response.json()
        if isinstance(data, dict):
            data = data.get("results", data.get("data", []))
        return data if isinstance(data, list) else []
    except (httpx.HTTPError, ValueError):
        logger.exception("map.md street search failed")
        return []


@api_router.get("/")
async def root():
    return {"message": "Navigator MD API", "status": "ok"}


@api_router.get("/map_style")
async def map_style():
    return {
        "version": 8,
        "name": "osm-style",
        "sources": {"osm": {"type": "raster", "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], "tileSize": 256, "attribution": "© OpenStreetMap contributors"}},
        "layers": [{"id": "osm-tiles", "type": "raster", "source": "osm", "minzoom": 0, "maxzoom": 19}],
    }


@api_router.get("/search")
async def search(q: str = Query(..., min_length=2), location: str = Query("Florești"), lang: str = Query("ro")):
    if normalize(location) != "floresti":
        raise HTTPException(status_code=400, detail="Only Florești is supported")

    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in await mapmd_search(q, location, lang):
        if not isinstance(item, dict) or item.get("type") not in (None, "street"):
            continue
        parent = item.get("parent_name") or item.get("city") or item.get("locality")
        if parent and normalize(parent) != "floresti":
            continue
        api_name = str(item.get("name") or "").strip()
        if not api_name:
            continue
        name = STREET_REVERSE_MAPPING.get(api_name, api_name)
        key = normalize_street(name)
        if key in seen:
            continue
        result = dict(item)
        result.update({"name": name, "parent_name": "Florești", "type": "street"})
        result.setdefault("buildings", [])
        result["count"] = len(result["buildings"]) if isinstance(result["buildings"], list) else 0
        results.append(result)
        seen.add(key)

    query = normalize_street(q)
    for name in FLORESTI_STREETS:
        if query and query in normalize_street(name):
            key = normalize_street(name)
            if key not in seen:
                results.append({"id": f"floresti-{key}", "name": name, "parent_name": "Florești", "type": "street", "count": 0, "buildings": []})
                seen.add(key)
    return {"results": results, "priority_city": "Florești"}


@api_router.get("/buildings")
async def get_buildings(street_name: str = Query(...), city: str = Query("Florești"), lang: str = Query("ro")):
    if normalize(city) != "floresti":
        raise HTTPException(status_code=400, detail="Only Florești is supported")
    items = await mapmd_search(STREET_NAME_MAPPING.get(street_name, street_name), city, lang)
    wanted = normalize_street(street_name)
    for item in items:
        if isinstance(item, dict) and item.get("type") == "street" and normalize_street(item.get("name")) == wanted:
            parent = item.get("parent_name") or item.get("city") or item.get("locality")
            buildings = item.get("buildings", [])
            if normalize(parent) == "floresti" and isinstance(buildings, list):
                return {"buildings": buildings}
    return {"buildings": []}


@api_router.get("/geocode")
async def geocode(street: str = Query(..., min_length=1), building: str = Query(..., min_length=1), city: str = Query("Florești")):
    if normalize(city) != "floresti":
        raise HTTPException(status_code=400, detail="Only Florești addresses are supported")

    api_street = STREET_NAME_MAPPING.get(street, street).strip()
    key = normalize(f"{api_street}|{building}|{city}")
    if key in geocode_cache:
        return geocode_cache[key]

    street_variants = list(dict.fromkeys((api_street, api_street.replace("str. ", "Strada "), api_street.replace("Strada ", "str. "))))
    queries = [f"{building} {variant}, Florești, Moldova" for variant in street_variants]

    # Photon first, with common Romanian street-name variants.
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            for query in queries:
                response = await client.get(PHOTON_URL, params={"q": query, "limit": 10, "lang": "ro"})
                response.raise_for_status()
                data = response.json()
                for feature in data.get("features", []):
                    if not isinstance(feature, dict):
                        continue
                    coords = photon_coordinates(feature, api_street, building)
                    if coords:
                        lat, lon = coords
                        result = {"lat": lat, "lon": lon, "street": street, "building": building, "city": "Florești"}
                        geocode_cache[key] = result
                        return result
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Photon geocoding failed: %s", exc)

    # Nominatim is a fallback and may return 429/629. Never substitute a street center.
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            for query in queries[:1]:
                response = await client.get(
                    NOMINATIM_URL,
                    params={"q": query, "format": "jsonv2", "addressdetails": 1, "countrycodes": "md", "limit": 10, "accept-language": "ro"},
                    headers={"User-Agent": "Navigator-MD/1.0 (address lookup)"},
                )
                if response.status_code in (429, 629):
                    raise HTTPException(status_code=503, detail="Geocoding provider temporarily busy; try again shortly")
                response.raise_for_status()
                candidates = response.json()
                if isinstance(candidates, list):
                    for item in candidates:
                        if not isinstance(item, dict):
                            continue
                        coords = nominatim_coordinates(item, api_street, building)
                        if coords:
                            lat, lon = coords
                            result = {"lat": lat, "lon": lon, "street": street, "building": building, "city": "Florești"}
                            geocode_cache[key] = result
                            return result
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        logger.warning("Nominatim returned HTTP %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Geocoding provider failed") from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Nominatim geocoding unavailable: %s", exc)
        raise HTTPException(status_code=502, detail="Geocoding provider unavailable") from exc

    raise HTTPException(status_code=404, detail="Exact house address not found in Florești")


def build_instruction(step: dict[str, Any]) -> str:
    maneuver = step.get("maneuver") or {}
    kind = maneuver.get("type", "")
    modifier = maneuver.get("modifier", "")
    name = step.get("name", "")
    directions = {"left": "налево", "right": "направо", "sharp left": "резко налево", "sharp right": "резко направо", "slight left": "слегка налево", "slight right": "слегка направо", "straight": "прямо", "uturn": "разворот"}
    direction = directions.get(modifier, modifier)
    if kind == "depart":
        return f"Начните движение по {name}" if name else "Начните движение"
    if kind == "arrive":
        return "Вы прибыли в пункт назначения"
    if kind == "turn":
        return f"Поверните {direction} на {name}" if name else f"Поверните {direction}"
    if kind == "roundabout" or kind == "rotary":
        exit_number = maneuver.get("exit", 1)
        return f"На круговом движении {exit_number}-й съезд на {name}" if name else f"На кругу {exit_number}-й съезд"
    if kind == "continue":
        return f"Продолжайте {direction} по {name}" if name else f"Продолжайте {direction}"
    return f"Двигайтесь по {name}" if name else "Продолжайте движение"


@api_router.post("/route")
async def get_route(req: RouteRequest):
    profiles = {"driving": "driving", "car": "driving", "walking": "walking", "foot": "walking", "cycling": "cycling"}
    profile = profiles.get(req.profile.lower(), "driving")
    coords = f"{req.from_lon},{req.from_lat};{req.to_lon},{req.to_lat}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(f"{OSRM_BASE_URL}/route/v1/{profile}/{coords}", params={"steps": "true", "geometries": "geojson", "overview": "full", "annotations": "true"})
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        logger.exception("OSRM route request failed")
        raise HTTPException(status_code=502, detail="Routing provider unavailable") from exc
    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(status_code=404, detail="No route found")
    route = data["routes"][0]
    steps = []
    for leg in route.get("legs", []):
        for step in leg.get("steps", []):
            maneuver = step.get("maneuver") or {}
            steps.append({"distance": step.get("distance", 0), "duration": step.get("duration", 0), "name": step.get("name", ""), "instruction": build_instruction(step), "type": maneuver.get("type"), "modifier": maneuver.get("modifier"), "location": maneuver.get("location"), "geometry": step.get("geometry")})
    return {"distance": route.get("distance", 0), "duration": route.get("duration", 0), "geometry": route.get("geometry"), "steps": steps}


@api_router.post("/search/save")
async def save_search(query: str = Query(..., min_length=1)):
    query = query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    record = {"id": str(uuid.uuid4()), "query": query, "timestamp": datetime.now(timezone.utc)}
    if mongo_collection is not None:
        try:
            await mongo_collection.insert_one(record.copy())
        except Exception:
            logger.exception("MongoDB save failed; retained in memory")
    search_history.insert(0, record)
    del search_history[100:]
    return {"message": "Search saved", "id": record["id"]}


@api_router.get("/search/history")
async def get_search_history(limit: int = Query(20, ge=1, le=100)):
    if mongo_collection is not None:
        try:
            cursor = mongo_collection.find({}, {"_id": 0}).sort("timestamp", -1).limit(limit)
            history = []
            async for record in cursor:
                stamp = record.get("timestamp")
                history.append({"id": record.get("id"), "query": record.get("query"), "timestamp": stamp.isoformat() if hasattr(stamp, "isoformat") else stamp})
            return {"history": history}
        except Exception:
            logger.exception("MongoDB history read failed; using memory")
    return {"history": [{"id": record["id"], "query": record["query"], "timestamp": record["timestamp"].isoformat()} for record in search_history[:limit]]}


@api_router.delete("/search/history/{search_id}")
async def delete_search(search_id: str):
    deleted = False
    if mongo_collection is not None:
        try:
            result = await mongo_collection.delete_one({"id": search_id})
            deleted = result.deleted_count > 0
        except Exception:
            logger.exception("MongoDB history delete failed")
    old_size = len(search_history)
    search_history[:] = [record for record in search_history if record["id"] != search_id]
    deleted = deleted or len(search_history) < old_size
    if not deleted:
        raise HTTPException(status_code=404, detail="Search not found")
    return {"message": "Search deleted"}


app.include_router(api_router)
