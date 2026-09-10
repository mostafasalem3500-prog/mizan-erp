import { Injectable } from "@nestjs/common";
import { SalesService } from "../sales/sales.service";
import { PurchasesService } from "../purchases/purchases.service";

export type AgingBucket = "CURRENT_0_30" | "DAYS_31_60" | "DAYS_61_90" | "DAYS_90_PLUS";

export interface AgingLine {
  referenceId: string; // invoice or bill id
  partyId: string; // customerId or supplierId
  issueDate: string;
  ageDays: number;
  bucket: AgingBucket;
  outstandingBalance: string;
}

export interface AgingResult {
  lines: AgingLine[];
  bucketTotals: Record<AgingBucket, string>;
  totalOutstanding: string;
}

function bucketFor(ageDays: number): AgingBucket {
  if (ageDays <= 30) return "CURRENT_0_30";
  if (ageDays <= 60) return "DAYS_31_60";
  if (ageDays <= 90) return "DAYS_61_90";
  return "DAYS_90_PLUS";
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

/**
 * Spec band 95 (Receivable Aging / Payable Aging). Builds directly on the
 * `issueDate` and `paidAmount` fields added in Sprint 19 — every invoice/
 * bill with a positive outstanding balance (total - paidAmount) is aged
 * from its issueDate to `asOf` (defaults to now) and bucketed into
 * standard 0-30/31-60/61-90/90+ day windows.
 */
@Injectable()
export class AgingService {
  constructor(
    private readonly salesService: SalesService,
    private readonly purchasesService: PurchasesService,
  ) {}

  async getReceivableAging(organizationId: string, asOf: Date = new Date()): Promise<AgingResult> {
    const invoices = await this.salesService.listAllInvoices(organizationId);
    return this.buildAging(
      invoices.map((inv) => ({
        referenceId: inv.id,
        partyId: inv.customerId,
        issueDate: inv.issueDate,
        total: inv.total,
        paidAmount: inv.paidAmount,
      })),
      asOf,
    );
  }

  async getPayableAging(organizationId: string, asOf: Date = new Date()): Promise<AgingResult> {
    const bills = await this.purchasesService.listAllBills(organizationId);
    return this.buildAging(
      bills.map((bill) => ({
        referenceId: bill.id,
        partyId: bill.supplierId,
        issueDate: bill.issueDate,
        total: bill.total,
        paidAmount: bill.paidAmount,
      })),
      asOf,
    );
  }

  private buildAging(
    records: Array<{ referenceId: string; partyId: string; issueDate: string; total: string; paidAmount: string }>,
    asOf: Date,
  ): AgingResult {
    const lines: AgingLine[] = [];
    const bucketTotals: Record<AgingBucket, number> = {
      CURRENT_0_30: 0,
      DAYS_31_60: 0,
      DAYS_61_90: 0,
      DAYS_90_PLUS: 0,
    };
    let totalOutstanding = 0;

    for (const record of records) {
      const outstanding = Number(record.total) - Number(record.paidAmount);
      if (outstanding <= 0.005) continue; // fully paid — not an outstanding balance, not aged

      const issueDate = new Date(record.issueDate);
      const ageDays = Math.max(0, daysBetween(issueDate, asOf));
      const bucket = bucketFor(ageDays);

      lines.push({
        referenceId: record.referenceId,
        partyId: record.partyId,
        issueDate: record.issueDate,
        ageDays,
        bucket,
        outstandingBalance: outstanding.toFixed(2),
      });

      bucketTotals[bucket] += outstanding;
      totalOutstanding += outstanding;
    }

    return {
      lines,
      bucketTotals: {
        CURRENT_0_30: bucketTotals.CURRENT_0_30.toFixed(2),
        DAYS_31_60: bucketTotals.DAYS_31_60.toFixed(2),
        DAYS_61_90: bucketTotals.DAYS_61_90.toFixed(2),
        DAYS_90_PLUS: bucketTotals.DAYS_90_PLUS.toFixed(2),
      },
      totalOutstanding: totalOutstanding.toFixed(2),
    };
  }
}
