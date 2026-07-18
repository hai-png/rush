import { z } from 'zod';
import { Id, TimeOfDay } from '@addis/shared';

export const CreateSubscriptionInput = z.object({
  planId: Id, routeId: Id,
  morningSlot: TimeOfDay.optional(), eveningSlot: TimeOfDay.optional(),
  paymentMethod: z.enum(['telebirr', 'cbe']),
  corporateMemberId: Id.optional(),
});
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInput> & { riderId: string };

/** What other modules are allowed to know about a subscription (not the raw row/service). */
export interface SubscriptionSummary {
  id: string; riderId: string; status: string; routeId: string | null;
  ridesUsed: number; ridesIncluded: number; endDate: Date;
}
