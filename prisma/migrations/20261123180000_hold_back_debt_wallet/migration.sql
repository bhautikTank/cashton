-- ==============================================================================
-- Migration: 20261123180000_hold_back_debt_wallet
-- CashTon Hold-Back, Debt Wallet & Financial Integrity Constraints
-- ==============================================================================

-- 1. Create Enums
DO $$ BEGIN
    CREATE TYPE "CashbackDebtStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'DISPUTED', 'RECOVERED', 'WRITTEN_OFF');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Alter Enum WalletTransactionCategory
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'CASHBACK_HELD';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'HOLD_RELEASED';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'REVERSAL_FROM_HELD';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'REVERSAL_FROM_AVAILABLE';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'DEBT_CREATED';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'DEBT_RECOVERED';
ALTER TYPE "WalletTransactionCategory" ADD VALUE IF NOT EXISTS 'DEBT_WRITTEN_OFF';

-- 3. Alter Table Wallet: Add projection columns
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "availableBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "heldBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "debtBalance" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- 4. Alter Table Cashback: Add hold-back and reversal tracking columns
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "heldAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "heldUntil" TIMESTAMP(3);
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "holdReleased" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Cashback" ADD COLUMN IF NOT EXISTS "reversedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

CREATE INDEX IF NOT EXISTS "Cashback_heldUntil_holdReleased_idx" ON "Cashback"("heldUntil", "holdReleased");

-- 5. Alter Table Conversion: Add cumulative reversedAmount column
ALTER TABLE "Conversion" ADD COLUMN IF NOT EXISTS "reversedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00;

-- 6. Create Table CashbackDebt (Strict Restrict on Wallet, User, Admin, Cashback, Conversion)
CREATE TABLE IF NOT EXISTS "CashbackDebt" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "remainingAmount" DECIMAL(10,2) NOT NULL,
    "status" "CashbackDebtStatus" NOT NULL DEFAULT 'OPEN',
    "idempotencyKey" TEXT,
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

-- Indexes for CashbackDebt
CREATE UNIQUE INDEX IF NOT EXISTS "CashbackDebt_idempotencyKey_key" ON "CashbackDebt"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "CashbackDebt_walletId_status_idx" ON "CashbackDebt"("walletId", "status");
CREATE INDEX IF NOT EXISTS "CashbackDebt_userId_idx" ON "CashbackDebt"("userId");
CREATE INDEX IF NOT EXISTS "CashbackDebt_status_idx" ON "CashbackDebt"("status");
CREATE INDEX IF NOT EXISTS "CashbackDebt_resolvedByAdminId_idx" ON "CashbackDebt"("resolvedByAdminId");

