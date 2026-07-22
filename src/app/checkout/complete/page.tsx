import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

export default function CheckoutCompletePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md text-center space-y-4">
        <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
        <h1 className="text-2xl font-bold">Payment processing</h1>
        <p className="text-muted-foreground">
          Your payment is being confirmed. Your subscription will be activated shortly.
          Check your dashboard in a moment.
        </p>
        <Button asChild><Link href="/dashboard/rider">Go to dashboard</Link></Button>
      </div>
    </div>
  );
}
