import { Skeleton } from '@addis/ui';
export default function Loading() {
  return (
    <div className="px-5 pt-6 space-y-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="flex gap-3"><Skeleton className="h-40 w-56 rounded-2xl" /><Skeleton className="h-40 w-56 rounded-2xl" /></div>
    </div>
  );
}
