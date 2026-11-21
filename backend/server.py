import os
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAPMD_API_KEY = os.getenv("MAPMD_API_KEY")
MAPMD_BASE_URL = "https://map.md/api"

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
        "layers": [{
            "id": "osm-tiles",
            "type": "raster",
            "source": "osm",
            "minzoom": 0,
            "maxzoom": 19,
        }],
    }

@api_router.get("/search")
async def search(
    q: str = Query(..., min_length=2),
    location: str = "Florești",
    lang: str = "ro",
):
    if not MAPMD_API_KEY:
        raise HTTPException(500, "MAPMD_API_KEY is not configured")

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{MAPMD_BASE_URL}/search",
                params={"q": q, "location": location, "lang": lang},
                headers={"Authorization": f"Bearer {MAPMD_API_KEY}"},
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        raise HTTPException(502, "Street search provider unavailable") from exc

    results = data if isinstance(data, list) else data.get("results", [])
    floresti = []

    for item in results:
        parent = str(item.get("parent_name") or "").strip().lower()
        if parent.replace("ș", "s").replace("ş", "s") != "floresti":
            continue
        if item.get("type") == "street":
            floresti.append(item)

    return {"results": floresti}

@api_router.get("/geocode")
async def geocode(
    street: str,
    building: str,
    city: str = "Florești",
):
    if normalize(city) != "floresti":
        raise HTTPException(400, "Only addresses in Florești are supported")

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{MAPMD_BASE_URL}/geocode",
                params={
                    "street": street,
                    "building": building,
                    "city": city,
                    "lang": "ro",
                },
                headers={"Authorization": f"Bearer {MAPMD_API_KEY}"},
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        raise HTTPException(502, "Geocoding provider unavailable") from exc

    lat = data.get("lat")
    lon = data.get("lon") or data.get("lng")

    if lat is None or lon is None:
        raise HTTPException(404, "Exact address not found")

    return {"lat": float(lat), "lon": float(lon)}

app.include_router(api_router)
