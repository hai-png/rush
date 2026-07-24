import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const specPath = resolve(process.cwd(), 'openapi.json');
    const spec = readFileSync(specPath, 'utf-8');
    return Response.json(JSON.parse(spec));
  } catch {
    return Response.json({
      openapi: '3.0.0',
      info: { title: 'Addis Ride API', version: '1.0.0' },
      paths: {},
      message: 'Run `bun run openapi:gen` to generate the full spec.',
    });
  }
}
