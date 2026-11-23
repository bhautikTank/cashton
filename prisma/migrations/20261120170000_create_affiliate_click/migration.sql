-- CreateEnum
CREATE TYPE "ClickStatus" AS ENUM ('TRACKED', 'REDIRECTED', 'FAILED');

-- CreateTable
CREATE TABLE "AffiliateClick" (
    "id" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "userId" TEXT,
    "dealId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "landingDestination" TEXT NOT NULL,
    "status" "ClickStatus" NOT NULL DEFAULT 'TRACKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateClick_clickId_key" ON "AffiliateClick"("clickId");

-- CreateIndex
CREATE INDEX "AffiliateClick_clickId_idx" ON "AffiliateClick"("clickId");

-- CreateIndex
CREATE INDEX "AffiliateClick_userId_clickedAt_idx" ON "AffiliateClick"("userId", "clickedAt");

-- CreateIndex
CREATE INDEX "AffiliateClick_dealId_clickedAt_idx" ON "AffiliateClick"("dealId", "clickedAt");

-- CreateIndex
CREATE INDEX "AffiliateClick_merchantId_clickedAt_idx" ON "AffiliateClick"("merchantId", "clickedAt");

-- CreateIndex
CREATE INDEX "AffiliateClick_status_clickedAt_idx" ON "AffiliateClick"("status", "clickedAt");

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
