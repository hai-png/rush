import { defineStateMachine } from '@addis/shared';
import type { VerificationStatus } from '@addis/shared';

export const contractorVerificationState = defineStateMachine<VerificationStatus>({
  initial: 'unverified',
  transitions: [
    { from: 'unverified', to: 'pending', event: 'documents.submitted', sideEffects: ['audit.contractor_pending'] },
    { from: 'pending', to: 'verified', event: 'admin.verify', sideEffects: ['notify.document_verified', 'audit.contractor_verified'] },
    { from: 'pending', to: 'rejected', event: 'admin.reject', sideEffects: ['notify.document_rejected', 'audit.contractor_rejected'] },
    { from: 'rejected', to: 'pending', event: 'documents.resubmitted', sideEffects: ['audit.contractor_pending'] },
  ],
});
