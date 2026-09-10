-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "requireShiftForPosSale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "streetName" TEXT,
ADD COLUMN     "buildingNumber" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "postalZone" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "countryCode" TEXT;
