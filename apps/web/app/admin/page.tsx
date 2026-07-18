import { getServerApiClient } from '@/lib/sdk';
import { StatTile } from '@addis/ui';

export default async function AdminDashboardPage() {
  const client = await getServerApiClient();
  const { data } = await client.GET('/api/v1/admin/dashboard');
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Platform overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="Active subscriptions" value={String((data as any)?.activeSubscriptions ?? 0)} />
        <StatTile label="Open seat releases" value={String((data as any)?.openSeatReleases ?? 0)} />
        <StatTile label="Pending contractors" value={String((data as any)?.pendingContractorVerifications ?? 0)} />
        <StatTile label="Revenue (30d)" value={`ETB ${(data as any)?.revenueLast30dETB ?? 0}`} />
        <StatTile label="Open tickets" value={String((data as any)?.openTickets ?? 0)} />
      </div>
    </div>
  );
}
