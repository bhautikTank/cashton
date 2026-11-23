-- CreateEnum
CREATE TYPE "CashbackDebtStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'DISPUTED', 'RECOVERED', 'WRITTEN_OFF');

-- AlterEnum
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'CASHBACK_HELD';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'HOLD_RELEASED';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'REVERSAL_FROM_HELD';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'REVERSAL_FROM_AVAILABLE';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'DEBT_CREATED';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'DEBT_RECOVERED';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'DEBT_WRITTEN_OFF';

-- AlterTable Wallet: Add new balance projections
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "availableBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "heldBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "debtBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- Backfill: Preserve all existing customer balances into availableBalance
UPDATE "Wallet"
SET "availableBalance" = "balance"
WHERE "availableBalance" = 0.00 AND "balance" > 0.00;

-- AlterTable Cashback: Add heldAmount, heldUntil, holdReleased, reversedAmount
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "heldAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "heldUntil" TIMESTAMP(3);
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "holdReleased" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "reversedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- CreateIndex on Cashback for hold-release scheduler
CREATE INDEX IF NOT EXISTS "Cashback_heldUntil_holdReleased_idx" ON "Cashback"("heldUntil", "holdReleased");

-- AlterTable Conversion: Add reversedAmount
ALTER TABLE "Conversion" ADD COLUMN IF NOT EXISTS "reversedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- CreateTable CashbackDebt
CREATE TABLE IF NOT EXISTS "CashbackDebt" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "remainingAmount" DECIMAL(10,2) NOT NULL,
    "status" "CashbackDebtStatus" NOT NULL DEFAULT 'OPEN',
    "originatingCashbackId" TEXT,
    "originatingConversionId" TEXT,
    "reason" TEXT,
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashbackDebt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on CashbackDebt
CREATE INDEX IF NOT EXISTS "CashbackDebt_walletId_status_idx" ON "CashbackDebt"("walletId", "status");
CREATE INDEX IF NOT EXISTS "CashbackDebt_userId_idx" ON "CashbackDebt"("userId");
CREATE INDEX IF NOT EXISTS "CashbackDebt_status_idx" ON "CashbackDebt"("status");

-- AddForeignKey constraints for CashbackDebt
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_originatingCashbackId_fkey" FOREIGN KEY ("originatingCashbackId") REFERENCES "Cashback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_originatingConversionId_fkey" FOREIGN KEY ("originatingConversionId") REFERENCES "Conversion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable WalletTransaction: Add debtId
ALTER TABLE "WalletTransaction" ADD COLUMN IF NOT EXISTS "debtId" TEXT;

-- AddForeignKey for WalletTransaction -> CashbackDebt
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "CashbackDebt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex on WalletTransaction.debtId
CREATE INDEX IF NOT EXISTS "WalletTransaction_debtId_idx" ON "WalletTransaction"("debtId");

-- Replace unique constraint on cashbackId with non-unique index to support multiple lifecycle events
DROP INDEX IF EXISTS "WalletTransaction_cashbackId_key";
CREATE INDEX IF NOT EXISTS "WalletTransaction_cashbackId_idx" ON "WalletTransaction"("cashbackId");
