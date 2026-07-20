'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bus } from 'lucide-react';
import { Button, Card, CardContent, Badge, EmptyState } from '@addis/ui';
import { useFormatMoney } from '@addis/i18n';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';
import { isAllowedCheckoutUrl } from '@/lib/checkout-allowlist';

export default function OpenSeatsPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const money = useFormatMoney();
  const { push } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['seat-releases', 'open'],
    queryFn: async () => (await client.GET('/api/v1/seat-releases', { params: { query: { limit: 20 } } })).data,
  });

  const claimingId = useMutation({
    mutationFn: async (seatReleaseId: string) => {

      return client.POST('/api/v1/seat-claims', {
        headers: { 'Idempotency-Key': `claim:${seatReleaseId}` },
        body: { seatReleaseId, paymentMethod: 'telebirr' },
      });
    },
    onSuccess: (res) => {
      const checkout = (res.data as any)?.data?.checkout;
      if (checkout?.checkoutUrl) {
        if (!isAllowedCheckoutUrl(checkout.checkoutUrl)) {
          push({ title: 'Invalid checkout URL returned by payment provider', variant: 'error' });
          return;
        }
        window.location.href = checkout.checkoutUrl;
      } else {
        push({ title: 'Seat claimed — check your trips' });
      }
      qc.invalidateQueries({ queryKey: ['seat-releases'] });
    },
    onError: (err: any) => {

      const msg = err?.message ?? 'Could not claim this seat';
      push({ title: msg, variant: 'error' });
    },
  });

  if (!isLoading && !data?.length) {
    return <EmptyState icon={Bus} title="No open seats right now" description="Check back closer to your commute window — riders release seats up to a few hours before departure." />;
  }

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto space-y-3">
      <h1 className="text-xl font-semibold mb-2">Open seats</h1>
      {(data ?? []).map((r: any) => (
        <Card key={r.id}>
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="font-medium">{r.routeName}</p>
              <p className="text-sm text-muted-foreground">{r.releaseDate} · <Badge variant="secondary">{r.window}</Badge></p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{money(r.refundAmount)}</p>
              <Button
                size="sm"
                className="mt-1"
                loading={claimingId.isPending && claimingId.variables === r.id}
                onClick={() => claimingId.mutate(r.id)}
              >
                Claim
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
