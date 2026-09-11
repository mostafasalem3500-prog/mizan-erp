import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { InventoryService } from "../inventory/inventory.service";
import { ShiftsService } from "./shifts.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { CustomersService } from "../customers/customers.service";

const TAX_RATE_BY_CODE: Record<string, number> = {
  STANDARD: 0.15,
  ZERO: 0,
  EXEMPT: 0,
  OUT_OF_SCOPE: 0,
};

export interface PosSaleLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxCode: keyof typeof TAX_RATE_BY_CODE;
  productId?: string;
}

/** Spec band 37: mixed payment — multiple tenders recorded separately, e.g. Cash 100 + Card 150. */
export interface PaymentTender {
  method: "CASH" | "CARD" | "MADA";
  amount: number;
}

export interface PosSellInput {
  organizationId: string;
  branchId?: string;
  periodId: string;
  terminalId: string;
  customerId?: string; // spec band 39: optional — defaults conceptually to Walk-in Customer when omitted
  lines: PosSaleLineInput[];
  tenders: PaymentTender[];
  idempotencyKey?: string;
  /**
   * Sprint 12 decision (documented, not assumed): linking a sale to a
   * shift is OPT-IN via this field, not mandatory for every POS sale.
   * Making an open shift mandatory for all sales is a stricter policy a
   * real deployment may want, but that's a product decision outside this
   * session's scope to impose unilaterally — see README.md. When
   * provided, this must be an OPEN shift for `terminalId`, or the sale is
   * rejected before anything is posted.
   */
  shiftId?: string;
}

interface RecordedLineEffect {
  lineIndex: number;
  productId: string;
  quantity: number;
  unitCostUsed: string;
  cogsJournalEntryId: string;
}

export interface PosSaleRecord {
  id: string;
  organizationId: string;
  terminalId: string;
  periodId: string;
  lines: PosSaleLineInput[];
  tenders: PaymentTender[];
  subtotal: string;
  taxTotal: string;
  total: string;
  saleJournalEntryId: string;
  inventoryEffects: RecordedLineEffect[];
  status: "COMPLETED" | "PARTIALLY_RETURNED" | "RETURNED";
  shiftId?: string;
  soldAt: string;
  invoiceNumber?: string;
  customerId?: string;
  /** Remaining (not-yet-returned) quantity per line, parallel to `lines` — spec band 41's partial-return support. */
  remainingQuantities: number[];
}

export interface PosGLAccountMapping {
  cashAccountId: string;
  cardClearingAccountId: string;
  salesRevenueAccountId: string;
  vatOutputAccountId: string;
  salesReturnsAccountId: string;
  /** Needed for the partial-return COGS reversal (Dr Inventory / Cr COGS) — spec band 41. */
  inventoryAccountId: string;
  cogsAccountId: string;
}

export interface PosRepository {
  getGLAccountMapping(organizationId: string): Promise<PosGLAccountMapping>;
  saveSale(record: PosSaleRecord): Promise<PosSaleRecord>;
  findSale(organizationId: string, saleId: string): Promise<PosSaleRecord | null>;
  searchSales?(organizationId: string, query?: string): Promise<PosSaleRecord[]>;
}

function round2(value: number): string {
  return value.toFixed(2);
}

