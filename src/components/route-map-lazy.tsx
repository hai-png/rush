'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const RouteMap = dynamic(() => import('./route-map').then(m => m.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

export { RouteMap };