// cuid2-style ID generator. Falls back to crypto.randomUUID if @paralleldrive/cuid2 is unavailable.
export function createId(): string {
  return crypto.randomUUID();
}
