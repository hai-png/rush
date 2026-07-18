import { writeFileSync } from 'node:fs';
import { app } from '../src/app';

const doc = app.getOpenAPIDocument({
  openapi: '3.1.0',
  info: { title: 'Addis Ride API', version: '1.0.0' },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: '__Secure-session-token' },
    },
  },
});
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(doc, null, 2));
console.log('OpenAPI spec written to packages/api/openapi.json');
