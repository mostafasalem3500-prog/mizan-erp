-- Preserve existing operational documents while adding the dimensions
-- required to reconcile each VAT return period to its source documents.
ALTER TABLE "sales_invoices" ADD COLUMN "periodId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "purchase_bills" ADD COLUMN "periodId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "expenses" ADD COLUMN "periodId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "expenses" ADD COLUMN "taxCode" TEXT NOT NULL DEFAULT 'STANDARD';

CREATE INDEX "sales_invoices_organizationId_periodId_idx" ON "sales_invoices"("organizationId", "periodId");
CREATE INDEX "purchase_bills_organizationId_periodId_idx" ON "purchase_bills"("organizationId", "periodId");
CREATE INDEX "expenses_organizationId_periodId_idx" ON "expenses"("organizationId", "periodId");
