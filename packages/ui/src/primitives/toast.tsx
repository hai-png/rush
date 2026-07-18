'use client';
import * as React from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type Toast = { id: string; title: string; description?: string; variant?: 'success' | 'error' | 'info' };
const ToastContext = React.createContext<{ push: (t: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((cur) => [...cur, { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
        {toasts.map((t) => (
          <div key={t.id} role="status" className="rounded-xl border border-border bg-card p-3 shadow-lg flex gap-3 items-start">
            {t.variant === 'success' && <CheckCircle2 className="h-5 w-5 text-success shrink-0" />}
            {t.variant === 'error' && <XCircle className="h-5 w-5 text-destructive shrink-0" />}
            {(!t.variant || t.variant === 'info') && <Info className="h-5 w-5 text-accent shrink-0" />}
            <div className="flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
            </div>
            <button onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
