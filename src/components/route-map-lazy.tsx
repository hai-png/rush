'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

// client-component wrapper that lazy-loads RouteMap.
// `next/dynamic` with `ssr: false` is not allowed in Server Components,
// so we wrap it here. Server components import this wrapper instead.
const RouteMap = dynamic(() => import('./route-map').then(m => m.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

export { RouteMap };
