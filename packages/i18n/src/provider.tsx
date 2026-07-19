'use client';
import { IntlProvider, useIntl } from 'react-intl';
import { createContext, useContext, useState, useCallback } from 'react';
import en from '../locales/en.json';
import am from '../locales/am.json';

const MESSAGES = { en: flatten(en), am: flatten(am) };
function flatten(obj: any, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'object' ? { ...acc, ...flatten(v, key) } : { ...acc, [key]: v as string };
  }, {} as Record<string, string>);
}

type Locale = 'en' | 'am';
const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void } | null>(null);

export function I18nProvider({ children, initialLocale = 'en' }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    // FIX (I18N-001): The previous implementation unconditionally accessed
    // `document.cookie` and `document.documentElement.lang`. This provider is
    // imported by BOTH web (apps/web) and mobile (apps/mobile). On React
    // Native, `document` is undefined, so the language switcher in the mobile
    // settings screen threw `ReferenceError: document is not defined` and
    // crashed the app. Guard for platform — mobile persistence is handled by
    // the settings-store (AsyncStorage), so we only need to set the cookie
    // and lang attribute on web.
    if (typeof document !== 'undefined') {
      document.cookie = `addis-ride-locale=${l}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
      if (typeof document.documentElement !== 'undefined') {
        document.documentElement.lang = l;
      }
    }
  }, []);
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <IntlProvider locale={locale} messages={MESSAGES[locale]} onError={() => {}}>
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}
export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within I18nProvider');
  return ctx;
}
export function useFormatMoney() {
  const { locale } = useLocale();
  return (amount: string | number) =>
    new Intl.NumberFormat(locale === 'am' ? 'am-ET' : 'en-ET', { style: 'currency', currency: 'ETB' }).format(Number(amount));
}
export function useT() {
  const intl = useIntl();
  return (id: string, values?: Record<string, any>) => intl.formatMessage({ id }, values);
}
