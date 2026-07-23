'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TicketsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[tickets error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Couldn&apos;t load tickets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your support tickets. The error has been logged.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground">Request ID: {error.digest}</p>
          )}
          <div className="flex gap-2">
            <Button onClick={reset} size="sm">Try again</Button>
            <Button onClick={() => window.history.back()} variant="outline" size="sm">Go back</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
