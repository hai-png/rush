#!/usr/bin/env bun
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/api-routes.ts'), 'utf-8');
const routeRegex = /r\('(GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/g;
const routes: Array<{ method: string; path: string }> = [];
let match;
while ((match = routeRegex.exec(source)) !== null) {
  routes.push({ method: match[1]!, path: match[2]! });
}

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

for (const entry of routes) {
  const path = entry.path.replace(/:([a-zA-Z_]+)/g, '{$1}');
  if (!spec.paths[path]) spec.paths[path] = {};
  const method = entry.method.toLowerCase();
  spec.paths[path][method] = {
    summary: `${entry.method} ${entry.path}`,
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [path.split('/')[1] || 'root'],
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
console.log(`  ${Object.keys(spec.paths).length} paths, ${routes.length} operations`);
