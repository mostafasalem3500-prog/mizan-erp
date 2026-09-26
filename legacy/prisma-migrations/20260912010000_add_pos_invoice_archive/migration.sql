ALTER TABLE "customers"
  ADD COLUMN "crNumber" TEXT,
  ADD COLUMN "streetName" TEXT,
  ADD COLUMN "buildingNumber" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "postalZone" TEXT,
  ADD COLUMN "district" TEXT,
  ADD COLUMN "countryCode" TEXT DEFAULT 'SA';

ALTER TABLE "organizations"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "invoiceFooter" TEXT,
  ADD COLUMN "defaultReceiptTemplate" TEXT NOT NULL DEFAULT 'thermal';

CREATE TABLE "pos_sales" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT,
  "invoiceNumber" TEXT NOT NULL,
  "terminalId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "tenders" JSONB NOT NULL,
  "subtotal" DECIMAL(18,4) NOT NULL,
  "taxTotal" DECIMAL(18,4) NOT NULL,
  "total" DECIMAL(18,4) NOT NULL,
  "saleJournalEntryId" TEXT NOT NULL,
  "inventoryEffects" JSONB NOT NULL,
  "remainingQuantities" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "shiftId" TEXT,
  "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pos_sales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pos_sales_organizationId_invoiceNumber_key" ON "pos_sales"("organizationId", "invoiceNumber");
CREATE INDEX "pos_sales_organizationId_soldAt_idx" ON "pos_sales"("organizationId", "soldAt");
CREATE INDEX "pos_sales_organizationId_customerId_idx" ON "pos_sales"("organizationId", "customerId");

ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
