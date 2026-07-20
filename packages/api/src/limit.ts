import { CursorQuery } from '@addis/shared';

export function parseLimit(raw: string | undefined): number {
  const parsed = CursorQuery.shape.limit.safeParse(raw);
  return parsed.success ? parsed.data : 20;
}
