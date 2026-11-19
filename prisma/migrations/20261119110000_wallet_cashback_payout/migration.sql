-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('BANK', 'UPI');

-- CreateEnum
CREATE TYPE "PayoutVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CashbackStatus" AS ENUM ('PENDING', 'APPROVED', 'CONFIRMED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WalletTransactionType" AS ENUM ('CREDIT', 'DEBIT', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "WalletTransactionCategory" AS ENUM ('CASHBACK', 'PAYOUT', 'ADMIN_ADJUSTMENT', 'BONUS');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mobileNumber" TEXT;

-- CreateTable
CREATE TABLE "PayoutDetails" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountHolderName" TEXT,
    "encryptedAccountNumber" TEXT,
    "accountNumberLast4" TEXT,
    "ifscCode" TEXT,
    "bankName" TEXT,
    "upiId" TEXT,
    "payoutMethod" "PayoutMethod" NOT NULL DEFAULT 'UPI',
    "status" "PayoutVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cashback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "CashbackStatus" NOT NULL DEFAULT 'PENDING',
    "externalReferenceId" TEXT,
    "description" TEXT,
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cashback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "WalletTransactionType" NOT NULL,
    "category" "WalletTransactionCategory" NOT NULL,
    "idempotencyKey" TEXT,
    "description" TEXT NOT NULL,
    "cashbackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutDetails_userId_key" ON "PayoutDetails"("userId");

-- CreateIndex
CREATE INDEX "PayoutDetails_userId_idx" ON "PayoutDetails"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Cashback_externalReferenceId_key" ON "Cashback"("externalReferenceId");

-- CreateIndex
CREATE INDEX "Cashback_userId_idx" ON "Cashback"("userId");

-- CreateIndex
CREATE INDEX "Cashback_status_idx" ON "Cashback"("status");

-- CreateIndex
CREATE INDEX "Cashback_merchantId_idx" ON "Cashback"("merchantId");

-- CreateIndex
CREATE INDEX "Cashback_createdAt_idx" ON "Cashback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_cashbackId_key" ON "WalletTransaction"("cashbackId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_idx" ON "WalletTransaction"("walletId");

-- CreateIndex
CREATE INDEX "WalletTransaction_createdAt_idx" ON "WalletTransaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_mobileNumber_key" ON "User"("mobileNumber");

-- AddForeignKey
ALTER TABLE "PayoutDetails" ADD CONSTRAINT "PayoutDetails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cashback" ADD CONSTRAINT "Cashback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cashback" ADD CONSTRAINT "Cashback_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_cashbackId_fkey" FOREIGN KEY ("cashbackId") REFERENCES "Cashback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
