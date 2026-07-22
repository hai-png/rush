'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';

// P1-17 / FE-017: this page previously had a dead "Request to join" button that
// just showed a toast. The working flow is /corporate/signup (which requires
// auth + uses the real API). This page now redirects there.
export default function CorporateSignupPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/corporate/signup');
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronLeft className="h-4 w-4" /> Back to home
          </Link>
          <CardTitle>Redirecting…</CardTitle>
          <CardDescription>Taking you to corporate signup.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline"><Link href="/corporate/signup">Go to corporate signup</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
