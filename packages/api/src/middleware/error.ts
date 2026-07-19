import type { ErrorHandler } from 'hono';
import { toErrorEnvelope } from '@addis/shared';
import type { Variables } from '../context';

type Env = { Variables: Variables };

export const errorHandler: ErrorHandler<Env> = (err, c) => {
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const { status, body } = toErrorEnvelope(err, requestId);
  if (status >= 500) c.get('logger')?.error({ err, requestId }, 'unhandled error');
  return c.json(body, status as any);
};
