'use client';

// Phase 3 fix: language switcher for en/am locales. Sets the `locale` cookie
// and reloads the page so server components pick up the new locale.

import { setLocale, type Locale } from '@/lib/i18n';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function LanguageSwitcher() {
  function change(value: string) {
    setLocale(value as Locale);
    // Reload so server components re-read the cookie.
    window.location.reload();
  }

  return (
    <Select defaultValue="en" onValueChange={change}>
      <SelectTrigger className="w-[120px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="en">English</SelectItem>
        <SelectItem value="am">አማርኛ</SelectItem>
      </SelectContent>
    </Select>
  );
}
