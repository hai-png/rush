import Link from 'next/link';
import { Button } from '@addis/ui';
import { Compass } from 'lucide-react';

/**
 * Global 404 page. Rendered by Next.js when no route matches the URL.
 * Kept intentionally minimal — the design system handles the visual chrome.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-sm space-y-4">
        <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center mx-auto">
          <Compass className="h-7 w-7 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link href="/">
          <Button className="mt-2">Go home</Button>
        </Link>
      </div>
    </div>
  );
}
