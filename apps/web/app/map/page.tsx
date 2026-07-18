'use client';
import { useEffect, useState } from 'react';
import { MapView } from '@addis/ui';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/sdk';

export default function LiveMapPage() {
  const client = useApiClient();
  const { data: routes } = useQuery({ queryKey: ['routes-all'], queryFn: async () => (await client.GET('/api/v1/routes', { params: { query: { limit: 20 } } })).data });
  const [positions, setPositions] = useState<Record<string, { lat: number; lng: number }>>({});

  useEffect(() => {
    const es = new EventSource('/api/v1/shuttle-positions/stream');
    es.onmessage = (e) => {
      const p = JSON.parse(e.data);
      setPositions((cur) => ({ ...cur, [p.shuttleId]: p }));
    };
    return () => es.close();
  }, []);

  const allPolylines = (routes ?? []).flatMap((r: any) => r.polyline as [number, number][]);
  const markers = Object.entries(positions).map(([id, p]) => ({ id, lat: p.lat, lng: p.lng, pulse: true }));

  return (
    <div className="h-screen">
      <MapView polyline={allPolylines} markers={markers} className="h-full w-full" />
    </div>
  );
}
