-- ==============================================================================
-- Migration: 20261124170000_create_payout_and_refund
-- CashTon Phase 8: Payout / Withdrawal Engine and Refund Ledger
-- ==============================================================================

-- 1. Create PayoutStatus Enum
DO $$ BEGIN
    CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Alter Enum WalletTransactionCategory to add PAYOUT_REFUND
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'PAYOUT_REFUND';

-- 3. Create Table Payout
CREATE TABLE IF NOT EXISTS "Payout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "payoutMethod" "PayoutMethod" NOT NULL DEFAULT 'UPI',
    "destinationMasked" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "providerReference" TEXT,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "processedByAdminId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- 4. Create Indexes on Payout
CREATE UNIQUE INDEX IF NOT EXISTS "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Payout_userId_status_idx" ON "Payout"("userId", "status");
CREATE INDEX IF NOT EXISTS "Payout_status_idx" ON "Payout"("status");
CREATE INDEX IF NOT EXISTS "Payout_createdAt_idx" ON "Payout"("createdAt");
CREATE INDEX IF NOT EXISTS "Payout_processedByAdminId_idx" ON "Payout"("processedByAdminId");

-- 5. Foreign Key Constraints for Payout (Strict ON DELETE RESTRICT)
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_userId_fkey";
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_walletId_fkey";
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_walletId_fkey" 
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_processedByAdminId_fkey";
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_processedByAdminId_fkey" 
    FOREIGN KEY ("processedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Alter Table WalletTransaction: Add payoutId column, index, and foreign key
ALTER TABLE "WalletTransaction" ADD COLUMN IF NOT EXISTS "payoutId" TEXT;
CREATE INDEX IF NOT EXISTS "WalletTransaction_payoutId_idx" ON "WalletTransaction"("payoutId");

ALTER TABLE "WalletTransaction" DROP CONSTRAINT IF EXISTS "WalletTransaction_payoutId_fkey";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_payoutId_fkey" 
    FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Monetary Integrity Check Constraints for Payout
ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_amount_positive";
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_positive" CHECK ("amount" >= 250.00);

ALTER TABLE "Payout" DROP CONSTRAINT IF EXISTS "Payout_amount_max";
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_max" CHECK ("amount" <= 1000000.00);
