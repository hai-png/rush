'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileDropzone, Card, CardContent, Badge } from '@addis/ui';
import { useApiClient } from '@/lib/sdk';

const DOC_TYPES = [
  { key: 'registration', label: 'Vehicle registration' },
  { key: 'insurance', label: 'Insurance certificate' },
  { key: 'inspection', label: 'Inspection certificate' },
] as const;

export default function ContractorDocumentsPage() {
  const client = useApiClient();
  const qc = useQueryClient();
  const { data: docs } = useQuery({ queryKey: ['contractor-docs'], queryFn: async () => (await client.GET('/api/v1/contractors/documents')).data });

  const upload = useMutation({
    mutationFn: async ({ type, file }: { type: string; file: File }) => {
      const form = new FormData();
      form.append('type', type); form.append('file', file);
      return fetch('/api/v1/contractors/documents', { method: 'POST', body: form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contractor-docs'] }),
  });

  const uploadedTypes = new Set((docs ?? []).map((d: any) => d.type));

  return (
    <div className="px-5 py-6 max-w-md mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Verification documents</h1>
      {DOC_TYPES.map((dt) => (
        <div key={dt.key}>
          {uploadedTypes.has(dt.key) ? (
            <Card><CardContent className="flex items-center justify-between">
              <span className="text-sm">{dt.label}</span>
              <Badge variant="success">Uploaded</Badge>
            </CardContent></Card>
          ) : (
            <FileDropzone label={dt.label} onFile={(file) => upload.mutate({ type: dt.key, file })} />
          )}
        </div>
      ))}
    </div>
  );
}
