import React, { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';
import maplibregl from 'maplibre-gl';

export default function DrawRouteModal({ isOpen, onClose, onSave, map, startPoint, destPoint }) {
  const [points, setPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const markersRef = useRef([]);
  const lineSourceId = 'drawn-route';
  const lineLayerId = 'drawn-route-layer';

  const clearDrawing = () => {
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
    if (map.getSource(lineSourceId)) map.removeSource(lineSourceId);
  };

  useEffect(() => {
    if (!isOpen) {
      clearDrawing();
      setPoints([]);
      setIsDrawing(false);
    }
  }, [isOpen, map]);

  useEffect(() => {
    if (!map || !isOpen) return;
    if (isDrawing) {
      clearDrawing();
      setPoints([]);
      map.getCanvas().style.cursor = 'crosshair';
    } else {
      map.getCanvas().style.cursor = '';
    }
  }, [isDrawing, isOpen, map]);

  useEffect(() => {
    if (!map || !isOpen || !isDrawing) return;

    const handleClick = (e) => {
      const { lng, lat } = e.lngLat;
      setPoints(prev => [...prev, [lng, lat]]);
      const marker = new maplibregl.Marker({ color: '#f59e0b' })
        .setLngLat([lng, lat])
        .addTo(map);
      markersRef.current.push(marker);
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [map, isOpen, isDrawing]);

  useEffect(() => {
    if (!map || !isOpen) return;
    if (points.length < 2) {
      if (map.getLayer(lineLayerId)) {
        map.removeLayer(lineLayerId);
        map.removeSource(lineSourceId);
      }
      return;
    }
    const geojson = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points },
    };
    if (!map.getSource(lineSourceId)) {
      map.addSource(lineSourceId, { type: 'geojson', data: geojson });
      map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: lineSourceId,
        paint: { 'line-color': '#f59e0b', 'line-width': 6, 'line-dasharray': [2, 2] },
      });
    } else {
      map.getSource(lineSourceId).setData(geojson);
    }
  }, [map, points, isOpen]);

  const handleStartDrawing = () => {
    setIsDrawing(true);
    setPoints([]);
  };

  const handleUndoLast = () => {
    if (points.length === 0) return;
    setPoints(prev => prev.slice(0, -1));
    const last = markersRef.current.pop();
    if (last) last.remove();
  };

  const handleSave = () => {
    if (points.length < 2) {
      alert('Adaugă cel puțin două puncte pe hartă.');
      return;
    }
    const fullRoute = [startPoint, ...points, destPoint];
    onSave(fullRoute);
    onClose();
  };

  const handleCancel = () => {
    clearDrawing();
    setPoints([]);
    setIsDrawing(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      {/* Fundal semitransparent care nu blochează click-urile */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm -z-10 pointer-events-none" />
      {/* Fereastra modală propriu-zisă - permite click-uri doar pe ea */}
      <div className="bg-white/30 backdrop-blur-md border border-white/50 rounded-2xl max-w-md w-full shadow-xl pointer-events-auto">
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
                  Undo ultimul punct
                </button>
                <button
                  onClick={handleSave}
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
