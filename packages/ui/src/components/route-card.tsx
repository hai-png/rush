import { MapPin, ArrowRight, Clock } from 'lucide-react';
import { Card } from '../primitives/card';
import { Badge } from '../primitives/badge';

export function RouteCard({ route, fareLabel, compact = false, onClick }: {
  route: { id: string; name: string; origin: string; destination: string; durationMin: number };
  fareLabel: string; compact?: boolean; onClick?: () => void;
}) {
  return (
    <Card
      role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={`shrink-0 cursor-pointer p-4 hover:border-primary transition-colors ${compact ? 'w-56' : 'w-full'}`}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <MapPin className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="truncate">{route.origin}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">{route.destination}</span>
      </div>
      <div className="flex items-center justify-between mt-3">
        <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{route.durationMin} min</Badge>
        <span className="font-semibold">{fareLabel}</span>
      </div>
    </Card>
  );
}
