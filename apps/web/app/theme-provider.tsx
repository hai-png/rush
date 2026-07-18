'use client';
import { createContext, useContext, useState, useCallback } from 'react';

const ThemeContext = createContext<{ theme: string; toggle: () => void } | null>(null);
export function ThemeProvider({ children, initialTheme }: { children: React.ReactNode; initialTheme: string }) {
  const [theme, setTheme] = useState(initialTheme);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      document.cookie = `addis-ride-theme=${next}; path=/; max-age=31536000`;
      return next;
    });
  }, []);
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
