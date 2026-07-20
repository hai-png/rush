'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Button } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { useToast } from '@addis/ui';
import { CURRENT_TOS_VERSION } from '@addis/shared';

export default function TosAcceptPage() {
  const client = useApiClient();
  const router = useRouter();
  const { push } = useToast();
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    setLoading(true);
    const { error } = await client.POST('/api/v1/tos', { body: { version: CURRENT_TOS_VERSION } });
    setLoading(false);
    if (error) {
      push({ title: error.message ?? 'Could not accept terms — please try again', variant: 'error' });
      return;
    }

    router.push('/dashboard/rider');
  };

  const decline = async () => {

    await signOut({ callbackUrl: '/login?reason=tos_declined' });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">Our Terms of Service have been updated</h1>
        <p className="text-sm text-muted-foreground">
          Please review the updated <a href="/legal/terms" target="_blank" rel="noopener" className="text-accent underline">Terms of Service</a> and
          {' '}<a href="/legal/privacy" target="_blank" rel="noopener" className="text-accent underline">Privacy Policy</a> to continue using Addis Ride.
        </p>
        <div className="flex gap-3 justify-center pt-4">
          <Button onClick={accept} loading={loading}>I accept the updated terms</Button>
          <Button variant="outline" onClick={decline} disabled={loading}>Decline and log out</Button>
        </div>
        <p className="text-xs text-muted-foreground pt-2">
          Declining logs you out. Your account remains intact; you can return to accept the terms at any time.
        </p>
      </div>
    </div>
  );
}
