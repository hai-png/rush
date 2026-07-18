import type { NotificationType } from '@addis/shared';

const EN: Record<NotificationType, (d: any) => { title: string; body: string }> = {
  payment_received: () => ({ title: 'Payment received', body: 'Your payment was successful. Your subscription is now active.' }),
  payment_failed: () => ({ title: 'Payment failed', body: 'We could not process your payment. Please try again.' }),
  refund_completed: () => ({ title: 'Refund completed', body: 'Your refund has been processed.' }),
  refund_failed: () => ({ title: 'Refund failed', body: 'We had trouble processing your refund. Support has been notified.' }),
  seat_claimed: () => ({ title: 'Seat claimed', body: 'Someone claimed your released seat. Your refund is on the way.' }),
  seat_released: () => ({ title: 'Seat released', body: 'Your seat is now listed on the open-seats board.' }),
  seat_release_expired: () => ({ title: 'Release expired', body: 'Your released seat expired unclaimed.' }),
  subscription_expiring: (d) => ({ title: 'Subscription expiring soon', body: `Your subscription expires in ${d?.daysLeft ?? 'a few'} days.` }),
  subscription_expired: () => ({ title: 'Subscription expired', body: 'Your subscription has expired. Renew to keep riding.' }),
  subscription_cancelled: () => ({ title: 'Subscription cancelled', body: 'Your subscription has been cancelled.' }),
  trip_departing: () => ({ title: 'Trip departing soon', body: 'Your shuttle is departing shortly.' }),
  document_verified: () => ({ title: 'Documents verified', body: 'Your contractor documents were verified. You can now run trips.' }),
  document_rejected: (d) => ({ title: 'Documents rejected', body: d?.reason ?? 'Your documents were rejected. Please resubmit.' }),
  support_reply: () => ({ title: 'New reply on your ticket', body: 'Support replied to your ticket.' }),
  support_resolved: () => ({ title: 'Ticket resolved', body: 'Your support ticket has been resolved.' }),
  corporate_member_added: () => ({ title: 'Welcome to your corporate plan', body: 'You have been added to your employer\'s subsidy plan.' }),
  corporate_member_removed: () => ({ title: 'Corporate membership removed', body: 'You are no longer part of your employer\'s subsidy plan.' }),
  corporate_reset: () => ({ title: 'Monthly allowance reset', body: 'Your corporate ride allowance has been reset for this month.' }),
  general: (d) => ({ title: d?.title ?? 'Addis Ride', body: d?.body ?? '' }),
};

const AM: Partial<Record<NotificationType, (d: any) => { title: string; body: string }>> = {
  payment_received: () => ({ title: 'ክፍያ ተቀብለናል', body: 'ክፍያዎ ተሳክቷል። የደንበኝነት ምዝገባዎ አሁን ገቢራዊ ነው።' }),
  subscription_expired: () => ({ title: 'የደንበኝነት ምዝገባ አልቋል', body: 'የደንበኝነት ምዝገባዎ አልቋል። ለመቀጠል እድሳት ያድርጉ።' }),
};

export function renderTemplate(type: NotificationType, locale: 'en' | 'am', data?: Record<string, unknown>) {
  const fn = (locale === 'am' ? AM[type] : undefined) ?? EN[type];
  return fn(data);
}
