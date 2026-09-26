CREATE TABLE "sales_invoices" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "subtotal" DECIMAL(18,4) NOT NULL,
  "taxTotal" DECIMAL(18,4) NOT NULL,
  "total" DECIMAL(18,4) NOT NULL,
  "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "journalEntryId" TEXT NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_bills" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "subtotal" DECIMAL(18,4) NOT NULL,
  "taxTotal" DECIMAL(18,4) NOT NULL,
  "total" DECIMAL(18,4) NOT NULL,
  "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "journalEntryId" TEXT NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_bills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expenses" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "expenseAccountCode" TEXT NOT NULL,
  "paymentAccountCode" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "taxAmount" DECIMAL(18,4) NOT NULL,
  "total" DECIMAL(18,4) NOT NULL,
  "description" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assets" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cost" DECIMAL(18,4) NOT NULL,
  "residualValue" DECIMAL(18,4) NOT NULL,
  "usefulLifeMonths" INTEGER NOT NULL,
  "accumulatedDepreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "acquisitionJournalEntryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_levels" (
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "quantityOnHand" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "averageCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("organizationId", "productId")
);

CREATE TABLE "pos_shifts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "terminalId" TEXT NOT NULL,
  "cashierUserId" TEXT NOT NULL,
  "openingCash" DECIMAL(18,4) NOT NULL,
  "cashSalesTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "cashReturnsTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "actualCash" DECIMAL(18,4),
  "expectedCash" DECIMAL(18,4),
  "cashDifference" DECIMAL(18,4),
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "pos_shifts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT,
  "branchId" TEXT,
  "action" TEXT NOT NULL,
  "entityPath" TEXT NOT NULL,
  "requestBody" JSONB,
  "outcome" TEXT NOT NULL,
  "errorMessage" TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_invoices_journalEntryId_key" ON "sales_invoices"("journalEntryId");
CREATE INDEX "sales_invoices_organizationId_issueDate_idx" ON "sales_invoices"("organizationId", "issueDate");
CREATE INDEX "sales_invoices_organizationId_customerId_idx" ON "sales_invoices"("organizationId", "customerId");
CREATE UNIQUE INDEX "purchase_bills_journalEntryId_key" ON "purchase_bills"("journalEntryId");
CREATE INDEX "purchase_bills_organizationId_issueDate_idx" ON "purchase_bills"("organizationId", "issueDate");
CREATE INDEX "purchase_bills_organizationId_supplierId_idx" ON "purchase_bills"("organizationId", "supplierId");
CREATE UNIQUE INDEX "expenses_journalEntryId_key" ON "expenses"("journalEntryId");
CREATE INDEX "expenses_organizationId_createdAt_idx" ON "expenses"("organizationId", "createdAt");
CREATE UNIQUE INDEX "assets_acquisitionJournalEntryId_key" ON "assets"("acquisitionJournalEntryId");
CREATE INDEX "assets_organizationId_idx" ON "assets"("organizationId");
CREATE UNIQUE INDEX "payments_journalEntryId_key" ON "payments"("journalEntryId");
CREATE INDEX "payments_organizationId_type_partyId_idx" ON "payments"("organizationId", "type", "partyId");
CREATE INDEX "stock_levels_productId_idx" ON "stock_levels"("productId");
CREATE INDEX "pos_shifts_organizationId_terminalId_status_idx" ON "pos_shifts"("organizationId", "terminalId", "status");
CREATE INDEX "audit_logs_organizationId_timestamp_idx" ON "audit_logs"("organizationId", "timestamp");
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp");

ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
