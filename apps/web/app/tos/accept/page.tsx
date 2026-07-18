'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { CURRENT_TOS_VERSION } from '@addis/shared';

export default function TosAcceptPage() {
  const client = useApiClient();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    setLoading(true);
    await client.POST('/api/v1/tos', { body: { version: CURRENT_TOS_VERSION } });
    router.back();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-xl font-semibold">Our Terms of Service have been updated</h1>
        <p className="text-sm text-muted-foreground">
          Please review the updated <a href="/legal/terms" target="_blank" className="text-accent underline">Terms of Service</a> and
          {' '}<a href="/legal/privacy" target="_blank" className="text-accent underline">Privacy Policy</a> to continue using Addis Ride.
        </p>
        <Button onClick={accept} loading={loading}>I accept the updated terms</Button>
      </div>
    </div>
  );
}
