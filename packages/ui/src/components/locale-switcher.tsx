'use client';
import { Globe } from 'lucide-react';
import { useLocale } from '@addis/i18n';

export function LocaleSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <button
      onClick={() => setLocale(locale === 'en' ? 'am' : 'en')}
      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-secondary"
      aria-label="Switch language"
    >
      <Globe className="h-4 w-4" /> {locale === 'en' ? 'EN' : 'አማ'}
    </button>
  );
}
