import { engagementService } from '@addis/api/modules/engagement/service';
import { schema } from '@addis/db';

export async function handle(
  payload: { type: string; userId: string; [k: string]: unknown },
  _evt?: typeof schema.outboxEvents.$inferSelect,
) {
  await engagementService.dispatch({
    userId: payload.userId,
    type: payload.type as any,

    data: payload,
  } as any);
}
