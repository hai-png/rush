import type { ErrorHandler } from 'hono';
import { toErrorEnvelope } from '@addis/shared';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const { status, body } = toErrorEnvelope(err, requestId);
  if (status >= 500) c.get('logger')?.error({ err, requestId }, 'unhandled error');
  return c.json(body, status as any);
};
