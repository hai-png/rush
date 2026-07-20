'use client';
import { useCallback, useState } from 'react';
import { UploadCloud, FileText, X } from 'lucide-react';
import { cn } from '../lib/cn';

// FE-009: validate MIME type client-side in addition to the extension. The
// server already sniffs via fileTypeFromBuffer, but giving early feedback
// saves a round-trip and makes the error clearer to the user.
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export function FileDropzone({ onFile, accept = '.pdf,.jpg,.jpeg,.png', maxSizeMb = 10, label }: {
  onFile: (file: File) => void; accept?: string; maxSizeMb?: number; label: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handle = useCallback((f: File) => {
    if (f.size > maxSizeMb * 1024 * 1024) { setError(`File exceeds ${maxSizeMb}MB`); return; }
    if (f.type && !ALLOWED_MIME.has(f.type)) {
      setError(`Only PDF, JPEG, PNG allowed (detected ${f.type || 'unknown'})`);
      return;
    }
    setError(null); setFile(f); onFile(f);
  }, [maxSizeMb, onFile]);

  return (
    <div>
      <p className="text-sm font-medium mb-1.5">{label}</p>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
        className={cn('rounded-xl border-2 border-dashed p-6 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border')}
      >
        {file ? (
          <div className="flex items-center justify-center gap-2 text-sm">
            <FileText className="h-4 w-4" /> {file.name}
            <button onClick={() => setFile(null)} aria-label="Remove file"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <label className="cursor-pointer flex flex-col items-center gap-2">
            <UploadCloud className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Drag & drop or click to upload (PDF, JPG, PNG — max {maxSizeMb}MB)</span>
            <input type="file" accept={accept} className="hidden" onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
          </label>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
