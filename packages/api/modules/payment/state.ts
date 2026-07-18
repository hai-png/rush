import { defineStateMachine } from '@addis/shared';
import type { PaymentStatus } from '@addis/shared';

export const paymentState = defineStateMachine<PaymentStatus>({
  initial: 'pending',
  transitions: [
    { from: 'pending', to: 'completed', event: 'webhook.settled', sideEffects: ['notify.payment_received', 'audit.payment_settled'] },
    { from: 'pending', to: 'failed', event: 'webhook.failed', sideEffects: ['notify.payment_failed'] },
    { from: 'completed', to: 'refunded', event: 'refund.succeeded', sideEffects: ['notify.refund_completed', 'subscription.decrement_rides'] },
    { from: 'completed', to: 'partially_refunded', event: 'refund.partial_succeeded', sideEffects: ['notify.refund_completed'] },
  ],
});
