'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';

// FE-059: the settings table is a generic key/value store, so without a
// client-side allowlist an admin could write arbitrary keys (typos, internal
// names, anything). This allowlist mirrors the keys the backend actually
// reads, so the form refuses to submit unknown keys with an inline error
// before the request is sent. The backend should still re-validate
// server-side — this is defense-in-depth plus a better UX.
const ALLOWED_SETTING_KEYS = new Set<string>([
  'otp_expiry_seconds',
  'telebirr_merchant_id',
  'corporate_billing_enabled',
  'auto_rollover_enabled',
  'support_email',
  'tos_version',
  'maintenance_mode',
]);

export function SettingsForm() {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/api/v1/admin/settings').then(d => setSettings(d || {})).catch(() => {});
  }, []);

  // Validate the key against the allowlist on every keystroke so the user
  // gets immediate inline feedback and the Save button stays disabled.
  function validateKey(k: string): string | null {
    if (!k) return null; // empty is handled by the save-button disabled state
    if (!ALLOWED_SETTING_KEYS.has(k)) {
      return `Unknown setting key "${k}". Allowed: ${Array.from(ALLOWED_SETTING_KEYS).join(', ')}.`;
    }
    return null;
  }

  function onKeyChange(v: string) {
    setNewKey(v);
    setKeyError(validateKey(v));
  }

  async function save() {
    const err = validateKey(newKey);
    if (err) {
      setKeyError(err);
      return;
    }
    setLoading(true);
    try {
      await api.put('/api/v1/admin/settings', { key: newKey, value: newValue });
      toast.success('Setting saved');
      setSettings({ ...settings, [newKey]: newValue });
      setNewKey(''); setNewValue(''); setKeyError(null);
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
        <div>
          <Label htmlFor="setting-key">Key</Label>
          <Input
            id="setting-key"
            value={newKey}
            onChange={e => onKeyChange(e.target.value)}
            placeholder="e.g. otp_expiry_seconds"
            aria-invalid={!!keyError}
            list="setting-key-suggestions"
          />
          {/* Suggest allowed keys so admins don't have to memorise them. */}
          <datalist id="setting-key-suggestions">
            {Array.from(ALLOWED_SETTING_KEYS).map(k => <option key={k} value={k} />)}
          </datalist>
          {keyError && <p className="text-xs text-destructive mt-1">{keyError}</p>}
        </div>
        <div><Label htmlFor="setting-value">Value</Label><Input id="setting-value" value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="e.g. 40" /></div>
        <Button onClick={save} disabled={loading || !newKey || !!keyError}>{loading ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  );
}
