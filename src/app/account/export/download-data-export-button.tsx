'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export function DownloadDataExportButton({ json, filename }: { json: string; filename: string }) {
  function download() {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Button onClick={download} variant="outline" size="sm">
      <Download className="h-4 w-4 mr-1" /> Download JSON
    </Button>
  );
}
