'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, Badge, Button } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useFormatMoney } from '@addis/i18n';

export default function AdminPlansPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const money = useFormatMoney();
  const { data } = useQuery({ queryKey: ['admin-plans'], queryFn: async () => (await client.GET('/api/v1/plans')).data });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => client.PATCH('/api/v1/admin/plans/{id}', { params: { path: { id } }, body: { isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-plans'] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Plans</h1>
      <div className="grid sm:grid-cols-3 gap-4">
        {(data ?? []).map((p: any) => (
          <Card key={p.id}>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium">{p.name}</p>
                {p.isPopular && <Badge>Popular</Badge>}
              </div>
              <p className="text-2xl font-semibold">{money(p.priceETB)}</p>
              <p className="text-sm text-muted-foreground">{p.durationDays} days · {p.ridesIncluded === -1 ? 'Unlimited' : `${p.ridesIncluded} rides`}</p>
              <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: p.id, isActive: !p.isActive })}>
                {p.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
