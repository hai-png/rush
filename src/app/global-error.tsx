'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import './globals.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-6xl font-bold text-muted-foreground">500</div>
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground text-sm">
              An unexpected error occurred. Our team has been notified. Please try again.
            </p>
            {error.digest && (
              <p className="text-xs text-muted-foreground font-mono">Error ID: {error.digest}</p>
            )}
            <div className="flex gap-2 justify-center pt-4">
              <Button onClick={reset}>Try again</Button>
              <Button asChild variant="outline"><a href="/">Go home</a></Button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
