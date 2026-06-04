# Navigator MD — Clonă map.md cu navigare vocală

Aplicație de navigare pentru Moldova cu prioritate pentru orașul **Florești**, instrucțiuni vocale TTS în rusă și recalculare automată a traseului.

## Stack
- **Backend:** FastAPI (Python 3.11+), Motor (MongoDB), httpx
- **Frontend:** React 19 + MapLibre GL JS + Tailwind CSS + shadcn/ui
- **Hartă:** vector tiles de la map.md (OpenMapTiles)
- **Rutare:** OSRM public (router.project-osrm.org)
- **Voce:** Web Speech API (TTS browser nativ)

## Funcționalități
- 🔍 Căutare străzi cu prioritate pe Florești (API map.md)
- 🏠 Listă cu numere de case după selectarea străzii
- 📍 Construire automată a traseului de la GPS la adresa selectată
- 🎤 Navigare vocală pas cu pas în limba rusă
- 🗺️ Mod 3D la apăsarea "Старт" — zoom 17.5, pitch 55°, rotație după direcție
- 🔄 Recalculare automată dacă deviezi >40m de la traseu

## Pornire locală

### 1. Backend
```bash
cd backend
cp .env.example .env
# editează .env dacă e nevoie
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

### 2. Frontend
```bash
cd frontend
cp .env.example .env
yarn install
yarn start
```

Deschide http://localhost:3000

## Variabile de mediu

**backend/.env**
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=navigator_md
MAPMD_API_KEY=cheia_ta_de_la_map.md
```

**frontend/.env**
```
REACT_APP_BACKEND_URL=http://localhost:8001
```

## Endpoint-uri API
- `GET /api/search?q={query}&location=Florești` — caută străzi
- `POST /api/route` — construiește traseu (OSRM)
- `GET /api/map_style` — stilul MapLibre cu tile-urile map.md

## Licență
MIT
