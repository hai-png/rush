// This handler exists for events raised directly by services (e.g.
// 'notify.payment_received' side effects that weren't pre-rendered).
//
// The notification handler dispatches via engagementService.dispatch(). The
// dispatch function will call renderTemplate() to produce a title/body from
// the notification type + data when the envelope doesn't include them — so
// we deliberately pass undefined (not empty string) to trigger the template
// path. Passing empty strings would bypass the template and store an empty
// notification row.
import { engagementService } from '@addis/api/modules/engagement/service';

export async function handle(payload: { type: string; userId: string; [k: string]: unknown }) {
  await engagementService.dispatch({
    userId: payload.userId,
    type: payload.type as any,
    // Intentionally omit title/body — dispatch() will renderTemplate() from
    // the notification type + payload.data. The previous implementation
    // passed `title: '', body: ''` which (under the falsy check) was treated
    // as "no title/body provided" and triggered renderTemplate anyway, but
    // under the nullish check it would store empty strings. Omitting the
    // fields entirely is the unambiguous way to request template rendering.
    data: payload,
  } as any);
}
