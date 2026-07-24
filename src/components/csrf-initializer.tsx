'use client';

// H-32 fix: Expose an ensureCsrf() promise that resolves once the CSRF cookie
// is set. apiFetch awaits this before any non-safe request so a fast-typing
// user (or password manager autofill) can't POST before the cookie exists.
//
// Previously, CsrfInitializer fired fetch('/api/v1/plans') on mount and the
// login form could POST before that resolved, causing "CSRF token missing"
// errors on the most common POST in the app.

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
