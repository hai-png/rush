import type { NotificationType } from '@addis/shared';

export type NotificationEnvelope = {
  userId: string; type: NotificationType; title: string; body: string;
  link?: string; data?: Record<string, unknown>; locale?: 'en' | 'am';
};
export type ChannelKey = 'inApp' | 'push' | 'sms' | 'email';
export const CRITICAL_TYPES: NotificationType[] = ['payment_failed', 'document_rejected', 'refund_failed'];
