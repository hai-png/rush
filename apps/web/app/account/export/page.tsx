'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@addis/ui';

export default function AccountExportPage() {
  const [loading, setLoading] = useState(false);

  const download = async (format: 'json' | 'csv') => {
    setLoading(true);
    // The API currently always streams a ZIP (archiver) regardless of the ?format= query
    // parameter, so the local filename is always .zip — but we keep the format param on
    // the request so a future server-side CSV path can be added without changing the UI.
    const res = await fetch(`/api/v1/account/export?format=${format}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `addis-ride-export-${format}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setLoading(false);
  };

  return (
    <div className="px-6 py-16 max-w-md mx-auto text-center space-y-4">
      <Download className="h-8 w-8 mx-auto text-primary" />
      <h1 className="font-semibold text-lg">Export your data</h1>
      <p className="text-sm text-muted-foreground">
        Download a full copy of your profile, subscriptions, payments, rides, and support tickets — per Ethiopia's Data Protection Proclamation.
      </p>
      <div className="flex gap-3 justify-center">
        <Button loading={loading} onClick={() => download('json')}>Download JSON</Button>
        <Button variant="outline" loading={loading} onClick={() => download('csv')}>Download CSV</Button>
      </div>
    </div>
  );
}
