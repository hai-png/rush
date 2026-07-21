// Contractor documents upload + management.
import Link from 'next/link';
import { requireRole } from '@/lib/session-server';
import { db } from '@/lib/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SignOutButton } from '@/components/sign-out-button';
import { DocumentUpload } from './document-upload';

const DOC_TYPES = [
  { type: 'registration', label: 'Business registration', description: 'Trade license or business registration certificate' },
  { type: 'insurance', label: 'Vehicle insurance', description: 'Current insurance policy for the shuttle' },
  { type: 'inspection', label: 'Vehicle inspection', description: 'Recent safety inspection certificate' },
];

export default async function ContractorDocumentsPage() {
  const session = await requireRole('contractor', 'platform_admin');
  const profile = await db.contractorProfile.findUnique({
    where: { userId: session.id },
    include: { documents: { include: { file: true } } },
  });
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card><CardContent className="py-6 text-center">No contractor profile found.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold">Addis Ride · Documents</Link>
          <div className="flex gap-2 items-center">
            <Button asChild variant="ghost"><Link href="/dashboard/contractor">Dashboard</Link></Button>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-2">Onboarding documents</h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Upload all three documents to complete verification. Current status: <Badge variant="outline">{profile.verificationStatus}</Badge>
        </p>

        <div className="space-y-4">
          {DOC_TYPES.map(({ type, label, description }) => {
            const doc = profile.documents.find(d => d.type === type);
            return (
              <Card key={type}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{description}</div>
                      {doc ? (
                        <div className="text-xs mt-2 space-y-1">
                          <div>Filename: <a href={`/api/v1/files/${doc.fileId}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">{doc.file.originalFilename}</a></div>
                          <div>Size: {(doc.file.sizeBytes / 1024).toFixed(1)} KB · uploaded {new Date(doc.uploadedAt).toLocaleDateString()}</div>
                          <div>SHA256: <code className="text-[10px]">{doc.file.checksumSha256.slice(0, 16)}…</code></div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground mt-2">Not uploaded yet.</div>
                      )}
                    </div>
                    <DocumentUpload type={type} hasExisting={!!doc} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mt-6 rounded-md border border-blue-500/30 bg-blue-500/5 p-4 text-sm">
          <strong>Verification flow:</strong> Once all three documents are uploaded, your status moves to
          <Badge variant="outline" className="mx-1">pending</Badge>. A platform admin reviews and either verifies or rejects with a reason.
          You'll get a notification either way.
        </div>
      </main>
    </div>
  );
}
