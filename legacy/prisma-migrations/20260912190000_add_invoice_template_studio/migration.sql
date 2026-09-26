-- Additive invoice-template persistence. Existing organizations and sales
-- keep working through application defaults; no historical row is rewritten.
ALTER TABLE "organizations"
  ADD COLUMN "invoiceTemplateConfig" JSONB;

ALTER TABLE "pos_sales"
  ADD COLUMN "receiptTemplate" TEXT NOT NULL DEFAULT 'thermal',
  ADD COLUMN "invoiceTemplateSnapshot" JSONB;
