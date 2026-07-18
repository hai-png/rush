'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, Button, Badge, StatTile } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useFormatMoney } from '@addis/i18n';

export default function ContractorDashboardPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const money = useFormatMoney();
  const { data } = useQuery({ queryKey: ['contractor-dashboard'], queryFn: async () => (await client.GET('/api/v1/dashboard/contractor')).data });

  const startTrip = useMutation({
    mutationFn: (input: any) => client.POST('/api/v1/trips', { body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contractor-dashboard'] }),
  });

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Contractor dashboard</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Verification" value={(data as any)?.verificationStatus ?? '—'} />
        <StatTile label="Rating" value={`★ ${(data as any)?.rating ?? '5.0'}`} />
        <StatTile label="This month" value={money((data as any)?.earningsThisMonth ?? 0)} />
      </div>

      {(data as any)?.verificationStatus !== 'verified' ? (
        <Card><CardContent>
          <p className="font-medium">Verification required</p>
          <p className="text-sm text-muted-foreground">Upload your documents to start running trips.</p>
          <a href="/dashboard/contractor/documents" className="text-accent text-sm">Upload documents →</a>
        </CardContent></Card>
      ) : (
        <Card><CardContent>
          <p className="font-medium mb-2">Start today's trip</p>
          <Button onClick={() => startTrip.mutate({ shuttleId: (data as any).shuttleId, routeId: (data as any).routeId, window: 'morning', departTime: new Date().toISOString() })}>
            Start trip
          </Button>
        </CardContent></Card>
      )}
    </div>
  );
}
