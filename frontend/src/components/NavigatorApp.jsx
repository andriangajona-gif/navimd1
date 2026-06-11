import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { STYLE_URL, getRoute, formatDistance, formatDuration, haversine, recordTrip, scoreRoute, getPreferredRoute } from '../lib/api';
import SearchPanel from './SearchPanel';
import NavigationPanel from './NavigationPanel';
import DrawRouteModal from './DrawRouteModal';
import { Locate } from 'lucide-react';

function calcBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function distToRouteMeters(lat, lon, coords) {
  if (!coords || coords.length < 2) return Infinity;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = pointToSegMeters(lat, lon, coords[i][1], coords[i][0], coords[i+1][1], coords[i+1][0]);
    if (d < min) min = d;
  }
  return min;
}

function pointToSegMeters(pLat, pLon, aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const lat0 = toRad((aLat + bLat) / 2);
  const ax = R * toRad(aLon) * Math.cos(lat0), ay = R * toRad(aLat);
  const bx = R * toRad(bLon) * Math.cos(lat0), by = R * toRad(bLat);
  const px = R * toRad(pLon) * Math.cos(lat0), py = R * toRad(pLat);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

const DEFAULT_CENTER = [28.8474, 47.0124];

export function getCustomRoute(destLabel) {
  try {
    const existing = JSON.parse(localStorage.getItem('custom_routes') || '{}');
    return existing[destLabel] || null;
  } catch (e) { return null; }
}

function saveCustomRoute(destLabel, track) {
  try {
    const existing = JSON.parse(localStorage.getItem('custom_routes') || '{}');
    existing[destLabel] = { track, savedAt: Date.now() };
    localStorage.setItem('custom_routes', JSON.stringify(existing));
  } catch (e) {}
}

class WakeLockManager {
  constructor() { this.wakeLock = null; }
  async acquire() {
    try {
      if ('wakeLock' in navigator) {
        if (this.wakeLock) return true;
        this.wakeLock = await navigator.wakeLock.request('screen');
        return true;
      }
    } catch (e) {}
    return false;
  }
  async release() {
    if (this.wakeLock) {
      try { await this.wakeLock.release(); this.wakeLock = null; } catch (e) {}
    }
  }
}

// Componenta RouteOverlay optimizată (fără debounce, cu requestAnimationFrame)
function RouteOverlay({ routeCoords, map }) {
  const svgRef = useRef(null);
  const outerPolylineRef = useRef(null);
  const innerPolylineRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!map || !routeCoords || routeCoords.length === 0) return;

    const updatePoints = () => {
      if (!outerPolylineRef.current || !innerPolylineRef.current) return;
      const points = routeCoords.map(([lng, lat]) => {
        const p = map.project([lng, lat]);
        return `${p.x},${p.y}`;
      }).join(' ');
      outerPolylineRef.current.setAttribute('points', points);
      innerPolylineRef.current.setAttribute('points', points);
    };

    const handleMove = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(updatePoints);
    };

    updatePoints();
