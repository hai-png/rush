'use client';

// Fetches a GET API endpoint on mount to ensure the CSRF cookie is set.
// Without this, the first POST from a browser will fail with "CSRF token missing".
import { useEffect } from 'react';

export function CsrfInitializer() {
  useEffect(() => {
    fetch('/api/v1/plans', { credentials: 'same-origin' }).catch(() => {
      // ignore — just here for the side effect of setting the cookie
    });
  }, []);
  return null;
}
