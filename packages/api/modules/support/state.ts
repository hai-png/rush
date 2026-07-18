import { defineStateMachine } from '@addis/shared';
import type { TicketStatus } from '@addis/shared';

export const ticketState = defineStateMachine<TicketStatus>({
  initial: 'open',
  transitions: [
    { from: 'open', to: 'in_progress', event: 'staff.replied', sideEffects: ['notify.support_reply'] },
    { from: 'in_progress', to: 'resolved', event: 'staff.resolved', sideEffects: ['notify.support_resolved'] },
    { from: 'open', to: 'resolved', event: 'staff.resolved', sideEffects: ['notify.support_resolved'] },
    { from: 'resolved', to: 'closed', event: 'auto.close', sideEffects: [] },
    { from: 'resolved', to: 'open', event: 'user.reopened', sideEffects: [] },
    { from: 'closed', to: 'open', event: 'user.reopened', sideEffects: [] },
  ],
});
