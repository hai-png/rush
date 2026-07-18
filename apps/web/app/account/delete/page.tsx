'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@addis/shared';

export default function DeleteAccountPage() {
  const client = useApiClient();
  const [confirmed, setConfirmed] = useState(false);
  const [requested, setRequested] = useState(false);

  const submit = async () => {
    await client.POST('/api/v1/account/delete', { body: {} });
    setRequested(true);
  };

  if (requested) {
    return (
      <div className="px-6 py-16 text-center max-w-md mx-auto">
        <p className="font-semibold">Deletion requested</p>
        <p className="text-sm text-muted-foreground mt-2">
          Your account will be permanently deleted in {ACCOUNT_DELETION_GRACE_DAYS} days. Log in again before then to cancel.
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 py-16 max-w-md mx-auto text-center">
      <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
      <h1 className="font-semibold text-lg">Delete your account?</h1>
      <p className="text-sm text-muted-foreground mt-2">
        This starts a {ACCOUNT_DELETION_GRACE_DAYS}-day grace period. Payment records are retained 7 years per Ethiopian tax law, anonymized.
      </p>
      <label className="flex items-center gap-2 justify-center mt-4 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I understand this cannot be undone after the grace period.
      </label>
      <Button variant="destructive" className="mt-4" disabled={!confirmed} onClick={submit}>Request deletion</Button>
    </div>
  );
}
