-- AlterEnum
ALTER TYPE "StoreRequestStatus" ADD VALUE 'APPROVED_PENDING_PAYMENT';

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "connectOnboardingComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Store" ADD COLUMN "stripeConnectAccountId" TEXT;

-- AlterTable
ALTER TABLE "StoreRequest" ADD COLUMN "connectOnboardingComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreRequest" ADD COLUMN "connectOnboardingUrl" TEXT;
ALTER TABLE "StoreRequest" ADD COLUMN "setupFeePaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreRequest" ADD COLUMN "setupFeePaymentIntentId" TEXT;
ALTER TABLE "StoreRequest" ADD COLUMN "stripeConnectAccountId" TEXT;
