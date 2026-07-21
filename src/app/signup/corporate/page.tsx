'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft } from 'lucide-react';

export default function CorporateSignupPage() {
  // Corporate signup is a 2-step flow: (1) admin signs up + creates a corporate,
  // MVP slice — show an explanatory page.
  const [code, setCode] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronLeft className="h-4 w-4" /> Back to home
          </Link>
          <CardTitle>Corporate signup</CardTitle>
          <CardDescription>Join your company's Addis Ride plan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            If your employer has given you a corporate code, enter it below to request membership.
            Your corporate admin must approve you before you can subscribe at the subsidized rate.
          </p>
          <div>
            <Label htmlFor="code">Corporate code</Label>
            <Input id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. ACME-2026" />
          </div>
          <Button
            className="w-full"
            onClick={() => toast.info('Corporate signup via the API is not wired into this MVP slice. POST /api/v1/corporate/signup would create a pending CorporateMember row.')}
          >
            Request to join
          </Button>
          <p className="text-xs text-muted-foreground">
            Want to register a new corporate? <Link href="/corporate/onboard" className="hover:underline">Onboard your company →</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
