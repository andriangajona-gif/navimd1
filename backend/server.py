from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict, Iterable, Set
import uuid
from datetime import datetime
import re

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ.get('MONGO_URL')
DB_NAME = os.environ.get('DB_NAME', 'test_database')
MAPMD_API_KEY = os.environ.get('MAPMD_API_KEY', '040c1d37-142e-4f81-adfb-c6f7a7dce753')
MAPMD_BASE = 'https://map.md/api/companies/webmap'
OSRM_BASE = 'https://router.project-osrm.org'

client = AsyncIOMotorClient(MONGO_URL) if MONGO_URL else None
db = client[DB_NAME] if client else None
searches_collection = db.searches if db else None

app = FastAPI(title='Navigator MD API')
api_router = APIRouter(prefix='/api')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

http_client: Optional[httpx.AsyncClient] = None

# Street name mappings for API responses
STREET_NAME_MAPPING = {
    'Strada 9 Mai': 'str. 9 Mai',
    'Strada Alexandru Donnici': 'str. Alexandru Donnici',
    'Strada Constantin Stamati': 'str. Constantin Stamati',
    'Strada Boris Glavan': 'str. Boris Glavan',
    'Strada Libertății': 'str. Libertății',
}

# Reverse mapping for API responses
STREET_REVERSE_MAPPING = {v: k for k, v in STREET_NAME_MAPPING.items()}


def normalize_street_name(name: str) -> str:
    """Normalize street name for comparison (handles both formats)"""
    if not name:
        return ''
    # Try reverse mapping first (API format to display format)
    if name in STREET_REVERSE_MAPPING:
        name = STREET_REVERSE_MAPPING[name]
    # Try forward mapping (display format to API format)
    if name in STREET_NAME_MAPPING:
        name = STREET_NAME_MAPPING[name]
    return name.lower().strip()


