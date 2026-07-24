-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'rider',
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tosVersion" TEXT,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RiderProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "homeArea" TEXT NOT NULL,
    "workArea" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RiderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractorProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "experienceYears" INTEGER NOT NULL DEFAULT 0,
    "rating" REAL NOT NULL DEFAULT 5.0,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "verificationReason" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContractorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractorProfile_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Corporate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "subsidyPercent" INTEGER NOT NULL DEFAULT 50,
    "monthlySeatAllowance" INTEGER NOT NULL DEFAULT 20,
    "adminUserId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Corporate_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CorporateMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corporateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'pending',
    "ridesUsedThisMonth" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CorporateMember_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "Corporate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CorporateMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "lastSeenAt" DATETIME,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" DATETIME NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TosAcceptance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "acceptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TosAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "ridesIncluded" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "distanceKm" REAL NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "fareCents" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PickupLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "estimatedPickupTime" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickupLocation_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shuttle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractorId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shuttle_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "shuttleId" TEXT NOT NULL,
    "driverId" TEXT,
    "departureAt" DATETIME NOT NULL,
    "seatsBooked" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "window" TEXT NOT NULL,
    "assignmentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trip_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trip_shuttleId_fkey" FOREIGN KEY ("shuttleId") REFERENCES "Shuttle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Trip_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RouteAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RouteAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "shuttleId" TEXT NOT NULL,
    "monthStart" DATETIME NOT NULL,
    "monthEnd" DATETIME NOT NULL,
    "schedulePattern" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "maxSeats" INTEGER NOT NULL DEFAULT 0,
    "seatsBooked" INTEGER NOT NULL DEFAULT 0,
    "assignedById" TEXT,
    "acceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RouteAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RouteAssignment_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RouteAssignment_shuttleId_fkey" FOREIGN KEY ("shuttleId") REFERENCES "Shuttle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RouteAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "corporateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "ridesUsed" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "Corporate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "seatClaimId" TEXT,
    "method" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "subsidyCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "refundAmountCents" INTEGER NOT NULL DEFAULT 0,
    "refundedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RefundRetry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "merchOrderId" TEXT NOT NULL,
    "refundRequestNo" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RefundRetry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TelebirrNotifyEvent" (
    "merchOrderId" TEXT NOT NULL,
    "outRequestNo" TEXT NOT NULL,
    "tradeStatus" TEXT NOT NULL,
    "totalAmount" TEXT,
    "rawPayload" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("merchOrderId", "outRequestNo")
);

-- CreateTable
CREATE TABLE "SeatRelease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "expiresAt" DATETIME NOT NULL,
    "priceCents" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeatRelease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatRelease_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SeatClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seatReleaseId" TEXT NOT NULL,
    "claimantUserId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeatClaim_seatReleaseId_fkey" FOREIGN KEY ("seatReleaseId") REFERENCES "SeatRelease" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatClaim_claimantUserId_fkey" FOREIGN KEY ("claimantUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatClaim_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "seatClaimId" TEXT,
    "pickupLocationId" TEXT,
    "assignmentId" TEXT,
    "farePaidCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ride_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ride_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ride_seatClaimId_fkey" FOREIGN KEY ("seatClaimId") REFERENCES "SeatClaim" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ride_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "PickupLocation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Ride_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RouteAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RideRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rideId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "contractorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RideRating_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RideRating_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RideRating_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "subscriptionId" TEXT,
    "paymentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupportTicket_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupportTicket_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketMessage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FaqArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" TEXT,
    "after" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "requestBodyHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL DEFAULT 0,
    "responseBody" TEXT NOT NULL DEFAULT '{}',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploaderId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadedFile_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContractorDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contractorId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractorDocument_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "ContractorProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractorDocument_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "UploadedFile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CorporateInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corporateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "note" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 50,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorporateInvite_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "Corporate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CorporateInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CorporateInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corporateId" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issuedAt" DATETIME,
    "dueAt" DATETIME,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CorporateInvoice_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "Corporate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "mctContractNo" TEXT NOT NULL,
    "mandateTemplateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Mandate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TwoFactorBackupCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TwoFactorBackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_isActive_deletedAt_idx" ON "User"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RiderProfile_userId_key" ON "RiderProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorProfile_userId_key" ON "ContractorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorProfile_licenseNumber_key" ON "ContractorProfile"("licenseNumber");

