-- CreateEnum
CREATE TYPE "CampaignShareType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterEnum
ALTER TYPE "ConversionStatus" ADD VALUE 'NEEDS_CAMPAIGN_RULE';

-- AlterTable
ALTER TABLE "Conversion" ADD COLUMN "campaignId" TEXT,
ADD COLUMN "shareType" "CampaignShareType",
ADD COLUMN "userShareValue" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "merchantId" TEXT,
    "dealId" TEXT,
    "network" "AffiliateProvider",
    "shareType" "CampaignShareType" NOT NULL DEFAULT 'PERCENTAGE',
    "userShareValue" DECIMAL(10,2) NOT NULL,
    "maxCashbackPerOrder" DECIMAL(10,2),
    "maxCashbackPerUser" DECIMAL(10,2),
    "maxCampaignBudget" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campaign_merchantId_idx" ON "Campaign"("merchantId");

-- CreateIndex
CREATE INDEX "Campaign_dealId_idx" ON "Campaign"("dealId");

-- CreateIndex
CREATE INDEX "Campaign_network_idx" ON "Campaign"("network");

-- CreateIndex
CREATE INDEX "Campaign_isActive_idx" ON "Campaign"("isActive");

-- CreateIndex
CREATE INDEX "Campaign_priority_idx" ON "Campaign"("priority");

-- CreateIndex
CREATE INDEX "Campaign_createdAt_idx" ON "Campaign"("createdAt");

-- CreateIndex
CREATE INDEX "Conversion_campaignId_idx" ON "Conversion"("campaignId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
