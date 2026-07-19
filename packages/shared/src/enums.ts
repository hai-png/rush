export type UserRole = 'rider' | 'contractor' | 'corporate_admin' | 'platform_admin';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type SubscriptionStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded' | 'partially_refunded';
export type PaymentMethod = 'telebirr' | 'cbe';
export type RefundStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'permanent_failure';
export type TripStatus = 'scheduled' | 'in_transit' | 'completed' | 'cancelled';
export type RideStatus = 'booked' | 'boarded' | 'completed' | 'no_show' | 'cancelled';
export type SeatReleaseStatus = 'open' | 'claimed' | 'expired' | 'cancelled';
export type SeatClaimStatus = 'confirmed' | 'used' | 'no_show' | 'refunded';
export type SeatWindow = 'morning' | 'evening';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketCategory = 'general' | 'billing' | 'route' | 'shuttle' | 'account' | 'corporate' | 'other';
export type FaqCategory = 'billing' | 'routes' | 'shuttle' | 'account' | 'corporate' | 'general';
export type NotificationType =
  | 'payment_received' | 'payment_failed' | 'refund_completed' | 'refund_failed'
  | 'seat_claimed' | 'seat_released' | 'seat_release_expired'
  | 'subscription_expiring' | 'subscription_expired' | 'subscription_cancelled'
  | 'trip_departing' | 'document_verified' | 'document_rejected'
  | 'support_reply' | 'support_resolved'
  | 'corporate_member_added' | 'corporate_member_removed' | 'corporate_reset'
  | 'general';
export type OtpPurpose = 'signup_verification' | 'password_reset' | 'phone_change';
export type VehicleType = 'coaster' | 'minibus' | 'van' | 'sedan';
export type OutboxChannel = 'notification' | 'sms' | 'push' | 'email' | 'refund' | 'audit' | 'webhook';
export type DocumentScanStatus = 'pending' | 'clean' | 'infected' | 'error';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ContractorDocumentType = 'registration' | 'insurance' | 'inspection';
export type OutboxEventStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'dead';

export const ALL_ROLES: UserRole[] = ['rider', 'contractor', 'corporate_admin', 'platform_admin'];
export const TWO_FA_REQUIRED_ROLES: UserRole[] = ['platform_admin', 'corporate_admin'];
