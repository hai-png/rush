'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bus, Bell, MapPin, ArrowRight } from 'lucide-react';
import { Button, Card, CardContent, Skeleton, Badge } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

export default function RiderDashboardPage() {
  const client = useApiClient();

  const { data, isLoading } = useQuery({
    queryKey: ['rider-dashboard'],
    queryFn: async () => (await client.GET('/api/v1/dashboard/rider')).data,
  });

  const d = data as
    | {
        activeSubscription?: {
          id: string;
          status: string;
          ridesUsed: number;
          plan: { name: string; ridesIncluded: number };
          route: { name: string; id: string } | null;
          endDate: string;
        } | null;
        unreadNotifications: number;
      }
    | undefined;

  return (
    <div className="px-5 py-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold leading-tight">Every commute starts with a confirmed seat.</h1>
        <p className="text-sm text-muted-foreground mt-1">Welcome back. Manage your subscription, track shuttles, and ride.</p>
      </div>

      {isLoading ? (
        <Card><CardContent className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-10 w-full rounded-full" />
        </CardContent></Card>
      ) : d?.activeSubscription ? (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Active plan</p>
              <Badge variant="success">{d.activeSubscription.status.replace('_', ' ')}</Badge>
            </div>
            <p className="text-lg font-semibold">{d.activeSubscription.plan.name}</p>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {d.activeSubscription.route?.name ?? '—'}
            </p>
            <p className="text-sm">
              {d.activeSubscription.ridesUsed} /{' '}
              {d.activeSubscription.plan.ridesIncluded === -1
                ? '∞'
                : d.activeSubscription.plan.ridesIncluded}{' '}
              rides used
            </p>
            <Link href={`/dashboard/rider/active-trip?subscriptionId=${d.activeSubscription.id}`}>
              <Button className="w-full">
                <Bus className="h-4 w-4" /> Track today's shuttle
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 text-center">
            <p className="font-medium">No active subscription</p>
            <p className="text-sm text-muted-foreground">Browse plans to reserve your daily seat.</p>
            <Link href="/plans">
              <Button className="w-full">
                See plans <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/open-seats">
          <Card className="h-full hover:border-primary transition-colors cursor-pointer">
            <CardContent className="space-y-1">
              <Bus className="h-5 w-5 text-primary" />
              <p className="font-medium text-sm">Open seats</p>
              <p className="text-xs text-muted-foreground">Claim a released seat for today.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/notifications">
          <Card className="h-full hover:border-primary transition-colors cursor-pointer">
            <CardContent className="space-y-1">
              <Bell className="h-5 w-5 text-primary" />
              <p className="font-medium text-sm">Notifications</p>
              <p className="text-xs text-muted-foreground">
                {d?.unreadNotifications ? `${d.unreadNotifications} unread` : 'No unread'}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
