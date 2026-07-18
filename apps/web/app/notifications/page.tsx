'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { EmptyState, Card, CardContent } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { cn } from '@addis/ui';

export default function NotificationsPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: async () => (await client.GET('/api/v1/notifications')).data });
  const markRead = useMutation({
    mutationFn: (id: string) => client.PATCH('/api/v1/notifications/{id}', { params: { path: { id } }, body: { readAt: new Date().toISOString() } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!isLoading && !data?.length) return <EmptyState icon={BellOff} title="No notifications" description="You're all caught up." />;

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto space-y-2">
      <h1 className="text-xl font-semibold mb-4">Notifications</h1>
      {(data ?? []).map((n: any) => (
        <Card key={n.id} onClick={() => !n.readAt && markRead.mutate(n.id)}
          className={cn('cursor-pointer', !n.readAt && 'border-primary')}>
          <CardContent className="flex gap-3">
            <Bell className={cn('h-4 w-4 mt-0.5', !n.readAt ? 'text-primary' : 'text-muted-foreground')} />
            <div>
              <p className="font-medium text-sm">{n.title}</p>
              <p className="text-xs text-muted-foreground">{n.body}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
