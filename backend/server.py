from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
import uuid
from datetime import datetime

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

MONGO_URL = os.environ.get('MONGO_URL')
DB_NAME = os.environ.get('DB_NAME', 'test_database')
MAPMD_API_KEY = os.environ.get('MAPMD_API_KEY', '040c1d37-142e-4f81-adfb-c6f7a7dce753')
MAPMD_BASE = 'https://map.md/api/companies/webmap'
OSRM_BASE = 'https://router.project-osrm.org'

client = AsyncIOMotorClient(MONGO_URL) if MONGO_URL else None
db = client[DB_NAME] if client else None

app = FastAPI(title='Navigator MD API')
api_router = APIRouter(prefix='/api')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

http_client: Optional[httpx.AsyncClient] = None

@app.on_event('startup')
async def _startup():
    global http_client
    http_client = httpx.AsyncClient(timeout=15.0, follow_redirects=True)

@app.on_event('shutdown')
async def _shutdown():
    if http_client:
        await http_client.aclose()
    if client:
        client.close()


class RouteRequest(BaseModel):
    from_lat: float
    from_lon: float
    to_lat: float
    to_lon: float
    profile: str = 'driving'


class SavedSearch(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    query: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


@api_router.get('/')
async def root():
    return {'message': 'Navigator MD API', 'status': 'ok'}


@api_router.get('/download')
async def download_project():
    zip_path = ROOT_DIR / 'static' / 'navigator-md.zip'
    if not zip_path.exists():
        raise HTTPException(status_code=404, detail='ZIP not found')
    return FileResponse(
        path=str(zip_path),
        media_type='application/zip',
        filename='navigator-md.zip',
    )


@api_router.get('/search')
async def search(
    q: str = Query(..., min_length=1),
    location: str = Query('Florești'),
    lang: str = Query('ro'),
):
    url = f'{MAPMD_BASE}/search_street'
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
        loc_low = location.lower()
        prio = [it for it in data if isinstance(it, dict) and loc_low in (it.get('parent_name') or '').lower()]
        rest = [it for it in data if it not in prio]
        return {'results': prio + rest, 'priority_city': location}
    except Exception as e:
        logger.exception('search error')
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get('/search_general')
async def search_general(
    q: str = Query(..., min_length=1),
    lang: str = Query('ro'),
):
    url = f'{MAPMD_BASE}/search'
    params = {'q': q, 'lang': lang}
    auth = (MAPMD_API_KEY, '')
    try:
        r = await http_client.get(url, params=params, auth=auth)
        data = r.json() if r.status_code == 200 else {}
        return data
    except Exception as e:
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
        'name': 'map.md-clone',
        'sprite': 'https://map.md/api/tiles/styles/osm-bright/sprite',
        'glyphs': 'https://map.md/api/tiles/fonts/{fontstack}/{range}.pbf',
        'sources': {
            'openmaptiles': {
                'type': 'vector',
                'url': 'https://map.md/api/tiles/data/v3.json',
            }
        },
        'layers': default_layers(),
    }
    return style


def default_layers():
    return [
        {'id': 'background', 'type': 'background', 'paint': {'background-color': '#f5efe1'}},
        {'id': 'water', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'water',
         'paint': {'fill-color': '#a5cfdb'}},
        {'id': 'landuse_park', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'landuse',
         'filter': ['in', 'class', 'park', 'cemetery', 'wood', 'grass', 'pitch'],
         'paint': {'fill-color': '#cfe3c5'}},
        {'id': 'landuse_residential', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'landuse',
         'filter': ['==', 'class', 'residential'],
         'paint': {'fill-color': '#ece4d2'}},
        {'id': 'landcover_grass', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'landcover',
         'filter': ['==', 'class', 'grass'],
         'paint': {'fill-color': '#d6e7c8'}},
        {'id': 'landcover_wood', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'landcover',
         'filter': ['==', 'class', 'wood'],
         'paint': {'fill-color': '#bfd9af'}},
        {'id': 'waterway', 'type': 'line', 'source': 'openmaptiles', 'source-layer': 'waterway',
         'paint': {'line-color': '#a5cfdb', 'line-width': 1.5}},
        {'id': 'building', 'type': 'fill', 'source': 'openmaptiles', 'source-layer': 'building',
         'minzoom': 13,
         'paint': {'fill-color': '#e6dcc7', 'fill-outline-color': '#cdc0a3'}},
        {'id': 'road_minor', 'type': 'line', 'source': 'openmaptiles', 'source-layer': 'transportation',
         'minzoom': 12,
         'filter': ['in', 'class', 'minor', 'service', 'track'],
         'paint': {'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.8, 18, 6]}},
        {'id': 'road_secondary', 'type': 'line', 'source': 'openmaptiles', 'source-layer': 'transportation',
         'filter': ['in', 'class', 'secondary', 'tertiary'],
         'paint': {'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 18, 10]}},
        {'id': 'road_primary', 'type': 'line', 'source': 'openmaptiles', 'source-layer': 'transportation',
         'filter': ['in', 'class', 'primary', 'trunk'],
         'paint': {'line-color': '#ffd699', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 18, 14]}},
        {'id': 'road_motorway', 'type': 'line', 'source': 'openmaptiles', 'source-layer': 'transportation',
         'filter': ['==', 'class', 'motorway'],
         'paint': {'line-color': '#f1a73f', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 18, 16]}},
        {'id': 'admin_country', 'type': 'line', 'source': 'openmaptiles', 'source-layer': 'boundary',
         'filter': ['==', 'admin_level', 2],
         'paint': {'line-color': '#9c8e6d', 'line-width': 1.2, 'line-dasharray': [3, 2]}},
        {'id': 'place_label', 'type': 'symbol', 'source': 'openmaptiles', 'source-layer': 'place',
         'minzoom': 4, 'maxzoom': 16,
         'filter': ['in', 'class', 'city', 'town', 'village'],
         'layout': {'text-field': '{name}', 'text-font': ['Open Sans Bold'],
                    'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 14, 18]},
         'paint': {'text-color': '#3b3528', 'text-halo-color': '#f5efe1', 'text-halo-width': 1.5}},
        {'id': 'road_label', 'type': 'symbol', 'source': 'openmaptiles', 'source-layer': 'transportation_name',
         'minzoom': 13,
         'layout': {'symbol-placement': 'line', 'text-field': '{name}', 'text-font': ['Open Sans Regular'],
                    'text-size': 11},
         'paint': {'text-color': '#4a4030', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2}},
        {'id': 'housenumber', 'type': 'symbol', 'source': 'openmaptiles', 'source-layer': 'housenumber',
         'minzoom': 16,
         'layout': {
             'text-field': '{housenumber}',
             'text-font': ['Open Sans Regular'],
             'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9, 19, 12],
             'text-anchor': 'center',
             'text-allow-overlap': False,
             'text-ignore-placement': False,
         },
         'paint': {'text-color': '#7a6a45', 'text-halo-color': '#f5efe1', 'text-halo-width': 1.3}},
    ]


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)
