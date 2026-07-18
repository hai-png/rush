import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { Providers } from './providers';
import '@addis/ui/tokens.css';
import './globals.css';

export const metadata: Metadata = { title: 'Addis Ride', description: 'Subscription commuting for Addis Ababa' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get('addis-ride-theme')?.value ?? 'dark';
  const locale = cookieStore.get('addis-ride-locale')?.value
    ?? ((await headers()).get('accept-language')?.startsWith('am') ? 'am' : 'en');

  return (
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <body>
        <Providers initialLocale={locale as 'en' | 'am'} initialTheme={theme as 'dark' | 'light'}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
