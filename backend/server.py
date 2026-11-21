import os
import re
import uuid
import logging
import unicodedata
from datetime import datetime, timezone
from math import atan2, cos, radians, sin, sqrt
from typing import Any

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("navigator_md")

app = FastAPI(title="Navigator MD Backend", version="0.3.0")
api_router = APIRouter(prefix="/api")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

MAPMD_API_KEY = os.getenv("MAPMD_API_KEY", "").strip()
MAPMD_SEARCH_URL = "https://map.md/api/companies/webmap/search_street"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
PHOTON_URL = "https://photon.komoot.io/api/"
OSRM_BASE_URL = "https://router.project-osrm.org"
FLORESTI_CENTER = (47.89286, 28.29854)
MAX_FLORESTI_DISTANCE_METERS = 4000
geocode_cache: dict[str, dict[str, Any]] = {}

STREET_NAME_MAPPING = {
    "Strada 9 Mai": "str. 9 Mai",
    "Strada Alexandru Donnici": "str. Alexandru Donnici",
    "Strada Constantin Stamati": "str. Constantin Stamati",
    "Strada Boris Glavan": "str. Boris Glavan",
    "Strada Libertății": "str. Libertății",
}
STREET_REVERSE_MAPPING = {value: key for key, value in STREET_NAME_MAPPING.items()}

MONGO_URL = os.getenv("MONGO_URL", "").strip()
DB_NAME = os.getenv("DB_NAME", "navigator_md")
mongo_collection = None
mongo_client = None
search_history: list[dict[str, Any]] = []

if MONGO_URL:
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo_client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=3000)
        mongo_collection = mongo_client[DB_NAME]["searches"]
    except Exception:
        logger.exception("MongoDB initialization failed; using in-memory search history")


class RouteRequest(BaseModel):
    from_lat: float = Field(ge=-90, le=90)
    from_lon: float = Field(ge=-180, le=180)
    to_lat: float = Field(ge=-90, le=90)
    to_lon: float = Field(ge=-180, le=180)
    profile: str = "driving"


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower().replace("ş", "s").replace("ţ", "t")
    return re.sub(r"[^a-z0-9]+", "", text)


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


def exact_photon_match(item: dict[str, Any], street: str, building: str) -> bool:
    properties = item.get("properties") or {}
    house_number = str(properties.get("housenumber") or properties.get("house_number") or "").strip()
    name = str(properties.get("name") or "")
    if normalize(house_number) != normalize(building):
        if normalize(building) not in normalize(name):
            return False

    actual_street = str(properties.get("street") or properties.get("road") or name)
    if normalize_street(actual_street) != normalize_street(street):
        return False

    locality = str(properties.get("city") or properties.get("town") or properties.get("village") or properties.get("municipality") or "")
    if locality and normalize(locality) != "floresti":
        return False

    geometry = item.get("geometry") or {}
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        return False
    try:
        lon = float(coordinates[0])
        lat = float(coordinates[1])
    except (TypeError, ValueError):
        return False
    return distance_meters(lat, lon, *FLORESTI_CENTER) <= MAX_FLORESTI_DISTANCE_METERS


def exact_nominatim_match(item: dict[str, Any], street: str, building: str, city: str) -> bool:
    address = item.get("address") or {}
    house_number = str(address.get("house_number") or address.get("building") or "").strip()
    if normalize(house_number) != normalize(building):
        return False

    actual_street = str(address.get("road") or address.get("pedestrian") or address.get("residential") or address.get("street") or "")
    if normalize_street(actual_street) != normalize_street(street):
        return False

    locality = str(address.get("city") or address.get("town") or address.get("village") or address.get("municipality") or "")
    if locality and normalize(locality) != normalize(city):
        return False

    try:
        lat = float(item["lat"])
        lon = float(item["lon"])
    except (KeyError, TypeError, ValueError):
        return False
    return distance_meters(lat, lon, *FLORESTI_CENTER) <= MAX_FLORESTI_DISTANCE_METERS


async def mapmd_search(query: str, location: str, lang: str) -> list[dict[str, Any]]:
    if not MAPMD_API_KEY:
        raise HTTPException(status_code=503, detail="MAPMD_API_KEY is not configured")
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(MAPMD_SEARCH_URL, params={"q": query, "location": location, "lang": lang}, auth=(MAPMD_API_KEY, ""))
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning("map.md search returned HTTP %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Street search provider failed") from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("map.md search request failed")
        raise HTTPException(status_code=502, detail="Street search provider unavailable") from exc
    if isinstance(data, dict):
        data = data.get("results", data.get("data", []))
    return data if isinstance(data, list) else []


