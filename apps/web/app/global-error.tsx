'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@addis/ui';
import { AlertTriangle } from 'lucide-react';

/**
 * Global error boundary. Catches unhandled errors in any server component
 * or route handler that isn't caught by a more specific error.tsx (e.g. the
 * one in dashboard/rider/). Reports to Sentry and offers a reset button.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="text-center max-w-sm space-y-4">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              {error.digest
                ? `Reference: ${error.digest}`
                : 'An unexpected error occurred. Please try again.'}
            </p>
            <Button onClick={reset}>Try again</Button>
          </div>
        </div>
      </body>
    </html>
  );
}
