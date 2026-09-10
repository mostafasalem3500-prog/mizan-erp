import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { SuppliersService } from "../suppliers/suppliers.service";
import { InventoryService } from "../inventory/inventory.service";
import { ProductsService } from "../inventory/products.service";

const TAX_RATE_BY_CODE: Record<string, number> = {
  STANDARD: 0.15,
  ZERO: 0,
  EXEMPT: 0,
  OUT_OF_SCOPE: 0,
};

export interface PurchaseBillLineInput {
  description: string;
  quantity: number;
  unitCost: number;
  taxCode: keyof typeof TAX_RATE_BY_CODE;
  /** When set, this line also updates inventory stock/weighted-average cost for that product (spec bands 20/26 integration). */
  productId?: string;
}

export interface CreatePurchaseBillInput {
  organizationId: string;
  branchId?: string;
  periodId: string;
  supplierId: string;
  lines: PurchaseBillLineInput[];
  idempotencyKey?: string;
}

export interface PurchaseBillRecord {
  id: string;
  organizationId: string;
  supplierId: string;
  lines: PurchaseBillLineInput[];
  subtotal: string;
  taxTotal: string;
  total: string;
  journalEntryId: string;
  issueDate: string;
  paidAmount: string;
}

export interface PurchasesGLAccountMapping {
  inventoryAccountId: string;
  vatInputAccountId: string;
  accountsPayableAccountId: string;
  /** For lines with no productId — a Bill can cover non-inventory expenses too (spec band 23 doesn't restrict Bills to stocked goods). */
  generalExpenseAccountId: string;
}

export interface PurchasesRepository {
  getGLAccountMapping(organizationId: string): Promise<PurchasesGLAccountMapping>;
  saveBill(record: PurchaseBillRecord): Promise<PurchaseBillRecord>;
  findBill(organizationId: string, billId: string): Promise<PurchaseBillRecord | null>;
  listBillsForSupplier(organizationId: string, supplierId: string): Promise<PurchaseBillRecord[]>;
  listAllBills(organizationId: string): Promise<PurchaseBillRecord[]>;
}

