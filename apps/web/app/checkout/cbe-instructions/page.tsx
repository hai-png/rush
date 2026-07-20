'use client';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, Button } from '@addis/ui';
import { Landmark, Copy, ArrowLeft } from 'lucide-react';

export default function CbeInstructionsPage() {
  const params = useSearchParams();
  const reference = params.get('ref') ?? '';
  const amount = params.get('amount') ?? '';

  const accountNumber = process.env.NEXT_PUBLIC_CBE_ACCOUNT_NUMBER ?? '1000200030004';
  const accountName = process.env.NEXT_PUBLIC_CBE_ACCOUNT_NAME ?? 'Addis Ride Pvt. Ltd.';
  const bankBranch = process.env.NEXT_PUBLIC_CBE_BANK_BRANCH ?? 'Bole Branch';

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
  };

  return (
    <div className="min-h-screen px-6 py-10 max-w-md mx-auto">
      <a href="/plans" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to plans
      </a>

      <div className="text-center mb-8">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Landmark className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">Bank transfer instructions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Transfer the exact amount to the account below, then wait for admin verification.
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Amount to transfer</p>
            <p className="text-2xl font-semibold">ETB {amount}</p>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-xs text-muted-foreground mb-1">Reference code (use as transfer memo)</p>
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono font-medium text-sm break-all">{reference}</p>
              <button onClick={() => copyToClipboard(reference)} aria-label="Copy reference" className="shrink-0">
                <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Bank</p>
              <p className="font-medium">Commercial Bank of Ethiopia</p>
              <p className="text-sm text-muted-foreground">{bankBranch}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Account number</p>
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono font-medium">{accountNumber}</p>
                <button onClick={() => copyToClipboard(accountNumber)} aria-label="Copy account number" className="shrink-0">
                  <Copy className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Account name</p>
              <p className="font-medium">{accountName}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl bg-warning/10 border border-warning/20 p-4 text-sm space-y-2">
        <p className="font-medium text-warning">How verification works</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>Make the transfer with the reference code above as the memo.</li>
          <li>Your subscription stays in "pending payment" until an admin verifies.</li>
          <li>Verification usually happens within 1 business hour.</li>
          <li>You'll get a notification once your subscription is active.</li>
        </ol>
      </div>

      <Button className="w-full mt-6" variant="outline" onClick={() => window.location.href = '/dashboard/rider'}>
        I've made the transfer
      </Button>
    </div>
  );
}
