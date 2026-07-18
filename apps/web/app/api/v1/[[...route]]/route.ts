import { handle } from 'hono/vercel';
import { app } from '@addis/api';

export const runtime = 'nodejs'; // telebirr RSA signing needs Node crypto
export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
