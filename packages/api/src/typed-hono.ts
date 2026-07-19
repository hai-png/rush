import { Hono } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Variables } from './context';

/**
 * Pre-typed Hono route classes — every module should use one of these instead of the
 * bare `Hono` or `OpenAPIHono` so `c.get('session')` / `c.get('requestId')` / `c.get('logger')`
 * are typed correctly across the whole codebase.
 *
 * - `TypedHono`       — for non-OpenAPI routes (admin, support, marketplace, etc.)
 * - `TypedOpenAPIHono` — for routes that declare zod-openapi route specs (subscription module)
 */
export class TypedHono extends Hono<{ Variables: Variables }> {}
export class TypedOpenAPIHono extends OpenAPIHono<{ Variables: Variables }> {}

/**
 * Convenience type aliases for inline use.
 */
export type TypedApp = TypedHono;
export type TypedOpenAPIApp = TypedOpenAPIHono;
