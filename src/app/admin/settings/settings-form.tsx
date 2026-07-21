'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

export function SettingsForm() {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  useEffect(() => {
    api.get('/api/v1/admin/settings').then(d => setSettings(d || {})).catch(() => {});
  }, []);

  async function save() {
    setLoading(true);
    try {
      await api.put('/api/v1/admin/settings', { key: newKey, value: newValue });
      toast.success('Setting saved');
      setSettings({ ...settings, [newKey]: newValue });
      setNewKey(''); setNewValue('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {Object.keys(settings).length > 0 && (
        <div className="space-y-1">
          <div className="text-sm font-medium">Current settings</div>
          {Object.entries(settings).map(([k, v]) => (
            <div key={k} className="text-xs flex justify-between bg-muted p-2 rounded">
              <span className="font-mono">{k}</span><span>{v}</span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2 border-t pt-4">
        <div className="text-sm font-medium">Add/update setting</div>
        <div><Label>Key</Label><Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="e.g. max_rides_per_day" /></div>
        <div><Label>Value</Label><Input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="e.g. 40" /></div>
        <Button onClick={save} disabled={loading || !newKey}>{loading ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}
