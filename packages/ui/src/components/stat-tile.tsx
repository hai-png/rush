import { Card, CardContent } from '../primitives/card';
export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="text-center py-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </CardContent></Card>
  );
}