@api_router.get("/")
async def root():
    return {"message": "Navigator MD API", "status": "ok"}


@api_router.get("/map_style")
async def map_style():
    return {"version": 8, "name": "osm-style", "sources": {"osm": {"type": "raster", "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], "tileSize": 256, "attribution": "© OpenStreetMap contributors"}}, "layers": [{"id": "osm-tiles", "type": "raster", "source": "osm", "minzoom": 0, "maxzoom": 19}]}


@api_router.get("/search")
async def search(q: str = Query(..., min_length=2), location: str = Query("Florești"), lang: str = Query("ro")):
    if normalize(location) != "floresti":
        raise HTTPException(status_code=400, detail="Only Florești is supported")
    items = await mapmd_search(q, location, lang)
    results = []
    for original in items:
        if not isinstance(original, dict) or original.get("type") != "street":
            continue
        parent = original.get("parent_name") or original.get("city") or original.get("locality")
        if normalize(parent) != "floresti":
            continue
        item = dict(original)
        api_name = str(item.get("name") or "")
        item["name"] = STREET_REVERSE_MAPPING.get(api_name, api_name)
        item["parent_name"] = "Florești"
        item.setdefault("buildings", [])
        item["count"] = len(item["buildings"])
        results.append(item)
    return {"results": results, "priority_city": "Florești"}


@api_router.get("/buildings")
async def get_buildings(street_name: str = Query(...), city: str = Query("Florești"), lang: str = Query("ro")):
    if normalize(city) != "floresti":
        raise HTTPException(status_code=400, detail="Only Florești is supported")
    api_name = STREET_NAME_MAPPING.get(street_name, street_name)
    items = await mapmd_search(api_name, city, lang)
    wanted = normalize_street(street_name)
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "street":
            continue
        parent = item.get("parent_name") or item.get("city") or item.get("locality")
        if normalize(parent) == "floresti" and normalize_street(item.get("name")) == wanted:
            buildings = item.get("buildings", [])
            return {"buildings": buildings if isinstance(buildings, list) else []}
    return {"buildings": []}


@api_router.get("/geocode")
async def geocode(street: str = Query(..., min_length=1), building: str = Query(..., min_length=1), city: str = Query("Florești")):
    if normalize(city) != "floresti":
        raise HTTPException(status_code=400, detail="Only Florești addresses are supported")

    api_street = STREET_NAME_MAPPING.get(street, street)
    cache_key = normalize(f"{api_street}|{building}|{city}")
    if cache_key in geocode_cache:
        return geocode_cache[cache_key]

    query = f"{building} {api_street}, Florești, Moldova"

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(PHOTON_URL, params={"q": query, "limit": 10, "lang": "ro"})
            response.raise_for_status()
            photon_data = response.json()
        for feature in photon_data.get("features", []):
            if not isinstance(feature, dict) or not exact_photon_match(feature, api_street, building):
                continue
            coordinates = (feature.get("geometry") or {}).get("coordinates") or []
            if len(coordinates) >= 2:
                result = {"lat": float(coordinates[1]), "lon": float(coordinates[0]), "street": street, "building": building, "city": "Florești"}
                geocode_cache[cache_key] = result
                return result
    except httpx.HTTPStatusError as exc:
        logger.warning("Photon returned HTTP %s", exc.response.status_code)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        logger.exception("Photon geocoding request failed")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(NOMINATIM_URL, params={"q": query, "format": "jsonv2", "addressdetails": 1, "countrycodes": "md", "limit": 10, "accept-language": "ro"}, headers={"User-Agent": "Navigator-MD/1.0 (address lookup)"})
            if response.status_code in (429, 629):
                logger.warning("Nominatim rate-limited this request")
                raise HTTPException(status_code=503, detail="Geocoding provider temporarily busy")
            response.raise_for_status()
            candidates = response.json()
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        logger.warning("Nominatim returned HTTP %s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Geocoding provider failed") from exc
    except (httpx.HTTPError, ValueError) as exc:
        logger.exception("Nominatim geocoding request failed")
        raise HTTPException(status_code=502, detail="Geocoding provider unavailable") from exc

    if not isinstance(candidates, list):
        candidates = []
    match = next((item for item in candidates if isinstance(item, dict) and exact_nominatim_match(item, api_street, building, city)), None)
    if not match:
        raise HTTPException(status_code=404, detail="Exact house address not found in Florești")

    try:
        lat = float(match["lat"])
        lon = float(match["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Address has no valid coordinates") from exc
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=404, detail="Address has invalid coordinates")
    if distance_meters(lat, lon, *FLORESTI_CENTER) > MAX_FLORESTI_DISTANCE_METERS:
        raise HTTPException(status_code=404, detail="Address is outside Florești")

    result = {"lat": lat, "lon": lon, "street": street, "building": building, "city": "Florești"}
    geocode_cache[cache_key] = result
    return result


def build_instruction(step: dict[str, Any]) -> str:
    maneuver = step.get("maneuver") or {}
    maneuver_type = maneuver.get("type", "")
    modifier = maneuver.get("modifier", "")
    name = step.get("name", "")
    directions = {"left": "налево", "right": "направо", "sharp left": "резко налево", "sharp right": "резко направо", "slight left": "слегка налево", "slight right": "слегка направо", "straight": "прямо", "uturn": "разворот"}
    direction = directions.get(modifier, modifier)
    if maneuver_type == "depart":
        return f"Начните движение по {name}" if name else "Начните движение"
    if maneuver_type == "arrive":
        return "Вы прибыли в пункт назначения"
    if maneuver_type == "turn":
        return f"Поверните {direction} на {name}" if name else f"Поверните {direction}"
    if maneuver_type == "new name":
        return f"Продолжайте движение по {name}"
    if maneuver_type in ("roundabout", "rotary"):
        exit_number = maneuver.get("exit", 1)
        return f"На круговом движении {exit_number}-й съезд на {name}" if name else f"На кругу {exit_number}-й съезд"
    if maneuver_type == "continue":
        return f"Продолжайте {direction} по {name}" if name else f"Продолжайте {direction}"
    if maneuver_type in ("merge", "fork", "end of road"):
        return f"Двигайтесь {direction} по {name}" if name else f"Двигайтесь {direction}"
    return f"Двигайтесь по {name}" if name else "Продолжайте движение"


@api_router.post("/route")
async def get_route(req: RouteRequest):
    profile_map = {"driving": "driving", "car": "driving", "walking": "walking", "foot": "walking", "cycling": "cycling"}
    profile = profile_map.get(req.profile.lower(), "driving")
    coordinates = f"{req.from_lon},{req.from_lat};{req.to_lon},{req.to_lat}"
    url = f"{OSRM_BASE_URL}/route/v1/{profile}/{coordinates}"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params={"steps": "true", "geometries": "geojson", "overview": "full", "annotations": "true"})
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
    normalized_query = query.strip()
    if not normalized_query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    record = {"id": str(uuid.uuid4()), "query": normalized_query, "timestamp": datetime.now(timezone.utc)}
    if mongo_collection is not None:
        try:
            await mongo_collection.insert_one(record.copy())
        except Exception:
            logger.exception("Could not save search to MongoDB; keeping it in memory")
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
                timestamp = record.get("timestamp")
                history.append({"id": record.get("id"), "query": record.get("query"), "timestamp": timestamp.isoformat() if hasattr(timestamp, "isoformat") else timestamp})
            return {"history": history}
        except Exception:
            logger.exception("Could not read MongoDB search history; using in-memory history")
    return {"history": [{"id": record["id"], "query": record["query"], "timestamp": record["timestamp"].isoformat()} for record in search_history[:limit]]}


@api_router.delete("/search/history/{search_id}")
async def delete_search(search_id: str):
    deleted = False
    if mongo_collection is not None:
        try:
            result = await mongo_collection.delete_one({"id": search_id})
            deleted = result.deleted_count > 0
        except Exception:
            logger.exception("Could not delete search from MongoDB")
    old_length = len(search_history)
    search_history[:] = [record for record in search_history if record["id"] != search_id]
    deleted = deleted or len(search_history) < old_length
    if not deleted:
        raise HTTPException(status_code=404, detail="Search not found")
    return {"message": "Search deleted"}


app.include_router(api_router)
