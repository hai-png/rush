'use client';

import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// P2-27 / OPS-023: self-host leaflet marker icons instead of loading from
// Cloudflare CDN. The CDN is blocked in Ethiopia (common internet restriction),
// which made markers disappear. Copy the images to /public/leaflet/ during
// the build — they ship with the leaflet npm package.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

type Pickup = { id: string; name: string; lat: number | null; lng: number | null; estimatedPickupTime: string };
type ShuttlePos = { lat: number; lng: number; heading: number; speed: number; updatedAt: number };

export function RouteMap({
  pickups,
  shuttlePositions = [],
  origin = 'Origin',
  destination = 'Destination',
}: {
  pickups: Pickup[];
  shuttlePositions?: ShuttlePos[];
  origin?: string;
  destination?: string;
}) {
  const center: [number, number] = pickups.length > 0 && pickups[0].lat != null && pickups[0].lng != null
    ? [pickups[0].lat, pickups[0].lng]
    : [9.03, 38.74]; // Addis Ababa center

  const hasCoords = pickups.filter(p => p.lat != null && p.lng != null);
  const routeCoords: [number, number][] = hasCoords.map(p => [p.lat!, p.lng!]);

  return (
    <div className="w-full h-[400px] rounded-lg overflow-hidden border">
      <MapContainer center={center} zoom={12} scrollWheelZoom={false} className="w-full h-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {hasCoords.map((p, i) => (
          <Marker key={p.id} position={[p.lat!, p.lng!]}>
            <Popup>
              <div className="text-sm">
                <div className="font-medium">{p.name}</div>
                <div className="text-muted-foreground">Pickup ~{p.estimatedPickupTime}</div>
                {i === 0 && <div className="text-xs text-primary mt-1">First stop</div>}
                {i === hasCoords.length - 1 && <div className="text-xs text-primary mt-1">Last stop</div>}
              </div>
            </Popup>
          </Marker>
        ))}
        {routeCoords.length > 1 && (
          <Polyline positions={routeCoords} pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.6 }} />
        )}
        {shuttlePositions.map((pos, i) => (
          <Marker key={i} position={[pos.lat, pos.lng]}>
            <Popup>
              <div className="text-sm">
                <div className="font-medium">🚌 Shuttle</div>
                <div className="text-muted-foreground">Speed: {pos.speed} km/h</div>
                <div className="text-muted-foreground">Updated: {new Date(pos.updatedAt).toLocaleTimeString()}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
