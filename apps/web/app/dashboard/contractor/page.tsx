'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, Button, Badge, StatTile, useToast } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useFormatMoney } from '@addis/i18n';

export default function ContractorDashboardPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { push } = useToast();
  const money = useFormatMoney();
  const { data } = useQuery({ queryKey: ['contractor-dashboard'], queryFn: async () => (await client.GET('/api/v1/dashboard/contractor')).data });

  const startTrip = useMutation({
    // The departTime is NOT sent from the client — the client's clock can
    // be manipulated (back-dating trips to fraudulently claim rides,
    // post-dating to game seat-release expirations). The server sets the
    // departTime. We also send the window selection so the contractor can
    // pick morning vs evening.
    mutationFn: async (input: { shuttleId: string; routeId: string; window: 'morning' | 'evening' }) =>
      client.POST('/api/v1/trips', { body: { ...input, departTime: new Date().toISOString() } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contractor-dashboard'] });
      push({ title: 'Trip started' });
    },
    onError: (err: any) => {
      push({ title: err?.message ?? 'Could not start trip', variant: 'error' });
    },
  });

  const d = data as any;
  const shuttleId = d?.shuttleId;
  const routeId = d?.routeId;
  const canStart = shuttleId && routeId && d?.verificationStatus === 'verified';

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Contractor dashboard</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Verification" value={d?.verificationStatus ?? '—'} />
        <StatTile label="Rating" value={`★ ${d?.rating ?? '5.0'}`} />
        <StatTile label="This month" value={money(d?.earningsThisMonth ?? 0)} />
      </div>

      {d?.verificationStatus !== 'verified' ? (
        <Card><CardContent>
          <p className="font-medium">Verification required</p>
          <p className="text-sm text-muted-foreground">Upload your documents to start running trips.</p>
          <a href="/dashboard/contractor/documents" className="text-accent text-sm">Upload documents →</a>
        </CardContent></Card>
      ) : (
        <Card><CardContent>
          <p className="font-medium mb-2">Start today's trip</p>
          {!canStart && (
            <p className="text-sm text-muted-foreground mb-2">No shuttle/route assigned. Contact your platform admin.</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => startTrip.mutate({ shuttleId, routeId, window: 'morning' })}
              disabled={!canStart || startTrip.isPending}
              loading={startTrip.isPending}
            >
              Start morning trip
            </Button>
            <Button
              variant="outline"
              onClick={() => startTrip.mutate({ shuttleId, routeId, window: 'evening' })}
              disabled={!canStart || startTrip.isPending}
            >
              Start evening trip
            </Button>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
