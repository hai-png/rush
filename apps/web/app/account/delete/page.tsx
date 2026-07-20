'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Input, Label, FieldError, toast } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@addis/shared';

export default function DeleteAccountPage() {
  const client = useApiClient();
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState('');
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {

    if (!password) {
      setError('Password is required to confirm deletion');
      return;
    }
    setLoading(true);
    setError(null);
    try {

      const { error: apiError } = await client.POST('/api/v1/account/delete', {
        body: { password },
      });
      if (apiError) {
        setError(apiError.message ?? 'Password incorrect');
        toast({ title: 'Deletion failed', variant: 'destructive' });
        return;
      }
      setRequested(true);
    } catch (e) {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
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
    <div className="px-6 py-16 max-w-md mx-auto">
      <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
      <h1 className="font-semibold text-lg text-center">Delete your account?</h1>
      <p className="text-sm text-muted-foreground mt-2 text-center">
        This starts a {ACCOUNT_DELETION_GRACE_DAYS}-day grace period. Payment records are retained 7 years per Ethiopian tax law, anonymized.
      </p>
      <div className="mt-6 space-y-3">
        <div>
          <Label htmlFor="password">Enter your password to confirm</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I understand this cannot be undone after the grace period.
        </label>
        {error && <FieldError>{error}</FieldError>}
        <Button
          variant="destructive"
          className="w-full"
          disabled={!confirmed || !password || loading}
          loading={loading}
          onClick={submit}
        >
          Request deletion
        </Button>
      </div>
    </div>
  );
}