function round2(value: number): string {
  return value.toFixed(2);
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly suppliersService: SuppliersService,
    private readonly inventoryService: InventoryService,
    private readonly repo: PurchasesRepository,
    private readonly productsService: ProductsService,
  ) {}

  /**
   * Simple Mode per spec band 23: Bill -> Payment, no PR/PO/Goods-Receipt
   * workflow. Posts Dr Inventory (or Expense, for non-stocked lines) + Dr
   * VAT Input / Cr Accounts Payable (spec band 123's PURCHASE_BILL_POSTED
   * row) in ONE journal entry, then separately updates each stocked line's
   * inventory quantity/weighted-average cost via
   * InventoryService.receiveStock(..., postToOpeningBalance=false) so the
   * cost side effect happens without a second, conflicting journal entry.
   *
   * Known Phase 0 gap (see docs/MVP_ROADMAP.md): the bill's own journal
   * posting and each line's inventory update are still two separate calls,
   * not one atomic transaction — a crash between them could leave a
   * posted bill whose stock wasn't updated. Fixing this properly means
   * extending AccountingPostingEngine to accept inventory side effects
   * inside its own transaction, which is intentionally deferred rather
   * than rushed.
   */
  async createBill(input: CreatePurchaseBillInput): Promise<PurchaseBillRecord> {
    if (input.lines.length === 0) {
      throw new BadRequestException("A bill must have at least one line");
    }

    const supplier = await this.suppliersService.getSupplier(input.organizationId, input.supplierId);
    if (!supplier) {
      throw new NotFoundException(`Supplier ${input.supplierId} not found`);
    }

    // Sprint 28 — closes the Sprint 6-8 atomicity gap's most concrete
    // failure mode: validate every referenced product BEFORE posting the
    // GL entry below. Previously a bad productId would only surface
    // AFTER a "Dr Inventory" journal entry had already been posted,
    // leaving the books permanently overstated with no product/stock
    // record to match it — the GL said inventory rose, but nothing real
    // backed that. Failing fast here means a bad line never reaches the
    // ledger at all, which is strictly better than posting-then-reversing.
    for (const line of input.lines) {
      if (line.productId) {
        const product = await this.productsService.getProduct(input.organizationId, line.productId);
        if (!product) {
          throw new NotFoundException(`Product ${line.productId} not found`);
        }
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
      const lineNet = line.quantity * line.unitCost;
      subtotal += lineNet;
      taxTotal += lineNet * rate;
    }
    const total = subtotal + taxTotal;

    const glMapping = await this.repo.getGLAccountMapping(input.organizationId);

    const stockedSubtotal = input.lines
      .filter((l) => l.productId)
      .reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
    const nonStockedSubtotal = subtotal - stockedSubtotal;

    const debitLines = [
      ...(stockedSubtotal > 0 ? [{ accountId: glMapping.inventoryAccountId, debit: round2(stockedSubtotal) }] : []),
      ...(nonStockedSubtotal > 0 ? [{ accountId: glMapping.generalExpenseAccountId, debit: round2(nonStockedSubtotal) }] : []),
      ...(taxTotal > 0 ? [{ accountId: glMapping.vatInputAccountId, debit: round2(taxTotal) }] : []),
    ];

    const journalEntry = await this.postingEngine.post({
      organizationId: input.organizationId,
      branchId: input.branchId,
      periodId: input.periodId,
      sourceEvent: "PURCHASE_BILL_POSTED",
      reference: `Purchase bill from supplier ${input.supplierId}`,
      idempotencyKey: input.idempotencyKey,
      lines: [...debitLines, { accountId: glMapping.accountsPayableAccountId, credit: round2(total) }],
    });

    // Update stock/weighted-average cost for each stocked line — no
    // separate journal entry (postToOpeningBalance=false), since this
    // bill's own posting above already recorded the Dr Inventory effect.
    //
    // Sprint 28 — this loop and the GL post above are still two separate
    // calls, not one DB transaction (that still needs a real Prisma/
    // Postgres backend to do properly). What's new: if anything in this
    // loop throws despite the pre-validation above (a race condition, a
    // repository error, etc.), the GL entry already posted is
    // automatically REVERSED via the posting engine's own reversal path
    // before the error propagates — so a failure here can no longer
    // leave a dangling, unreversed journal entry with no matching
    // inventory movement. This is a compensating transaction, not true
    // atomicity, but it closes the specific failure mode that mattered:
    // books silently drifting out of sync with real inventory.
    try {
      for (const line of input.lines) {
        if (line.productId) {
          await this.inventoryService.receiveStock(
            {
              organizationId: input.organizationId,
              periodId: input.periodId,
              productId: line.productId,
              quantity: line.quantity,
              unitCost: line.unitCost,
            },
            false,
          );
        }
      }
    } catch (err) {
      await this.postingEngine.reverse(journalEntry.id, "Automatic reversal — inventory update failed after GL posting");
      throw err;
    }

    return this.repo.saveBill({
      id: journalEntry.id,
      organizationId: input.organizationId,
      supplierId: input.supplierId,
      lines: input.lines,
      subtotal: round2(subtotal),
      taxTotal: round2(taxTotal),
      total: round2(total),
      journalEntryId: journalEntry.id,
      issueDate: new Date().toISOString(),
      paidAmount: "0.00",
    });
  }

  async getBill(organizationId: string, billId: string): Promise<PurchaseBillRecord | null> {
    return this.repo.findBill(organizationId, billId);
  }

  async listBillsForSupplier(organizationId: string, supplierId: string): Promise<PurchaseBillRecord[]> {
    return this.repo.listBillsForSupplier(organizationId, supplierId);
  }

  async listAllBills(organizationId: string): Promise<PurchaseBillRecord[]> {
    return this.repo.listAllBills(organizationId);
  }

  /** Payment application, mirroring SalesService.applyPayment() (Sprint 19). */
  async applyPayment(organizationId: string, billId: string, amount: number): Promise<PurchaseBillRecord> {
    const bill = await this.repo.findBill(organizationId, billId);
    if (!bill) {
      throw new NotFoundException(`Bill ${billId} not found`);
    }
    const newPaid = Number(bill.paidAmount) + amount;
    if (newPaid > Number(bill.total) + 0.005) {
      throw new BadRequestException(
        `Applying ${amount.toFixed(2)} would overpay bill ${billId}: total ${bill.total}, already paid ${bill.paidAmount}`,
      );
    }
    return this.repo.saveBill({ ...bill, paidAmount: round2(newPaid) });
  }
}
