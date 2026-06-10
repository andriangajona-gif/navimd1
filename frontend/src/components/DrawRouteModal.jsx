import React, { useState, useEffect } from 'react';
import { X, Check, Trash2, MapPin } from 'lucide-react';

export default function DrawRouteModal({ isOpen, onClose, onSave, map, startPoint, destPoint, destLabel }) {
  const [points, setPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tempMarker, setTempMarker] = useState(null);

  useEffect(() => {
    if (!isOpen || !map) return;

    // Stil cursor pentru desenare
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';

    const handleClick = (e) => {
      if (!isDrawing) return;
      const lngLat = e.lngLat;
      const newPoint = [lngLat.lng, lngLat.lat];
      setPoints(prev => [...prev, newPoint]);
      
      // Adaugă un marker temporar
      const marker = new maplibregl.Marker({ color: '#f59e0b' })
        .setLngLat(newPoint)
        .addTo(map);
      setTempMarker(marker);
    };

    map.on('click', handleClick);

    return () => {
      canvas.style.cursor = '';
      map.off('click', handleClick);
      if (tempMarker) tempMarker.remove();
    };
  }, [isOpen, map, isDrawing]);

  useEffect(() => {
    // Desenează linia pe hartă pentru punctele adăugate
    if (!map || points.length < 2) return;
    
    // Elimină layer-ul anterior dacă există
    if (map.getSource('drawn-route')) {
      map.removeLayer('drawn-route-line');
      map.removeSource('drawn-route');
    }
    
    map.addSource('drawn-route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: points
        }
      }
    });
    map.addLayer({
      id: 'drawn-route-line',
      type: 'line',
      source: 'drawn-route',
      paint: {
        'line-color': '#f59e0b',
        'line-width': 6,
        'line-dasharray': [2, 2]
      }
    });
  }, [points, map]);

  const handleStartDrawing = () => {
    setIsDrawing(true);
    setPoints([]);
    if (tempMarker) tempMarker.remove();
  };

  const handleUndoLast = () => {
    setPoints(prev => prev.slice(0, -1));
    if (tempMarker) tempMarker.remove();
  };

  const handleSaveRoute = () => {
    if (points.length < 2) {
      alert('Adaugă cel puțin două puncte pentru a crea o rută.');
      return;
    }
    // Salvează ruta în localStorage
    const allPoints = [startPoint, ...points, destPoint];
    onSave(allPoints);
    onClose();
  };

  const handleCancel = () => {
    setPoints([]);
    setIsDrawing(false);
    if (tempMarker) tempMarker.remove();
    // Curăță layer-ul temporar
    if (map && map.getSource('drawn-route')) {
      map.removeLayer('drawn-route-line');
      map.removeSource('drawn-route');
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white/30 backdrop-blur-md border border-white/50 rounded-2xl max-w-md w-full shadow-xl">
        <div className="p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-black">Desenează ruta personalizată</h2>
            <button onClick={handleCancel} className="text-black/70 hover:text-black">
              <X size={24} />
            </button>
          </div>
          <p className="text-black/80 text-sm mb-4">
            Click pe hartă pentru a adăuga puncte. Traseul tău va fi folosit pentru scuter.
            <br />
            <span className="text-amber-600 font-semibold">Start: {startPoint[1]}, {startPoint[0]}</span>
            <br />
            <span className="text-green-600 font-semibold">Destinație: {destPoint[1]}, {destPoint[0]}</span>
          </p>
          {!isDrawing ? (
            <button
              onClick={handleStartDrawing}
              className="w-full py-3 rounded-xl bg-amber-500 text-white font-bold"
            >
              Începe desenarea
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-black/70 text-sm">Adaugă puncte pe hartă. Ai {points.length} puncte.</p>
              <div className="flex gap-3">
                <button
                  onClick={handleUndoLast}
                  disabled={points.length === 0}
                  className="flex-1 py-3 rounded-xl bg-white/40 border border-white/50 text-black font-semibold disabled:opacity-50"
                >
                  Undo ultimul punct
                </button>
                <button
                  onClick={handleSaveRoute}
                  className="flex-1 py-3 rounded-xl bg-green-500 text-white font-bold flex items-center justify-center gap-2"
                >
                  <Check size={18} /> Salvează ruta
                </button>
              </div>
            </div>
          )}
          <button
            onClick={handleCancel}
            className="w-full mt-3 py-2 text-black/50 text-sm"
          >
            Renunță
          </button>
        </div>
      </div>
    </div>
  );
}