-- Foreign Keys for CashbackDebt (Financial debt records CANNOT cascade-delete or erase provenance)
ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_walletId_fkey";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_walletId_fkey" 
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_userId_fkey";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_originatingCashbackId_fkey";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_originatingCashbackId_fkey" 
    FOREIGN KEY ("originatingCashbackId") REFERENCES "Cashback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_originatingConversionId_fkey";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_originatingConversionId_fkey" 
    FOREIGN KEY ("originatingConversionId") REFERENCES "Conversion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_resolvedByAdminId_fkey";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_resolvedByAdminId_fkey" 
    FOREIGN KEY ("resolvedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Alter Table WalletTransaction
ALTER TABLE "WalletTransaction" ADD COLUMN IF NOT EXISTS "debtId" TEXT;

ALTER TABLE "WalletTransaction" DROP CONSTRAINT IF EXISTS "WalletTransaction_debtId_fkey";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_debtId_fkey" 
    FOREIGN KEY ("debtId") REFERENCES "CashbackDebt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "WalletTransaction_debtId_idx" ON "WalletTransaction"("debtId");

-- Replace unique constraint on cashbackId with non-unique index to support multiple lifecycle events
DROP INDEX IF EXISTS "WalletTransaction_cashbackId_key";
CREATE INDEX IF NOT EXISTS "WalletTransaction_cashbackId_idx" ON "WalletTransaction"("cashbackId");

-- Ensure idempotencyKey has a unique index
CREATE UNIQUE INDEX IF NOT EXISTS "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- 8. Historical Cashback Preservation (Prevent duplicate credits from hold-release scheduler)
UPDATE "Cashback"
SET "heldAmount" = 0.00,
    "holdReleased" = true
WHERE "status" = 'CONFIRMED';

UPDATE "Cashback"
SET "heldAmount" = 0.00,
    "holdReleased" = false
WHERE "status" != 'CONFIRMED';

-- 9. Reconciled Wallet Backfill Strategy

-- Step 9.1: Pre-Backfill Guard - Detect and abort on ANY negative ledger-derived balance.
-- Never silently clamp a negative balance to zero.
DO $$
DECLARE
    r RECORD;
BEGIN
    SELECT 
        w."id" AS wallet_id,
        u."email" AS user_email,
        COALESCE(SUM(
            CASE 
                WHEN wt."type" IN ('CREDIT', 'ADJUSTMENT') THEN wt."amount"
                WHEN wt."type" IN ('DEBIT', 'REVERSAL') THEN -wt."amount"
                ELSE 0.00
            END
        ), 0.00) AS net_balance
    INTO r
    FROM "Wallet" w
    JOIN "WalletTransaction" wt ON wt."walletId" = w."id"
    LEFT JOIN "User" u ON u."id" = w."userId"
    GROUP BY w."id", u."email"
    HAVING COALESCE(SUM(
        CASE 
            WHEN wt."type" IN ('CREDIT', 'ADJUSTMENT') THEN wt."amount"
            WHEN wt."type" IN ('DEBIT', 'REVERSAL') THEN -wt."amount"
            ELSE 0.00
        END
    ), 0.00) < 0.00
    LIMIT 1;

    IF r.wallet_id IS NOT NULL THEN
        RAISE EXCEPTION 'MIGRATION ABORTED: Financial ledger corruption detected. Wallet % (User: %) has negative ledger balance (%). Aborting without modifying balances.',
            r.wallet_id, r.user_email, r.net_balance;
    END IF;
END $$;

-- Step 9.2: Targeted Test Residue Neutralization
-- Explicit allowlist of verified synthetic test accounts with zero ledger transactions.
-- Confirmed no legitimate customer accounts can be affected.
UPDATE "Wallet" w
SET "balance" = 0.00
FROM "User" u
WHERE w."userId" = u."id"
  AND u."email" IN (
    'usera-audit-1795428310170@example.com',
    'usera-audit-1795428606924@example.com',
    'usera-audit-1795428884975@example.com',
    'usera-audit-1795431889309@example.com',
    'usera-audit-1795433243646@example.com'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "WalletTransaction" wt WHERE wt."walletId" = w."id"
  );

-- Step 9.3: Backfill availableBalance strictly using the ledger as source of truth
WITH "LedgerNet" AS (
  SELECT 
    w."id" AS "walletId",
    COALESCE(SUM(
      CASE 
        WHEN wt."type" IN ('CREDIT', 'ADJUSTMENT') THEN wt."amount"
        WHEN wt."type" IN ('DEBIT', 'REVERSAL') THEN -wt."amount"
        ELSE 0.00
      END
    ), 0.00) AS "ledgerBalance",
    COUNT(wt."id") AS "txCount"
  FROM "Wallet" w
  LEFT JOIN "WalletTransaction" wt ON wt."walletId" = w."id"
  GROUP BY w."id"
)
UPDATE "Wallet" w
SET "availableBalance" = CASE
  -- When transactions exist in ledger, ledger is authoritative (no silent clamping)
  WHEN ln."txCount" > 0 THEN ln."ledgerBalance"
  -- When no ledger transactions exist, preserve existing verified balance
  ELSE w."balance"
END,
"heldBalance" = 0.00,
"debtBalance" = 0.00
FROM "LedgerNet" ln
WHERE w."id" = ln."walletId";

-- 10. Database-Level Monetary Integrity CHECK Constraints
-- Wallet constraints
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_availableBalance_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_availableBalance_non_negative" CHECK ("availableBalance" >= 0.00);

ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_heldBalance_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_heldBalance_non_negative" CHECK ("heldBalance" >= 0.00);

ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_debtBalance_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_debtBalance_non_negative" CHECK ("debtBalance" >= 0.00);

ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_balance_non_negative";
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_balance_non_negative" CHECK ("balance" >= 0.00);

-- CashbackDebt constraints
ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_amount_positive";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_amount_positive" CHECK ("amount" > 0.00);

ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_remainingAmount_non_negative";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_remainingAmount_non_negative" CHECK ("remainingAmount" >= 0.00);

ALTER TABLE "CashbackDebt" DROP CONSTRAINT IF EXISTS "CashbackDebt_remaining_lte_amount";
ALTER TABLE "CashbackDebt" ADD CONSTRAINT "CashbackDebt_remaining_lte_amount" CHECK ("remainingAmount" <= "amount");

-- Cashback constraints (including combined invariant: heldAmount + reversedAmount <= amount)
ALTER TABLE "Cashback" DROP CONSTRAINT IF EXISTS "Cashback_amount_positive";
ALTER TABLE "Cashback" ADD CONSTRAINT "Cashback_amount_positive" CHECK ("amount" > 0.00);

ALTER TABLE "Cashback" DROP CONSTRAINT IF EXISTS "Cashback_heldAmount_non_negative";
ALTER TABLE "Cashback" ADD CONSTRAINT "Cashback_heldAmount_non_negative" CHECK ("heldAmount" >= 0.00);

ALTER TABLE "Cashback" DROP CONSTRAINT IF EXISTS "Cashback_reversedAmount_non_negative";
ALTER TABLE "Cashback" ADD CONSTRAINT "Cashback_reversedAmount_non_negative" CHECK ("reversedAmount" >= 0.00);

ALTER TABLE "Cashback" DROP CONSTRAINT IF EXISTS "Cashback_held_plus_reversed_lte_amount";
ALTER TABLE "Cashback" ADD CONSTRAINT "Cashback_held_plus_reversed_lte_amount" CHECK ("heldAmount" + "reversedAmount" <= "amount");

-- Conversion constraints
ALTER TABLE "Conversion" DROP CONSTRAINT IF EXISTS "Conversion_orderAmount_non_negative";
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_orderAmount_non_negative" CHECK ("orderAmount" >= 0.00);

ALTER TABLE "Conversion" DROP CONSTRAINT IF EXISTS "Conversion_commissionAmount_non_negative";
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_commissionAmount_non_negative" CHECK ("commissionAmount" >= 0.00);

ALTER TABLE "Conversion" DROP CONSTRAINT IF EXISTS "Conversion_cashbackAmount_non_negative";
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_cashbackAmount_non_negative" CHECK ("cashbackAmount" >= 0.00);

ALTER TABLE "Conversion" DROP CONSTRAINT IF EXISTS "Conversion_reversedAmount_non_negative";
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_reversedAmount_non_negative" CHECK ("reversedAmount" >= 0.00);

-- WalletTransaction constraints
ALTER TABLE "WalletTransaction" DROP CONSTRAINT IF EXISTS "WalletTransaction_amount_positive";
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_amount_positive" CHECK ("amount" > 0.00);
