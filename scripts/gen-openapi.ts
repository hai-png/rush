#!/usr/bin/env bun
// Generate an OpenAPI 3.1 spec from the route table.
// Output: openapi.json (in repo root)
//
// Phase 3 fix: import ROUTES directly from api-routes.ts instead of regex-
// parsing the source. This is more robust and picks up route options
// (requireAuth, requireRole) for richer OpenAPI metadata.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES } from '../src/lib/api-routes';

const spec: any = {
  openapi: '3.1.0',
  info: {
    title: 'Addis Ride API',
    version: '1.0.0',
    description: 'Shuttle subscription platform for Addis Ababa.',
  },
  servers: [
    { url: 'http://localhost:3000/api/v1', description: 'Local dev' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'addis-session' },
    },
  },
  paths: {},
};

for (const entry of ROUTES) {
  const path = entry.pattern.source
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\(\[\^\/\]\+\)/g, (m, _, offset, str) => {
      // Replace capture groups with {paramName} — need to track param names
      return `{${entry.paramNames.shift()}}`;
    });
  // Rebuild path with param names (the above shift approach is fragile; do it properly)
  let pathStr = entry.pattern.source.replace(/^\^/, '').replace(/\$$/, '');
  const paramNames = [...entry.paramNames];
  pathStr = pathStr.replace(/\(\[\^\/\]\+\)/g, () => `{${paramNames.shift()}}`);

  if (!spec.paths[pathStr]) spec.paths[pathStr] = {};
  const method = entry.method.toLowerCase();
  const security: any[] = [];
  if (entry.options.requireAuth) {
    security.push({ bearerAuth: [] }, { cookieAuth: [] });
  }
  spec.paths[pathStr][method] = {
    summary: `${entry.method} ${pathStr}`,
    security: security.length > 0 ? security : undefined,
    tags: [pathStr.split('/')[1] || 'root'],
    responses: {
      '200': { description: 'Success' },
      '401': { description: 'Unauthorized' },
      '403': { description: 'Forbidden' },
    },
  };
}

const outputPath = join(process.cwd(), 'openapi.json');
writeFileSync(outputPath, JSON.stringify(spec, null, 2));
console.log(`OpenAPI spec written to ${outputPath}`);
console.log(`  ${Object.keys(spec.paths).length} paths, ${ROUTES.length} operations`);
