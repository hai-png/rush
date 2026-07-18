'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@addis/ui';
import { AlertTriangle } from 'lucide-react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <AlertTriangle className="h-8 w-8 text-destructive mb-3" />
      <p className="font-semibold">Something went wrong</p>
      <p className="text-sm text-muted-foreground mt-1">{error.digest ? `Reference: ${error.digest}` : 'Please try again.'}</p>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
