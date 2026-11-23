-- DropForeignKey
ALTER TABLE "AffiliateClick" DROP CONSTRAINT "AffiliateClick_dealId_fkey";

-- DropForeignKey
ALTER TABLE "AffiliateClick" DROP CONSTRAINT "AffiliateClick_merchantId_fkey";

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateClick" ADD CONSTRAINT "AffiliateClick_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
