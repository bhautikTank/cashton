-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "originalPrice" DECIMAL(10,2),
    "dealPrice" DECIMAL(10,2),
    "affiliateUrl" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "minimumPurchase" DECIMAL(10,2),
    "maximumDiscount" DECIMAL(10,2),
    "usageLimit" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_slug_key" ON "Deal"("slug");

-- CreateIndex
CREATE INDEX "Deal_merchantId_idx" ON "Deal"("merchantId");

-- CreateIndex
CREATE INDEX "Deal_isActive_idx" ON "Deal"("isActive");

-- CreateIndex
CREATE INDEX "Deal_startDate_endDate_idx" ON "Deal"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Deal_createdAt_idx" ON "Deal"("createdAt");

-- CreateIndex
CREATE INDEX "Coupon_code_idx" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_merchantId_idx" ON "Coupon"("merchantId");

-- CreateIndex
CREATE INDEX "Coupon_isActive_idx" ON "Coupon"("isActive");

-- CreateIndex
CREATE INDEX "Coupon_startDate_endDate_idx" ON "Coupon"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "Coupon_createdAt_idx" ON "Coupon"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_merchantId_code_key" ON "Coupon"("merchantId", "code");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
