'use client';

import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { CsrfInitializer } from '@/components/csrf-initializer';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  }));

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={client}>
        <CsrfInitializer />
        {children}
      </QueryClientProvider>
      <Toaster richColors position="bottom-right" toastOptions={{ duration: 6000 }} />
    </ThemeProvider>
  );
}
