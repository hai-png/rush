import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

// Load the font with next/font so the --font-geist-sans CSS variable referenced
// in globals.css is defined. The `geist` package isn't in package.json, so we
// use next/font/google's Inter as the variable's source. The CSS variable name
// (--font-geist-sans) is kept to avoid churn in globals.css. next/font handles
// subsetting, preloading, and font-display.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Addis Ride',
  description: 'Shuttle subscription platform for Addis Ababa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
