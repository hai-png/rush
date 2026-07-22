import Link from 'next/link';
import { requireSession } from '@/lib/session-server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DeleteButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function AccountDeletePage() {
  await requireSession();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/account" className="text-sm text-muted-foreground hover:text-foreground mb-2">← Back to account</Link>
          <CardTitle className="text-red-600">Delete account</CardTitle>
          <CardDescription>This will soft-delete your account. Your phone, email, and name will be anonymized. Financial records are kept for audit. You can sign out and the account will be inaccessible immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteButton />
        </CardContent>
      </Card>
    </div>
  );
}