-- CreateIndex
CREATE INDEX "ContractorProfile_verificationStatus_idx" ON "ContractorProfile"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Corporate_code_key" ON "Corporate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Corporate_adminUserId_key" ON "Corporate"("adminUserId");

-- CreateIndex
CREATE INDEX "CorporateMember_userId_idx" ON "CorporateMember"("userId");

-- CreateIndex
CREATE INDEX "CorporateMember_lastResetAt_idx" ON "CorporateMember"("lastResetAt");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateMember_corporateId_userId_key" ON "CorporateMember"("corporateId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_jti_key" ON "Session"("jti");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_expiresAt_idx" ON "Session"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "OtpCode_phone_purpose_idx" ON "OtpCode"("phone", "purpose");

-- CreateIndex
CREATE INDEX "TosAcceptance_userId_idx" ON "TosAcceptance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_slug_key" ON "SubscriptionPlan"("slug");

-- CreateIndex
CREATE INDEX "PickupLocation_routeId_idx" ON "PickupLocation"("routeId");

-- CreateIndex
CREATE UNIQUE INDEX "Shuttle_plate_key" ON "Shuttle"("plate");

-- CreateIndex
CREATE INDEX "Shuttle_contractorId_idx" ON "Shuttle"("contractorId");

-- CreateIndex
CREATE INDEX "Shuttle_contractorId_isActive_idx" ON "Shuttle"("contractorId", "isActive");

-- CreateIndex
CREATE INDEX "Trip_routeId_departureAt_idx" ON "Trip"("routeId", "departureAt");

-- CreateIndex
CREATE INDEX "Trip_shuttleId_departureAt_idx" ON "Trip"("shuttleId", "departureAt");

-- CreateIndex
CREATE INDEX "Trip_assignmentId_idx" ON "Trip"("assignmentId");

-- CreateIndex
CREATE INDEX "Trip_driverId_departureAt_idx" ON "Trip"("driverId", "departureAt");