/**
 * NOTE on scope (spec bands 32-45): this covers Sell and Return only — the
 * two financially-critical paths (spec band 136 priority order places
 * Accounting Accuracy above Ease of Use / Additional Features). Hold/
 * Resume, Shift open/close/cash-count, and hardware integration (barcode
 * scanner input, receipt printing) are deliberately NOT built yet; they
 * are operational/UX features that don't touch the ledger and can be
 * added without revisiting anything in this file.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly inventoryService: InventoryService,
    private readonly repo: PosRepository,
    private readonly shiftsService: ShiftsService,
    // Sprint 29 — optional and added last on purpose: every existing call
    // site (and every existing test) that constructs PosService without
    // this argument keeps working exactly as before, with the mandatory-
    // shift setting simply defaulting to off. Only organizations that
    // explicitly opt in via OrganizationsService.updateSettings() see any
    // behavior change.
    private readonly organizationsService?: OrganizationsService,
    private readonly customersService?: CustomersService,
  ) {}

  async sell(input: PosSellInput): Promise<PosSaleRecord> {
    if (input.lines.length === 0) {
      throw new BadRequestException("A sale must have at least one line");
    }
    if (input.tenders.length === 0) {
      throw new BadRequestException("A sale must have at least one payment tender");
    }

    if (input.customerId && this.customersService) {
      const customer = await this.customersService.getCustomer(input.organizationId, input.customerId);
      if (!customer) throw new NotFoundException(`Customer ${input.customerId} not found`);
    }

    // Sprint 29 — resolves the Sprint 12 open question. Off by default
    // (undefined organizationsService, or the setting itself unset/false)
    // preserves every existing behavior exactly; an organization must
    // explicitly opt in via updateSettings() before this can reject a sale.
    if (!input.shiftId && this.organizationsService) {
      const org = await this.organizationsService.getOrganization(input.organizationId);
      if (org?.requireShiftForPosSale) {
        throw new BadRequestException(
          "This organization requires an open shift for every POS sale — open a shift before selling",
        );
      }
    }

    if (input.shiftId) {
      const shift = await this.shiftsService.getShift(input.organizationId, input.shiftId);
      if (!shift) {
        throw new NotFoundException(`Shift ${input.shiftId} not found`);
      }
      if (shift.status !== "OPEN") {
        throw new BadRequestException(`Shift ${input.shiftId} is not OPEN`);
      }
      if (shift.terminalId !== input.terminalId) {
        throw new BadRequestException(
          `Shift ${input.shiftId} belongs to terminal ${shift.terminalId}, not ${input.terminalId}`,
        );
      }
    }

    let subtotal = 0;
    let taxTotal = 0;
    for (const line of input.lines) {
      if (line.quantity <= 0) {
        throw new BadRequestException(`Line "${line.description}" must have a positive quantity`);
      }
      const rate = TAX_RATE_BY_CODE[line.taxCode];
      if (rate === undefined) {
        throw new BadRequestException(`Unknown tax code "${line.taxCode}"`);
      }
      const lineNet = line.quantity * line.unitPrice;
      subtotal += lineNet;
      taxTotal += lineNet * rate;
    }
    const total = subtotal + taxTotal;

    const tenderTotal = input.tenders.reduce((sum, t) => sum + t.amount, 0);
    if (Math.abs(tenderTotal - total) > 0.005) {
      throw new BadRequestException(
        `Tender total (${tenderTotal.toFixed(2)}) does not match invoice total (${total.toFixed(2)})`,
      );
    }

    const glMapping = await this.repo.getGLAccountMapping(input.organizationId);

    const cashTendered = input.tenders.filter((t) => t.method === "CASH").reduce((s, t) => s + t.amount, 0);
    const cardTendered = input.tenders.filter((t) => t.method !== "CASH").reduce((s, t) => s + t.amount, 0);

    const debitLines = [
      ...(cashTendered > 0 ? [{ accountId: glMapping.cashAccountId, debit: round2(cashTendered) }] : []),
      ...(cardTendered > 0 ? [{ accountId: glMapping.cardClearingAccountId, debit: round2(cardTendered) }] : []),
    ];

    const saleEntry = await this.postingEngine.post({
      organizationId: input.organizationId,
      branchId: input.branchId,
      periodId: input.periodId,
      sourceEvent: "POS_SALE_COMPLETED",
      reference: `POS sale — terminal ${input.terminalId}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        ...debitLines,
        { accountId: glMapping.salesRevenueAccountId, credit: round2(subtotal) },
        ...(taxTotal > 0 ? [{ accountId: glMapping.vatOutputAccountId, credit: round2(taxTotal) }] : []),
      ],
    });

    const inventoryEffects: RecordedLineEffect[] = [];
    for (let lineIndex = 0; lineIndex < input.lines.length; lineIndex++) {
      const line = input.lines[lineIndex];
      if (line.productId) {
        const result = await this.inventoryService.issueStock({
          organizationId: input.organizationId,
          periodId: input.periodId,
          productId: line.productId,
          quantity: line.quantity,
        });
        inventoryEffects.push({
          lineIndex,
          productId: line.productId,
          quantity: line.quantity,
          unitCostUsed: result.unitCostUsed,
          cogsJournalEntryId: result.journalEntryId,
        });
      }
    }

    if (input.shiftId) {
      // Cash-drawer reconciliation is secondary to the GL posting above,
      // which has already succeeded — a shift-tracking hiccup here must
      // not be reported as if the sale itself failed.
      await this.shiftsService.recordCashMovement(input.organizationId, input.shiftId, "SALE", cashTendered);
    }

    return this.repo.saveSale({
      id: saleEntry.id,
      organizationId: input.organizationId,
      terminalId: input.terminalId,
      periodId: input.periodId,
      lines: input.lines,
      tenders: input.tenders,
      subtotal: round2(subtotal),
      taxTotal: round2(taxTotal),
      total: round2(total),
      saleJournalEntryId: saleEntry.id,
      inventoryEffects,
      status: "COMPLETED",
      shiftId: input.shiftId,
      soldAt: new Date().toISOString(),
      invoiceNumber: `POS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${saleEntry.id.slice(0, 8).toUpperCase()}`,
      customerId: input.customerId,
      remainingQuantities: input.lines.map((l) => l.quantity),
    });
  }

  async searchSales(organizationId: string, query?: string): Promise<PosSaleRecord[]> {
    return this.repo.searchSales ? this.repo.searchSales(organizationId, query?.trim()) : [];
  }

  async getCustomer(organizationId: string, customerId: string) {
    return this.customersService?.getCustomer(organizationId, customerId) ?? null;
  }

  /**
   * Full return only. Reverses BOTH the sale's revenue entry and every
   * stocked line's COGS entry, and restores exactly the quantity issued at
   * exactly the cost used at sale time — never a fresh receipt at
   * "current" cost. Rejected if any line has already been partially
   * returned via `returnItems()` — use `returnItems()` for the remaining
   * quantities instead, so a line is never refunded twice.
   */
  /**
   * Sprint 29 — this method was reviewed for the same compensating-
   * reversal pattern applied to createBill()/returnItems() in Sprint 28,
   * and deliberately left unchanged: unlike a purchase bill's productId
   * (arbitrary user input on every request), every productId here comes
   * from `sale.inventoryEffects`, which was only ever populated by this
   * same service's own sell() — which already validates the product via
   * InventoryService.issueStock() at sale time. There is no current API
   * path that lets a product be deleted after a sale references it, so
   * the "bad input reaches a partial multi-step reversal" failure mode
   * that was real for Purchases does not exist here. What remains is
   * purely the same "no real DB transaction" limitation as everywhere
   * else in this Phase 0 build — a genuine gap, but not one a
   * try/catch-and-reverse patch here would meaningfully close, since a
   * failure partway through several already-completed reversals can't be
   * cleanly undone without either a real transaction or reversing
   * reversals (which is not a safe operation to introduce speculatively).
   */
  async returnSale(organizationId: string, saleId: string, reason: string): Promise<PosSaleRecord> {
    const sale = await this.repo.findSale(organizationId, saleId);
    if (!sale) {
      throw new NotFoundException(`POS sale ${saleId} not found`);
    }
    if (sale.status === "RETURNED") {
      throw new BadRequestException(`POS sale ${saleId} has already been returned`);
    }
    if (sale.status === "PARTIALLY_RETURNED") {
      throw new BadRequestException(
        `POS sale ${saleId} has already had a partial return — use returnItems() for the remaining quantities instead of a full return`,
      );
    }

    await this.postingEngine.reverse(sale.saleJournalEntryId, reason);

    for (const effect of sale.inventoryEffects) {
      await this.postingEngine.reverse(effect.cogsJournalEntryId, reason);
      await this.inventoryService.receiveStock(
        {
          organizationId,
          periodId: "", // unused when postToOpeningBalance=false — no journal entry posted for this restoration
          productId: effect.productId,
          quantity: effect.quantity,
          unitCost: Number(effect.unitCostUsed),
        },
        false,
      );
    }

    if (sale.shiftId) {
      const cashTendered = sale.tenders.filter((t) => t.method === "CASH").reduce((s, t) => s + t.amount, 0);
      const shift = await this.shiftsService.getShift(organizationId, sale.shiftId);
      // If the shift has since been closed, the sale's GL reversal above
      // still stands — cash-drawer reconciliation for a closed shift isn't
      // reopened retroactively, it's simply skipped rather than blocking
      // the return or throwing.
      if (shift && shift.status === "OPEN") {
        await this.shiftsService.recordCashMovement(organizationId, sale.shiftId, "RETURN", cashTendered);
      }
    }

    const updated: PosSaleRecord = {
      ...sale,
      status: "RETURNED",
      remainingQuantities: sale.lines.map(() => 0),
    };
    return this.repo.saveSale(updated);
  }

  /**
   * Partial return (spec band 41). Accepts specific (lineIndex, quantity)
   * pairs — never more than what remains on that line. Posts ONE new
   * balanced entry (POS_RETURN_COMPLETED) using the Sales Returns contra-
   * revenue account rather than debiting Sales directly, and its own
   * proportional COGS reversal (Dr Inventory / Cr COGS) for stocked lines
   * — this is deliberately a NEW entry, not a reversal of the original
   * sale entry, because only part of that entry is being undone.
   *
   * Simplification stated plainly: the refund is always posted to Cash,
   * regardless of how the original sale was tendered (cash/card/mixed).
   * A real deployment may want to refund to the original tender's account
   * instead — left as a follow-up product decision rather than assumed.
   */
  async returnItems(
    organizationId: string,
    saleId: string,
    reason: string,
    items: Array<{ lineIndex: number; quantity: number }>,
  ): Promise<PosSaleRecord> {
    const sale = await this.repo.findSale(organizationId, saleId);
    if (!sale) {
      throw new NotFoundException(`POS sale ${saleId} not found`);
    }
    if (sale.status === "RETURNED") {
      throw new BadRequestException(`POS sale ${saleId} has already been fully returned`);
    }
    if (items.length === 0) {
      throw new BadRequestException("At least one line item must be specified for a partial return");
    }

    const remaining = [...sale.remainingQuantities];
    let netReturn = 0;
    let taxReturn = 0;
    const cogsByProduct = new Map<string, { productId: string; quantity: number; unitCost: string }>();

    for (const item of items) {
      const line = sale.lines[item.lineIndex];
      if (!line) {
        throw new BadRequestException(`Sale ${saleId} has no line at index ${item.lineIndex}`);
      }
      if (item.quantity <= 0) {
        throw new BadRequestException(`Return quantity for line ${item.lineIndex} must be positive`);
      }
      if (item.quantity > remaining[item.lineIndex]) {
        throw new BadRequestException(
          `Cannot return ${item.quantity} of line ${item.lineIndex}: only ${remaining[item.lineIndex]} remains un-returned`,
        );
      }

      const rate = TAX_RATE_BY_CODE[line.taxCode];
      const lineNet = item.quantity * line.unitPrice;
      netReturn += lineNet;
      taxReturn += lineNet * rate;
      remaining[item.lineIndex] -= item.quantity;

      const effect = sale.inventoryEffects.find((e) => e.lineIndex === item.lineIndex);
      if (effect) {
        cogsByProduct.set(item.lineIndex.toString(), {
          productId: effect.productId,
          quantity: item.quantity,
          unitCost: effect.unitCostUsed,
        });
      }
    }

    const totalRefund = netReturn + taxReturn;
    const glMapping = await this.repo.getGLAccountMapping(organizationId);
    const cogsValue = [...cogsByProduct.values()].reduce((sum, e) => sum + e.quantity * Number(e.unitCost), 0);

    const returnEntry = await this.postingEngine.post({
      organizationId,
      periodId: sale.periodId,
      sourceEvent: "POS_RETURN_COMPLETED",
      reference: `Partial return of POS sale ${saleId}: ${reason}`,
      lines: [
        { accountId: glMapping.salesReturnsAccountId, debit: round2(netReturn) },
        ...(taxReturn > 0 ? [{ accountId: glMapping.vatOutputAccountId, debit: round2(taxReturn) }] : []),
        ...(cogsValue > 0 ? [{ accountId: glMapping.inventoryAccountId, debit: round2(cogsValue) }] : []),
        { accountId: glMapping.cashAccountId, credit: round2(totalRefund) },
        ...(cogsValue > 0 ? [{ accountId: glMapping.cogsAccountId, credit: round2(cogsValue) }] : []),
      ],
    });

    // Sprint 28 — same compensating-transaction pattern as
    // PurchasesService.createBill(): if restoring inventory fails after
    // this return entry has already posted, automatically reverse the
    // entry rather than leave the books showing a return that never
    // actually happened to stock. The productId here comes from the
    // original sale's own recorded inventoryEffects (already validated
    // when that sale was made), so this guards against a genuine
    // mid-operation failure, not bad input.
    try {
      for (const { productId, quantity, unitCost } of cogsByProduct.values()) {
        await this.inventoryService.receiveStock(
          { organizationId, periodId: "", productId, quantity, unitCost: Number(unitCost) },
          false,
        );
      }
    } catch (err) {
      await this.postingEngine.reverse(returnEntry.id, "Automatic reversal — inventory restoration failed after return posting");
      throw err;
    }

    if (sale.shiftId) {
      const shift = await this.shiftsService.getShift(organizationId, sale.shiftId);
      if (shift && shift.status === "OPEN") {
        await this.shiftsService.recordCashMovement(organizationId, sale.shiftId, "RETURN", totalRefund);
      }
    }

    const allReturned = remaining.every((q) => q === 0);
    const updated: PosSaleRecord = {
      ...sale,
      remainingQuantities: remaining,
      status: allReturned ? "RETURNED" : "PARTIALLY_RETURNED",
    };
    return this.repo.saveSale(updated);
  }

  async getSale(organizationId: string, saleId: string): Promise<PosSaleRecord | null> {
    return this.repo.findSale(organizationId, saleId);
  }
}
