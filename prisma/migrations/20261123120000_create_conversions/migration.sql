-- CreateEnum
CREATE TYPE "AffiliateProvider" AS ENUM ('FLIPKART', 'CUELINKS', 'ADMITAD', 'EARNKARO', 'GENERIC');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING', 'APPROVED', 'CONFIRMED', 'REJECTED', 'REVERSED', 'UNMATCHED');

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "provider" "AffiliateProvider" NOT NULL,
    "externalTransactionId" TEXT NOT NULL,
    "affiliateClickId" TEXT,
    "userId" TEXT,
    "merchantId" TEXT,
    "dealId" TEXT,
    "cashbackId" TEXT,
    "orderAmount" DECIMAL(10,2) NOT NULL,
    "commissionAmount" DECIMAL(10,2) NOT NULL,
    "cashbackAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,
    "reconciliationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_cashbackId_key" ON "Conversion"("cashbackId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_provider_externalTransactionId_key" ON "Conversion"("provider", "externalTransactionId");

-- CreateIndex
CREATE INDEX "Conversion_provider_externalTransactionId_idx" ON "Conversion"("provider", "externalTransactionId");

-- CreateIndex
CREATE INDEX "Conversion_affiliateClickId_idx" ON "Conversion"("affiliateClickId");

-- CreateIndex
CREATE INDEX "Conversion_userId_idx" ON "Conversion"("userId");

-- CreateIndex
CREATE INDEX "Conversion_merchantId_idx" ON "Conversion"("merchantId");

-- CreateIndex
CREATE INDEX "Conversion_dealId_idx" ON "Conversion"("dealId");

-- CreateIndex
CREATE INDEX "Conversion_status_idx" ON "Conversion"("status");

-- CreateIndex
CREATE INDEX "Conversion_createdAt_idx" ON "Conversion"("createdAt");

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_affiliateClickId_fkey" FOREIGN KEY ("affiliateClickId") REFERENCES "AffiliateClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_cashbackId_fkey" FOREIGN KEY ("cashbackId") REFERENCES "Cashback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
