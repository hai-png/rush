import { Hono } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Variables } from './context';

export class TypedHono extends Hono<{ Variables: Variables }> {}
export class TypedOpenAPIHono extends OpenAPIHono<{ Variables: Variables }> {}

export type TypedApp = TypedHono;
export type TypedOpenAPIApp = TypedOpenAPIHono;
