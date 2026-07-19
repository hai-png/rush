'use client';
import { useEffect, useRef } from 'react';

/** Thin wrapper around react-leaflet, configured for CARTO/Mapbox/self-hosted tiles per env. */
export function MapView({ polyline, markers, className }: {
  polyline?: [number, number][];
  markers?: { id: string; lat: number; lng: number; label?: string; pulse?: boolean }[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: any;
    (async () => {
      const L = await import('leaflet');
      if (!ref.current) return;
      map = L.map(ref.current).setView(polyline?.[0] ?? [9.02, 38.75], 13);
      // FIX (typecheck): process.env is not defined in the UI package's tsconfig
      // (no @types/node). Use a runtime-safe access that doesn't require the
      // node type declarations — NEXT_PUBLIC_* vars are inlined by Next.js at
      // build time, so we read them via a guarded globalThis access.
      const tileUrl = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_TILE_SERVER_URL)
        || `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`;
      L.tileLayer(tileUrl, { attribution: '&copy; OpenStreetMap &copy; CARTO' }).addTo(map);
      if (polyline?.length) L.polyline(polyline, { color: '#10b981', weight: 4 }).addTo(map);
      markers?.forEach((m) => {
        const icon = L.divIcon({
          className: m.pulse ? 'shuttle-marker-pulse' : '',
          html: `<div class="h-3 w-3 rounded-full bg-emerald-500 ${m.pulse ? 'animate-ping' : ''}"></div>`,
        });
        L.marker([m.lat, m.lng], { icon }).addTo(map).bindPopup(m.label ?? '');
      });
    })();
    return () => map?.remove();
  }, [polyline, markers]);

  return <div ref={ref} className={className ?? 'h-full w-full'} role="img" aria-label="Live shuttle map" />;
}
