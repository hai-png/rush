// ToS accept gate — shown after signup or when session.tosVersion is stale.
import { requireSession } from '@/lib/session-server';
import { CURRENT_TOS_VERSION } from '@/lib/env';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { AcceptTosForm } from './accept-tos-form';

export default async function TosAcceptPage() {
  const session = await requireSession();
  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="max-w-2xl w-full bg-background border rounded-lg p-8">
        <h1 className="text-2xl font-bold mb-2">Terms of Service — v{CURRENT_TOS_VERSION}</h1>
        <p className="text-sm text-muted-foreground mb-6">Please review and accept to continue.</p>
        <div className="prose prose-sm max-w-none mb-6 space-y-3 text-foreground/90">
          <p>By using Addis Ride, you agree to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use only your own account and keep your credentials secure.</li>
            <li>Provide accurate information during registration.</li>
            <li>Use the seat marketplace honestly — only list seats you actually have.</li>
            <li>Pay for subscriptions via Telebirr or CBE Birr as agreed.</li>
            <li>Not abuse the service, including rate limits, refunds, or impersonation.</li>
            <li>Understand that all platform actions are recorded in an append-only audit log.</li>
          </ul>
          <p>We may update these terms; you'll be prompted to re-accept on your next sign-in.</p>
          <p>Contact: <span className="font-mono">dpo@addisride.et</span></p>
        </div>
        <AcceptTosForm />
      </div>
    </div>
  );
}
