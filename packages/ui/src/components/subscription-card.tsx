import { Card, CardContent } from '../primitives/card';
import { Badge } from '../primitives/badge';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  active: 'success', pending_payment: 'warning', expired: 'secondary', cancelled: 'destructive',
};

export function SubscriptionCard({ sub, onRenew, onCancel, onRelease }: {
  sub: { id: string; status: string; planName: string; routeName: string; ridesUsed: number; ridesIncluded: number; endDate: string };
  onRenew?: () => void; onCancel?: () => void; onRelease?: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{sub.planName}</p>
          <Badge variant={STATUS_VARIANT[sub.status] ?? 'secondary'}>{sub.status.replace('_', ' ')}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{sub.routeName}</p>
        <div className="flex items-center justify-between text-sm">
          <span>{sub.ridesUsed} / {sub.ridesIncluded === -1 ? '∞' : sub.ridesIncluded} rides used</span>
          <span className="text-muted-foreground">Ends {new Date(sub.endDate).toLocaleDateString()}</span>
        </div>
        <div className="flex gap-2 pt-1">
          {sub.status === 'active' && onRelease && (
            <button onClick={onRelease} className="text-sm text-accent font-medium">Release a seat</button>
          )}
          {sub.status === 'active' && onCancel && (
            <button onClick={onCancel} className="text-sm text-destructive font-medium ml-auto">Cancel</button>
          )}
          {(sub.status === 'expired' || sub.status === 'cancelled') && onRenew && (
            <button onClick={onRenew} className="text-sm text-primary font-medium ml-auto">Renew</button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
