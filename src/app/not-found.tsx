import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-6xl font-bold text-muted-foreground">404</div>
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex gap-2 justify-center pt-4">
          <Button asChild><Link href="/">Go home</Link></Button>
          <Button asChild variant="outline"><Link href="/login">Sign in</Link></Button>
        </div>
      </div>
    </div>
  );
}
