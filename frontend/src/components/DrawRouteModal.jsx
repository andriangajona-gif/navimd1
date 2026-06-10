import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';
import maplibregl from 'maplibre-gl';

export default function DrawRouteModal({ isOpen, onClose, onSave, map, startPoint, destPoint }) {
  const [points, setPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const markersRef = useRef([]);
  const lineLayerId = 'drawn-route-line';
  const lineSourceId = 'drawn-route';

  // Curăță layer-ele și markerii
  const cleanup = () => {
    if (!map) return;
    if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
    if (map.getSource(lineSourceId)) map.removeSource(lineSourceId);
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
  };

  // Resetează când se închide modalul
  useEffect(() => {
    if (!isOpen) {
      cleanup();
      setPoints([]);
      setIsDrawing(false);
    }
  }, [isOpen, map]);

  // Configurează cursorul și evenimentele de click pe hartă
  useEffect(() => {
    if (!isOpen || !map || !isDrawing) return;

    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';

    const handleClick = (e) => {
      const { lng, lat } = e.lngLat;
      const newPoint = [lng, lat];
      setPoints(prev => [...prev, newPoint]);
      
      const marker = new maplibregl.Marker({ color: '#f59e0b' })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.push(marker);
    };

    map.on('click', handleClick);

    return () => {
      canvas.style.cursor = '';
      map.off('click', handleClick);
    };
  }, [isOpen, map, isDrawing]);

  // Desenează linia pe hartă
  useEffect(() => {
    if (!map || points.length < 2) {
      if (map && map.getLayer(lineLayerId)) {
        map.removeLayer(lineLayerId);
        map.removeSource(lineSourceId);
      }
      return;
    }

    if (map.getSource(lineSourceId)) {
      map.getSource(lineSourceId).setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: points }
      });
    } else {
      map.addSource(lineSourceId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: points }
        }
      });
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: lineSourceId,
        paint: {
          'line-color': '#f59e0b',
          'line-width': 6,
          'line-dasharray': [2, 2]
        }
      });
    }
  }, [map, points]);

  const handleStartDrawing = () => {
    setIsDrawing(true);
    setPoints([]);
  };

  const handleUndoLast = () => {
    if (points.length === 0) return;
    setPoints(prev => prev.slice(0, -1));
    const lastMarker = markersRef.current.pop();
    if (lastMarker) lastMarker.remove();
  };

  const handleSaveRoute = () => {
    if (points.length < 2) {
      alert('Adaugă cel puțin două puncte pentru a crea o rută.');
      return;
    }
    const allPoints = [startPoint, ...points, destPoint];
    onSave(allPoints);
    onClose();
  };

  const handleCancel = () => {
    cleanup();
    setPoints([]);
    setIsDrawing(false);
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
                  Unde ultimul punct
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
          <button onClick={handleCancel} className="w-full mt-3 py-2 text-black/50 text-sm">
            Renunță
          </button>
        </div>
      </div>
    </div>
  );
}
