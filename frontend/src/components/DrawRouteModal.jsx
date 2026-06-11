import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, MapPin, Undo2 } from 'lucide-react';
import maplibregl from 'maplibre-gl';

export default function DrawRouteModal({ isOpen, onClose, onSave, map, startPoint, destPoint }) {
  const [points, setPoints] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const markersRef = useRef([]);
  const lineSourceId = 'drawn-route';
  const lineLayerId = 'drawn-route-layer';

  // Curăță toate elementele desenate de pe hartă
  const clearDrawing = useCallback(() => {
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (map.getLayer(lineLayerId)) {
      map.removeLayer(lineLayerId);
      map.removeSource(lineSourceId);
    }
  }, [map, lineLayerId, lineSourceId]);

  // Când se închide modalul (isOpen=false), curăță tot
  useEffect(() => {
    if (!isOpen) {
      clearDrawing();
      setPoints([]);
      setIsDrawing(false);
    }
  }, [isOpen, clearDrawing]);

  // La începerea desenării, curăță desenele anterioare și setează cursorul
  useEffect(() => {
    if (!map || !isOpen) return;
    if (isDrawing) {
      clearDrawing();
      setPoints([]);
      map.getCanvas().style.cursor = 'crosshair';
    } else {
      map.getCanvas().style.cursor = '';
    }
  }, [isDrawing, isOpen, map, clearDrawing]);

  // Capturarea click-urilor pe hartă pentru a adăuga puncte
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
    return () => map.off('click', handleClick);
  }, [map, isOpen, isDrawing]);

  // Desenează linia între puncte în timp real
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
  }, [map, points, isOpen, lineSourceId, lineLayerId]);

  const handleStartDrawing = () => {
    setIsDrawing(true);
  };

  const handleUndoLast = () => {
    if (points.length === 0) return;
    setPoints(prev => prev.slice(0, -1));
    const last = markersRef.current.pop();
    if (last) last.remove();
  };

  const handleSave = () => {
    if (points.length < 2) {
      alert('Adaugă cel puțin două puncte pe hartă pentru a crea o rută.');
      return;
    }
    const fullRoute = [startPoint, ...points, destPoint];
    onSave(fullRoute);
    // După salvare, curățăm și ieșim din modul desenare
    clearDrawing();
    setPoints([]);
    setIsDrawing(false);
    onClose();
  };

  const handleCancel = () => {
    clearDrawing();
    setPoints([]);
    setIsDrawing(false);
    onClose();
  };

  // Dacă modalul nu este deschis, nu afișa nimic
  if (!isOpen) return null;

  // Dacă nu suntem în modul desenare, afișăm un buton flotant pentru a începe
  if (!isDrawing) {
    return (
      <div className="absolute bottom-24 right-3 z-40">
        <button
          onClick={handleStartDrawing}
          className="bg-amber-500 text-white p-3 rounded-full shadow-lg flex items-center justify-center w-12 h-12 hover:bg-amber-600 transition-colors"
          title="Desenează ruta personalizată"
        >
          <MapPin size={24} />
        </button>
      </div>
    );
  }

  // Panou de control în timpul desenării
  return (
    <div className="absolute bottom-24 right-3 z-40 flex flex-col gap-2">
      <div className="bg-white/90 backdrop-blur-md border border-amber-300 rounded-xl p-3 shadow-lg">
        <div className="text-black text-sm font-semibold mb-2 text-center">
          Desenare activă: {points.length} puncte
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleUndoLast}
            disabled={points.length === 0}
            className="px-4 py-2 rounded-lg bg-white/70 border border-gray-300 text-black text-sm disabled:opacity-50 flex items-center gap-1"
          >
            <Undo2 size={14} /> Undo
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold flex items-center gap-1"
          >
            <Check size={14} /> Salvează
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm flex items-center gap-1"
          >
            <X size={14} /> Anulează
          </button>
        </div>
      </div>
    </div>
  );
}
