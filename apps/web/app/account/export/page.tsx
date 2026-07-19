'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@addis/ui';

export default function AccountExportPage() {
  const [loading, setLoading] = useState(false);

  const download = async (format: 'json' | 'csv') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/account/export?format=${format}`);
      // FIX (WEB-015): The previous implementation always saved the file as
      // `.zip` regardless of format (the ternary `format === 'json' ? 'zip' : 'zip'`
      // was dead code — both branches produced `.zip`). The CSV endpoint
      // returns a ZIP too (the service always streams a zip archive), so the
      // extension is correct for both — but the dead ternary was misleading.
      // Also added: res.ok check so a 429 rate-limit response doesn't get
      // saved as a corrupt .zip of JSON error text.
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error?.message ?? `Export failed (HTTP ${res.status})`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `addis-ride-export-${format}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
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
