import type { ApiContext, ApiHandler } from '@/lib/api';

// C-25 / H-25 fix: standardized handler input types that can be used
// incrementally across all ~150 handlers. Start by importing the specific
// shape needed (e.g. HandlerBody, HandlerParams, etc.) and swapping the
// `: any` parameter.
//
// Usage:
//   export async function GET_foo(ctx: Handler<{ id: string }>) {
//     const { session, params: { id } } = ctx;
//   }

export type Handler<I = unknown> = ApiContext & {
  body: I;
  params: Record<string, string>;
  query: Record<string, string>;
};

export type HandlerSession = Pick<ApiContext, 'requestId' | 'session'>;

export type HandlerSessionIp = Pick<ApiContext, 'requestId' | 'session' | 'ipAddress' | 'userAgent'>;

export type HandlerBody<I> = HandlerSessionIp & { body: I };

export type HandlerParams = HandlerSessionIp & { params: Record<string, string> };

export type HandlerBodyParams<I> = HandlerSessionIp & { body: I; params: Record<string, string> };

export type HandlerQuery = HandlerSessionIp & { query: Record<string, string> };
