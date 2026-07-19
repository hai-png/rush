import { Card, CardContent } from '../primitives/card';
import { Badge } from '../primitives/badge';
import { Clock, MapPin } from 'lucide-react';

/**
 * Shown to riders on the dashboard and live-trip screen — surfaces the next
 * estimated arrival for their assigned shuttle on a given route.
 */
export function ShuttleEtaCard({
  routeName,
  plateNumber,
  etaMinutes,
  status,
  nextStop,
}: {
  routeName: string;
  plateNumber: string;
  etaMinutes: number;
  status: 'on_time' | 'delayed' | 'arrived' | 'cancelled';
  nextStop?: string;
}) {
  const statusVariant: Record<typeof status, 'success' | 'warning' | 'secondary' | 'destructive'> = {
    on_time: 'success',
    delayed: 'warning',
    arrived: 'secondary',
    cancelled: 'destructive',
  };
  const statusLabel: Record<typeof status, string> = {
    on_time: 'On time',
    delayed: 'Delayed',
    arrived: 'Arrived',
    cancelled: 'Cancelled',
  };

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium">{routeName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{plateNumber}</p>
          </div>
          <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold">{etaMinutes}</span>
            <span className="text-muted-foreground">min</span>
          </span>
          {nextStop && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> {nextStop}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
