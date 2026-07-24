// Phase 3 fix: i18n infrastructure for en + am (Amharic) locales.
// Full next-intl integration requires middleware.ts + [locale] routing,
// which is a larger refactor. This lightweight version provides a useT()
// hook that reads the locale from a cookie and returns the translation.
//
// Usage in a client component:
//   const t = useT();
//   <h1>{t('auth.login.title')}</h1>
//
// Usage in a server component:
//   const t = await getT();
//   <h1>{t('auth.login.title')}</h1>
//
// The locale is determined by the `locale` cookie (set by a language switcher
// in the UI). Default is 'en'.

import { cookies } from 'next/headers';
import en from '@/messages/en.json';
import am from '@/messages/am.json';

export type Locale = 'en' | 'am';
export const LOCALES: Locale[] = ['en', 'am'];
export const DEFAULT_LOCALE: Locale = 'en';

const messages: Record<Locale, any> = { en, am };

// Server-side locale getter. In Next.js 16, cookies() returns a Promise.
export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const locale = cookieStore.get('locale')?.value as Locale | undefined;
  return locale && LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

// Server-side translation function.
export async function getT() {
  const locale = await getLocale();
  const msgs = messages[locale];
  return function t(key: string): string {
    const parts = key.split('.');
    let val: any = msgs;
    for (const p of parts) {
      val = val?.[p];
      if (val === undefined) return key;  // fallback to key
    }
    return typeof val === 'string' ? val : key;
  };
}

// Client-side translation hook (reads cookie via document.cookie).
export function useT() {
  function getCookieLocale(): Locale {
    if (typeof document === 'undefined') return DEFAULT_LOCALE;
    const m = document.cookie.match(/(?:^|; )locale=([^;]*)/);
    const val = m ? decodeURIComponent(m[1]) : DEFAULT_LOCALE;
    return val === 'am' ? 'am' : 'en';
  }
  const locale = getCookieLocale();
  const msgs = messages[locale];
  return function t(key: string): string {
    const parts = key.split('.');
    let val: any = msgs;
    for (const p of parts) {
      val = val?.[p];
      if (val === undefined) return key;
    }
    return typeof val === 'string' ? val : key;
  };
}

// Set the locale cookie (called from a language switcher).
export function setLocale(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.cookie = `locale=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }
}
