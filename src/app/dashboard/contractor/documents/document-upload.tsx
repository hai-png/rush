'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Upload, RefreshCw } from 'lucide-react';

export function DocumentUpload({ type, hasExisting }: { type: string; hasExisting: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function upload(file: File) {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('type', type);
      formData.append('file', file);

      // Get CSRF token from cookie
      const csrf = (document.cookie.match(/addis-csrf=([^;]+)/) || [])[1] || '';
      const res = await fetch('/api/v1/contractor/documents', {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: formData,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
        throw new Error(err.error?.message ?? `HTTP ${res.status}`);
      }
      toast.success(hasExisting ? 'Document replaced' : 'Document uploaded');
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={onChange} className="hidden" />
      <Button
        size="sm"
        variant={hasExisting ? 'outline' : 'default'}
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        {loading ? (
          'Uploading…'
        ) : hasExisting ? (
          <><RefreshCw className="h-4 w-4 mr-1" /> Replace</>
        ) : (
          <><Upload className="h-4 w-4 mr-1" /> Upload</>
        )}
      </Button>
    </>
  );
}
