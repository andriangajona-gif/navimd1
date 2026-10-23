@api_router.get('/map_style')
async def map_style():
    # Use a valid fallback style so the app always renders a map.
    # If a working map.md vector style is configured later, it can replace this.
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
