-- AlterEnum
ALTER TYPE "ProductType" ADD VALUE 'SMS_RECOVERY';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "bottles" INTEGER,
ADD COLUMN     "catalogPriceUsd" DECIMAL(10,2),
ADD COLUMN     "catalogStatus" TEXT,
ADD COLUMN     "checkoutUrl" TEXT,
ADD COLUMN     "driveUrl" TEXT,
ADD COLUMN     "family" TEXT,
ADD COLUMN     "niche" TEXT,
ADD COLUMN     "salesPageUrl" TEXT,
ADD COLUMN     "thanksPageUrl" TEXT,
ADD COLUMN     "variant" TEXT,
ADD COLUMN     "vendorAccount" TEXT;

-- CreateIndex
CREATE INDEX "Product_family_idx" ON "Product"("family");

-- CreateIndex
CREATE INDEX "Product_family_productType_idx" ON "Product"("family", "productType");
