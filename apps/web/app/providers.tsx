'use client';
import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { I18nProvider } from '@addis/i18n';
import { ToastProvider } from '@addis/ui';
import { ThemeProvider } from './theme-provider';
import { setQueryClientForSdk } from '@/lib/sdk';

export function Providers({ children, initialLocale, initialTheme }: {
  children: React.ReactNode; initialLocale: 'en' | 'am'; initialTheme: 'dark' | 'light';
}) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 }, mutations: { retry: 0 } },
  }));

  // FE-008: expose the active QueryClient to the SDK's onUnauthorized
  // callback (apps/web/lib/sdk.ts) so a 401 can clear cached
  // authenticated data after signOut. Cleared on unmount.
  useEffect(() => {
    setQueryClientForSdk(queryClient);
    return () => setQueryClientForSdk(null);
  }, [queryClient]);

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider initialTheme={initialTheme}>
          <I18nProvider initialLocale={initialLocale}>
            <ToastProvider>{children}</ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
