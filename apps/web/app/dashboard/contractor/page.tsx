'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, Button, Badge, StatTile } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useFormatMoney } from '@addis/i18n';
import { useToast } from '@addis/ui';

export default function ContractorDashboardPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const money = useFormatMoney();
  const { push } = useToast();
  const { data } = useQuery({ queryKey: ['contractor-dashboard'], queryFn: async () => (await client.GET('/api/v1/dashboard/contractor')).data });
  const d = data as {
    verificationStatus: string;
    rating: number;
    earningsThisMonth: string;
    defaultShuttleId: string | null;
    defaultShuttlePlate: string | null;
    defaultRouteId: string | null;
    defaultRouteName: string | null;
  } | undefined;

  const startTrip = useMutation({
    mutationFn: (input: { shuttleId: string; routeId: string; window: 'morning' | 'evening'; departTime: string }) =>
      client.POST('/api/v1/trips', { body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contractor-dashboard'] });
      push({ title: 'Trip started', variant: 'success' });
    },
    onError: () => push({ title: 'Could not start trip', variant: 'error' }),
  });

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
        <Card><CardContent className="space-y-3">
          <p className="font-medium">Start today's trip</p>
          {d.defaultShuttleId && d.defaultRouteId ? (
            <>
              <p className="text-sm text-muted-foreground">
                Shuttle <Badge variant="secondary">{d.defaultShuttlePlate}</Badge> on route{' '}
                <Badge variant="secondary">{d.defaultRouteName}</Badge>
              </p>
              <div className="flex gap-2">
                <Button
                  loading={startTrip.isPending}
                  onClick={() => startTrip.mutate({
                    shuttleId: d.defaultShuttleId!,
                    routeId: d.defaultRouteId!,
                    window: 'morning',
                    departTime: new Date().toISOString(),
                  })}
                >
                  Start morning trip
                </Button>
                <Button
                  variant="outline"
                  loading={startTrip.isPending}
                  onClick={() => startTrip.mutate({
                    shuttleId: d.defaultShuttleId!,
                    routeId: d.defaultRouteId!,
                    window: 'evening',
                    departTime: new Date().toISOString(),
                  })}
                >
                  Start evening trip
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active shuttle assigned to your account. Contact a platform admin to be assigned a vehicle before you can start a trip.
            </p>
          )}
        </CardContent></Card>
      )}
    </div>
  );
}
