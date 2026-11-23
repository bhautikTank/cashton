-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "description" TEXT;

-- AlterTable
ALTER TABLE "Conversion" ADD COLUMN "campaignSnapshot" JSONB;
