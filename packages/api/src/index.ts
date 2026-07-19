// Barrel export for @addis/api — re-exports the Hono app so the web app's
// route handler can do `import { app } from '@addis/api'`.
export { app, type App } from './app';
