import { z } from 'zod';

export const Id = z.string().cuid2();
export const EthiopianPhone = z.string().regex(/^\+251(9|7)\d{8}$/, 'Must be a valid Ethiopian phone (+2519XXXXXXXX)');
export const MoneyString = z.string().regex(/^\d+(\.\d{2})?$/, 'Must be ETB amount with 2dp');
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h');
export const CursorQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(), message: z.string(),
    details: z.array(z.any()).optional(),
    requestId: z.string(),
  }),
});
export function envelope<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: schema, meta: z.object({ cursor: z.string().optional(), limit: z.number(), total: z.number().optional() }).optional() });
}
