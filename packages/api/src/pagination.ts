export function encodeCursor(id: string): string { return Buffer.from(JSON.stringify({ id })).toString('base64url'); }
export function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try { return JSON.parse(Buffer.from(cursor, 'base64url').toString()).id; } catch { return undefined; }
}
