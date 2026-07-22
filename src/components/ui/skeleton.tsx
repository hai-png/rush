import { cn } from '@/lib/utils';

// P1-41: Skeleton primitive for loading states. Used by loading.tsx files.
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}
