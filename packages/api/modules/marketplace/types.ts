import { z } from 'zod';
import { Id } from '@addis/shared';

export const CreateSeatReleaseInput = z.object({
  subscriptionId: Id,
  releaseDate: z.string().date(),
  window: z.enum(['morning', 'evening']),
});
export const ClaimSeatInput = z.object({
  seatReleaseId: Id,
  paymentMethod: z.enum(['telebirr', 'cbe']),
});
