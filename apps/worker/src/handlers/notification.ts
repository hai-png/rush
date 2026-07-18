// this handler exists for events raised directly by services (e.g. 'notify.payment_received' side effects)
import { engagementService } from '@addis/api/modules/engagement/service';

export async function handle(payload: { type: string; userId: string; [k: string]: unknown }) {
  await engagementService.dispatch({ userId: payload.userId, type: payload.type as any, title: '', body: '', data: payload });
}