def _normalize_token(value: Any) -> str:
    if value is None:
        return ''
    text = str(value).strip().lower()
    text = text.replace('ș', 's').replace('ţ', 't').replace('ă', 'a').replace('â', 'a').replace('î', 'i').replace('û', 'u')
    text = re.sub(r'[^a-z0-9/\- ]+', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def _street_variants(street: str) -> List[str]:
    if not street:
        return []
    raw = str(street).strip()
    variants = []
    seen: Set[str] = set()
    candidates = [raw, raw.replace('str. ', 'Strada '), raw.replace('Strada ', 'str. ')]
    for c in candidates:
        c = c.strip()
        if c and c.lower() not in seen:
            variants.append(c)
            seen.add(c.lower())
    return variants


def _candidate_house_numbers(building: Any) -> List[str]:
    raw = str(building or '').strip()
    if not raw:
        return []
    cleaned = raw.replace('№', '').replace('#', '').strip()
    if not cleaned:
        return []
    tokens = []
    for part in re.split(r'\s*[,;/\\]\s*', cleaned):
        part = part.strip()
        if part:
            tokens.append(part)
    if not tokens:
        tokens = [cleaned]
    return [t for t in tokens if t]


def _result_matches_exactly(item: Dict[str, Any], street: str, building: Any, city: str) -> bool:
    if not isinstance(item, dict):
        return False

    display_name = (item.get('display_name') or '').lower()
    address = item.get('address') or {}
    house_number = str(address.get('house_number') or address.get('building') or '').strip()
    normalized_building = _normalize_token(building)
    normalized_house = _normalize_token(house_number)
    normalized_city = _normalize_token(city)
    normalized_street = _normalize_token(street)

    if normalized_building and normalized_house and normalized_building != normalized_house:
        # This is a strong mismatch signal; reject it early.
        return False

    street_variants = [_normalize_token(v) for v in _street_variants(street)]
    street_present = any(v and v in display_name for v in street_variants)
    city_present = bool(normalized_city and normalized_city in display_name)
    return street_present and city_present


def _score_nominatim_result(item: Dict[str, Any], street: str, building: Any, city: str) -> int:
    if not isinstance(item, dict):
        return -999

    display_name = (item.get('display_name') or '').lower()
    address = item.get('address') or {}
    house_number = str(address.get('house_number') or address.get('building') or '').strip()
    normalized_building = _normalize_token(building)
    normalized_house = _normalize_token(house_number)
    city_norm = _normalize_token(city)
    street_norm = _normalize_token(street)
    score = 0

    if not street_norm:
        return -999

    if any(_normalize_token(v) and _normalize_token(v) in display_name for v in _street_variants(street)):
        score += 35

    if city_norm and city_norm in display_name:
        score += 20
    elif 'moldova' in display_name:
        score += 10

    if 'moldova' in display_name:
        score += 5

    if normalized_building and normalized_house:
        if normalized_building == normalized_house:
            score += 45
        else:
            # reject wrong house numbers strongly
            score -= 80

    elif normalized_building:
        # If there is no house number in OSM but the display name still contains the exact number,
        # count it as a weak match.
        if normalized_building in display_name:
            score += 20

    # slightly prefer exact address context over generic road matches
    if 'road' in display_name or 'strada' in display_name or 'street' in display_name:
        score += 5

    return score


@api_router.get('/')
async def root():
    return {'message': 'Navigator MD API', 'status': 'ok'}


@api_router.get('/search')
async def search(
    q: str = Query(..., min_length=1),
    location: str = Query('Florești'),
    lang: str = Query('ro'),
):
    url = f'{MAPMD_BASE}/search_street'
    # Normalize query to API format
    query_normalized = normalize_street_name(q)
    params = {'q': q, 'location': location, 'lang': lang}
    auth = (MAPMD_API_KEY, '')
    try:
        r = await http_client.get(url, params=params, auth=auth)
        if r.status_code != 200:
            logger.warning(f'search_street status={r.status_code} body={r.text[:200]}')
            return JSONResponse(status_code=r.status_code, content={'error': 'upstream', 'detail': r.text[:300]})
        data = r.json()
        if not isinstance(data, list):
            data = []

        # Normalize street names in results
        for item in data:
            if isinstance(item, dict) and item.get('name'):
                api_name = item.get('name')
                if api_name in STREET_REVERSE_MAPPING:
                    item['name'] = STREET_REVERSE_MAPPING[api_name]

        loc_low = location.lower()
        prio = [it for it in data if isinstance(it, dict) and loc_low in (it.get('parent_name') or '').lower()]
        rest = [it for it in data if it not in prio]
        return {'results': prio + rest, 'priority_city': location}
    except Exception as e:
        logger.exception('search error')
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get('/buildings')
async def get_buildings(
    street_name: str = Query(...),
    city: str = Query('Florești'),
    lang: str = Query('ro'),
):
    url = f'{MAPMD_BASE}/search_street'
    # Convert display name to API format for search
    api_street_name = STREET_NAME_MAPPING.get(street_name, street_name)
    params = {'q': api_street_name, 'location': city, 'lang': lang}
    auth = (MAPMD_API_KEY, '')
    try:
        r = await http_client.get(url, params=params, auth=auth)
        if r.status_code != 200:
            logger.warning(f'buildings: status={r.status_code}')
            return {'buildings': []}
        data = r.json()
        if not isinstance(data, list):
            return {'buildings': []}

        # Match using normalized names
        street_normalized = normalize_street_name(street_name)
        for item in data:
            if item.get('type') == 'street':
                item_name_normalized = normalize_street_name(item.get('name', ''))
                if item_name_normalized == street_normalized:
                    buildings = item.get('buildings', [])

                    def building_key(x: str):
                        # normalize building like "12/3" => number 12, fallback to lexical
                        first = x.split('/')[0]
                        try:
                            num = int(first)
                            # numeric group first so numeric values sort before non-numeric
                            return (0, num, x)
                        except Exception:
                            return (1, first.lower(), x)

                    try:
                        buildings.sort(key=building_key)
                    except Exception:
                        # don't break API if sorting fails for unexpected formats
                        logger.exception('Failed to sort buildings list')
                        pass
                    return {'buildings': buildings}
        return {'buildings': []}
    except Exception as e:
        logger.exception('buildings error')
        return {'buildings': []}


@api_router.get('/geocode')
async def geocode(
    street: str = Query(...),
    building: str = Query(...),
    city: str = Query('Florești'),
    lang: str = Query('ro'),
):
    try:
        if not street or not building:
            logger.warning('geocode called without street/building')
            return {'lat': None, 'lon': None}

        api_street = STREET_NAME_MAPPING.get(street, street)
        queries = []
        for variant in _street_variants(api_street):
            queries.append(f'{building} {variant}, {city}, Moldova')
            queries.append(f'{building} {variant}, {city}, Republica Moldova')
            queries.append(f'{variant} {building}, {city}, Moldova')
            queries.append(f'{building} {variant}, {city}')

        # dedupe while preserving order
        deduped_queries = []
        seen_queries = set()
        for q in queries:
            key = q.lower().strip()
            if key and key not in seen_queries:
                seen_queries.add(key)
                deduped_queries.append(q)

        best_match = None
        best_score = -999

        for query in deduped_queries:
            params = {
                'q': query,
                'format': 'json',
                'limit': 5,
                'countrycodes': 'md',
                'addressdetails': 1,
                'accept-language': 'ro',
                'namedetails': 1,
            }
            headers = {'User-Agent': 'NaviMD/1.0'}
            r = await http_client.get('https://nominatim.openstreetmap.org/search', params=params, headers=headers)
            if r.status_code != 200:
                continue
            try:
                data = r.json() or []
            except ValueError:
                continue

            for item in data:
                if not isinstance(item, dict):
                    continue
                score = _score_nominatim_result(item, street, building, city)
                if score > best_score:
                    best_score = score
                    best_match = item

        if best_match and best_score >= 30:
            lat = float(best_match['lat'])
            lon = float(best_match['lon'])
            logger.info(f'geocode exact/near-exact match for {building} {api_street}: lat={lat}, lon={lon}, score={best_score}')
            return {'lat': lat, 'lon': lon}

        # If there are no strong matches, do not accept an arbitrary first result.
        logger.warning(f'geocode no strong match for {building} {api_street}; best_score={best_score}')
        return {'lat': None, 'lon': None}
    except Exception as e:
        logger.exception('geocode error')
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post('/route')
async def get_route(req: RouteRequest):
    profile_map = {'driving': 'driving', 'car': 'driving', 'walking': 'walking', 'foot': 'walking', 'cycling': 'cycling'}
    profile = profile_map.get(req.profile, 'driving')
    coords = f'{req.from_lon},{req.from_lat};{req.to_lon},{req.to_lat}'
    url = f'{OSRM_BASE}/route/v1/{profile}/{coords}'
    params = {
        'steps': 'true',
        'geometries': 'geojson',
        'overview': 'full',
        'annotations': 'true',
    }
    try:
        r = await http_client.get(url, params=params)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f'OSRM error {r.status_code}')
        data = r.json()
        if data.get('code') != 'Ok' or not data.get('routes'):
            raise HTTPException(status_code=404, detail='No route found')
        route = data['routes'][0]
        legs = route.get('legs', [])
        steps = []
        for leg in legs:
            for s in leg.get('steps', []):
                maneuver = s.get('maneuver', {})
                steps.append({
                    'distance': s.get('distance', 0),
                    'duration': s.get('duration', 0),
                    'name': s.get('name', ''),
                    'instruction': build_instruction(s),
                    'type': maneuver.get('type'),
                    'modifier': maneuver.get('modifier'),
                    'location': maneuver.get('location'),
                    'geometry': s.get('geometry'),
                })
        return {
            'distance': route.get('distance', 0),
            'duration': route.get('duration', 0),
            'geometry': route.get('geometry'),
            'steps': steps,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception('route error')
        raise HTTPException(status_code=500, detail=str(e))


def build_instruction(step: Dict[str, Any]) -> str:
    m = step.get('maneuver', {})
    t = m.get('type', '')
    mod = m.get('modifier', '')
    name = step.get('name', '')
    direction_ru = {
        'left': 'налево', 'right': 'направо',
        'sharp left': 'резко налево', 'sharp right': 'резко направо',
        'slight left': 'слегка налево', 'slight right': 'слегка направо',
        'straight': 'прямо', 'uturn': 'разворот',
    }
    d = direction_ru.get(mod, mod)
    if t == 'depart':
        return f'Начните движение по {name}' if name else 'Начните движение'
    if t == 'arrive':
        return 'Вы прибыли в пункт назначения'
    if t == 'turn':
        return f'Поверните {d} на {name}' if name else f'Поверните {d}'
    if t == 'new name':
        return f'Продолжайте движение по {name}'
    if t == 'merge':
        return f'Перестройтесь {d}' if d else 'Перестройтесь'
    if t == 'on ramp':
        return f'Съезд {d}' if d else 'На съезд'
    if t == 'off ramp':
        return f'Сверните на {name}' if name else 'Съезжайте'
    if t == 'fork':
        return f'На развилке держитесь {d}' if d else 'На развилке'
    if t == 'end of road':
        return f'В конце дороги поверните {d}'
    if t == 'roundabout' or t == 'rotary':
        exit_n = m.get('exit', 1)
        return f'На круговом движении {exit_n}-й съезд на {name}' if name else f'На кругу {exit_n}-й съезд'
    if t == 'continue':
        return f'Продолжайте {d} по {name}' if name else f'Продолжайте {d}'
    return f'Двигайтесь по {name}' if name else 'Продолжайте движение'


@api_router.get('/map_style')
async def map_style():
    style = {
        'version': 8,
        'name': 'osm-style',
        'sources': {
            'osm': {
                'type': 'raster',
                'tiles': ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                'tileSize': 256,
                'attribution': '© OpenStreetMap contributors',
            }
        },
        'layers': [
            {
                'id': 'osm-tiles',
                'type': 'raster',
                'source': 'osm',
                'minzoom': 0,
                'maxzoom': 19,
            }
        ],
    }
    return style


# ========== ISTORIC CĂUTĂRI ==========
@api_router.post('/search/save')
async def save_search(req: SaveSearchRequest):
    query = req.query.strip() if req and req.query else ''
    if not searches_collection:
        raise HTTPException(status_code=503, detail="MongoDB not available")
    if not query or len(query) == 0:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    existing = await searches_collection.find_one({"query": query})
    if existing:
        await searches_collection.update_one(
            {"query": query},
            {"$set": {"timestamp": datetime.utcnow()}}
        )
        return {"message": "Search updated", "id": existing.get("id")}

    search = SavedSearch(query=query)
    await searches_collection.insert_one(search.dict())
    return {"message": "Search saved", "id": search.id}


@api_router.get('/search/history')
async def get_search_history(limit: int = Query(20, ge=1, le=100)):
    if not searches_collection:
        raise HTTPException(status_code=503, detail="MongoDB not available")

    cursor = searches_collection.find().sort("timestamp", -1).limit(limit)
    history = []
    async for doc in cursor:
        history.append({
            "id": doc.get("id"),
            "query": doc.get("query"),
            "timestamp": doc.get("timestamp").isoformat() if doc.get("timestamp") else None
        })
    return {"history": history}


@api_router.delete('/search/history/{search_id}')
async def delete_search(search_id: str):
    if not searches_collection:
        raise HTTPException(status_code=503, detail="MongoDB not available")

    result = await searches_collection.delete_one({"id": search_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Search not found")
    return {"message": "Search deleted"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)