-- CreateIndex
CREATE INDEX "Trip_status_departureAt_idx" ON "Trip"("status", "departureAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_routeId_departureAt_window_key" ON "Trip"("routeId", "departureAt", "window");

-- CreateIndex
CREATE INDEX "RouteAssignment_contractorId_monthStart_idx" ON "RouteAssignment"("contractorId", "monthStart");

-- CreateIndex
CREATE INDEX "RouteAssignment_routeId_monthStart_idx" ON "RouteAssignment"("routeId", "monthStart");

-- CreateIndex
CREATE INDEX "RouteAssignment_status_monthStart_idx" ON "RouteAssignment"("status", "monthStart");

-- CreateIndex
CREATE UNIQUE INDEX "RouteAssignment_routeId_contractorId_monthStart_key" ON "RouteAssignment"("routeId", "contractorId", "monthStart");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- CreateIndex
CREATE INDEX "Subscription_corporateId_idx" ON "Subscription"("corporateId");

-- CreateIndex
CREATE INDEX "Subscription_status_endDate_idx" ON "Subscription"("status", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment"("subscriptionId");

-- CreateIndex
CREATE INDEX "Payment_seatClaimId_idx" ON "Payment"("seatClaimId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRetry_refundRequestNo_key" ON "RefundRetry"("refundRequestNo");

-- CreateIndex
CREATE INDEX "RefundRetry_paymentId_idx" ON "RefundRetry"("paymentId");

-- CreateIndex
CREATE INDEX "RefundRetry_status_nextAttemptAt_idx" ON "RefundRetry"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SeatRelease_status_expiresAt_idx" ON "SeatRelease"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SeatRelease_tripId_idx" ON "SeatRelease"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "SeatClaim_paymentId_key" ON "SeatClaim"("paymentId");

-- CreateIndex
CREATE INDEX "SeatClaim_claimantUserId_idx" ON "SeatClaim"("claimantUserId");

-- CreateIndex
CREATE INDEX "SeatClaim_seatReleaseId_idx" ON "SeatClaim"("seatReleaseId");

-- CreateIndex
CREATE INDEX "Ride_userId_idx" ON "Ride"("userId");

-- CreateIndex
CREATE INDEX "Ride_tripId_idx" ON "Ride"("tripId");

-- CreateIndex
CREATE INDEX "Ride_subscriptionId_idx" ON "Ride"("subscriptionId");

-- CreateIndex
CREATE INDEX "Ride_seatClaimId_idx" ON "Ride"("seatClaimId");

-- CreateIndex
CREATE INDEX "Ride_pickupLocationId_idx" ON "Ride"("pickupLocationId");

-- CreateIndex
CREATE INDEX "Ride_assignmentId_idx" ON "Ride"("assignmentId");

-- CreateIndex
CREATE INDEX "Ride_tripId_userId_status_idx" ON "Ride"("tripId", "userId", "status");

-- CreateIndex
CREATE INDEX "RideRating_contractorId_createdAt_idx" ON "RideRating"("contractorId", "createdAt");

-- CreateIndex
CREATE INDEX "RideRating_rideId_idx" ON "RideRating"("rideId");

-- CreateIndex
CREATE UNIQUE INDEX "RideRating_rideId_riderId_key" ON "RideRating"("rideId", "riderId");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_type_createdAt_idx" ON "Notification"("userId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_seq_idx" ON "AuditLog"("seq");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_channel_status_idx" ON "OutboxEvent"("channel", "status");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_userId_idx" ON "IdempotencyRecord"("userId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_storageKey_key" ON "UploadedFile"("storageKey");

-- CreateIndex
CREATE INDEX "UploadedFile_uploaderId_idx" ON "UploadedFile"("uploaderId");

-- CreateIndex
CREATE INDEX "UploadedFile_scanStatus_idx" ON "UploadedFile"("scanStatus");

-- CreateIndex
CREATE INDEX "ContractorDocument_contractorId_idx" ON "ContractorDocument"("contractorId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorDocument_contractorId_type_key" ON "ContractorDocument"("contractorId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateInvite_code_key" ON "CorporateInvite"("code");

-- CreateIndex
CREATE INDEX "CorporateInvite_corporateId_idx" ON "CorporateInvite"("corporateId");

-- CreateIndex
CREATE INDEX "CorporateInvoice_corporateId_periodStart_idx" ON "CorporateInvoice"("corporateId", "periodStart");

-- CreateIndex
CREATE INDEX "CorporateInvoice_status_idx" ON "CorporateInvoice"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Mandate_mctContractNo_key" ON "Mandate"("mctContractNo");

-- CreateIndex
CREATE INDEX "Mandate_userId_idx" ON "Mandate"("userId");

-- CreateIndex
CREATE INDEX "Mandate_subscriptionId_idx" ON "Mandate"("subscriptionId");

-- CreateIndex
CREATE INDEX "Mandate_status_idx" ON "Mandate"("status");

-- CreateIndex
CREATE INDEX "TwoFactorBackupCode_userId_idx" ON "TwoFactorBackupCode"("userId");


-- C-1 fix: pending renewal extension fields on Subscription
ALTER TABLE "Subscription" ADD COLUMN "pendingEndDate" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "pendingRidesReset" BOOLEAN NOT NULL DEFAULT 0;

-- H-4 fix: prevent double-booking the same user on the same trip.
-- Partial unique index on (tripId, userId) for active rides only.
-- Works on both SQLite (3.8.0+) and Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS "ride_trip_user_active_unique"
  ON "Ride"("tripId", "userId")
  WHERE status IN ('booked', 'boarded');

-- H-9 fix: prevent duplicate corporate invoices for the same (corporateId, periodStart).
-- Without this, two concurrent scheduler ticks could both create an invoice.
CREATE UNIQUE INDEX IF NOT EXISTS "corporate_invoice_corporate_period_unique"
  ON "CorporateInvoice"("corporateId", "periodStart");

-- H-24 fix: make AuditLog append-only at the DB level.
-- On Postgres these triggers prevent UPDATE/DELETE; on SQLite they also prevent
-- mutations (SQLite supports triggers). This is defense-in-depth — the hash chain
-- detects tampering, but the trigger prevents it.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  BEGIN
    SELECT RAISE(ABORT, 'AuditLog is append-only — UPDATE not allowed');
  END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  BEGIN
    SELECT RAISE(ABORT, 'AuditLog is append-only — DELETE not allowed');
  END;

-- C-11 fix: dedicated Device table for push notification tokens.
CREATE TABLE IF NOT EXISTS "Device" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "pushToken" TEXT NOT NULL UNIQUE,
  "platform" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "Device_userId_idx" ON "Device"("userId");
CREATE INDEX IF NOT EXISTS "Device_pushToken_idx" ON "Device"("pushToken");
