'use client';

import { useEffect } from 'react';

let csrfPromise: Promise<void> | null = null;

export function ensureCsrf(): Promise<void> {
  if (csrfPromise) return csrfPromise;
  csrfPromise = fetch('/api/v1/health', { credentials: 'same-origin' })
    .then(() => undefined)
    .catch(() => undefined);
  return csrfPromise;
}

export function CsrfInitializer() {
  useEffect(() => {
    ensureCsrf();
  }, []);
  return null;
}