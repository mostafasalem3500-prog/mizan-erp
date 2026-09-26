import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { ProductsService } from "./products.service";

export interface StockLevel {
  organizationId: string;
  productId: string;
  quantityOnHand: number;
  /** Weighted Average Cost per unit (spec band 26 — MVP starts here, FIFO is future architecture) */
  averageCost: string;
}

export interface ReceiveStockInput {
  organizationId: string;
  periodId: string;
  productId: string;
  quantity: number;
  /** Unit cost of THIS receipt — distinct from the running average, which this call recalculates. */
  unitCost: number;
  idempotencyKey?: string;
}

export interface IssueStockInput {
  organizationId: string;
  periodId: string;
  productId: string;
  quantity: number;
  idempotencyKey?: string;
}

export interface IssueStockResult {
  journalEntryId: string;
  quantityIssued: number;
  unitCostUsed: string;
  totalCogs: string;
}

/** Where inventory movements land in the GL — spec band 20: sourced from settings, never hardcoded. */
export interface InventoryGLAccountMapping {
  inventoryAccountId: string;
  cogsAccountId: string;
  openingBalanceEquityAccountId: string;
}

export interface InventoryRepository {
  getGLAccountMapping(organizationId: string): Promise<InventoryGLAccountMapping>;
  getStockLevel(organizationId: string, productId: string): Promise<StockLevel | null>;
  /** Atomically replaces the stock level row — a real Postgres implementation does this inside the same DB transaction as the journal posting. */
  saveStockLevel(level: StockLevel): Promise<void>;
}

function round2(value: number): string {
  return value.toFixed(2);
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly productsService: ProductsService,
    private readonly repo: InventoryRepository,
  ) {}

  async getStock(organizationId: string, productId: string): Promise<StockLevel> {
    const level = await this.repo.getStockLevel(organizationId, productId);
    return level ?? { organizationId, productId, quantityOnHand: 0, averageCost: "0.00" };
  }

  /**
   * Receives stock and recalculates the Weighted Average Cost (spec band
   * 26): newAvg = (oldQty*oldAvg + receivedQty*receivedUnitCost) / (oldQty
   * + receivedQty). Posts Dr Inventory / Cr Opening Balance Equity — a
   * standalone receipt with no supplier bill behind it yet (spec band 123
   * row "INVENTORY_RECEIVED"). PurchasesService posts its own bill
   * differently (Dr Inventory / Cr Accounts Payable) and calls this method
   * only for the stock/cost-tracking side effect, not for its own GL lines.
   */
  async receiveStock(input: ReceiveStockInput, postToOpeningBalance = true): Promise<{ journalEntryId?: string; newAverageCost: string }> {
    if (input.quantity <= 0) {
      throw new BadRequestException("Received quantity must be positive");
    }
    const product = await this.productsService.getProduct(input.organizationId, input.productId);
    if (!product) {
      throw new NotFoundException(`Product ${input.productId} not found`);
    }

    const current = await this.getStock(input.organizationId, input.productId);
    const oldQty = current.quantityOnHand;
    const oldAvg = Number(current.averageCost);
    const newQty = oldQty + input.quantity;
    const newAvg = newQty === 0 ? 0 : (oldQty * oldAvg + input.quantity * input.unitCost) / newQty;

    await this.repo.saveStockLevel({
      organizationId: input.organizationId,
      productId: input.productId,
      quantityOnHand: newQty,
      averageCost: round2(newAvg),
    });

    if (!postToOpeningBalance) {
      // Called from PurchasesService, which posts its own bill entry —
      // this method only updates quantity/cost, no separate journal entry.
      return { newAverageCost: round2(newAvg) };
    }

    const glMapping = await this.repo.getGLAccountMapping(input.organizationId);
    const receiptValue = input.quantity * input.unitCost;

    const entry = await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "INVENTORY_RECEIVED",
      reference: `Stock receipt: ${input.quantity} x ${input.productId} @ ${input.unitCost}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: glMapping.inventoryAccountId, debit: round2(receiptValue) },
        { accountId: glMapping.openingBalanceEquityAccountId, credit: round2(receiptValue) },
      ],
    });

    return { journalEntryId: entry.id, newAverageCost: round2(newAvg) };
  }

  /**
   * Issues stock at the current Weighted Average Cost and posts the COGS
   * entry (Dr COGS / Cr Inventory). Rejects an issue that would take
   * quantity on hand negative — spec doesn't explicitly forbid negative
   * stock, but band 151 ("المخزون يمكن مطابقته") argues for rejecting
   * rather than silently allowing untraceable negative inventory in Phase 0.
   */
  async issueStock(input: IssueStockInput, postJournal = true): Promise<IssueStockResult> {
    if (input.quantity <= 0) {
      throw new BadRequestException("Issued quantity must be positive");
    }

    const current = await this.getStock(input.organizationId, input.productId);
    if (current.quantityOnHand < input.quantity) {
      throw new BadRequestException(
        `Insufficient stock for product ${input.productId}: have ${current.quantityOnHand}, tried to issue ${input.quantity}`,
      );
    }

    const unitCost = Number(current.averageCost);
    const totalCogs = input.quantity * unitCost;
    const newQty = current.quantityOnHand - input.quantity;

    await this.repo.saveStockLevel({
      organizationId: input.organizationId,
      productId: input.productId,
      quantityOnHand: newQty,
      averageCost: current.averageCost, // issuing stock never changes the average cost, only receiving does
    });

    if (!postJournal) {
      // Called from SalesService/POS, which posts its own revenue entry in
      // the SAME call to the engine as this COGS effect ideally would be —
      // Phase 0 limitation: these are two separate postings, not one
      // atomic transaction spanning both. See docs/MVP_ROADMAP.md Sprint 6.
      return { journalEntryId: "", quantityIssued: input.quantity, unitCostUsed: current.averageCost, totalCogs: round2(totalCogs) };
    }

    const glMapping = await this.repo.getGLAccountMapping(input.organizationId);
    const entry = await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "INVENTORY_ISSUED",
      reference: `Stock issue: ${input.quantity} x ${input.productId}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: glMapping.cogsAccountId, debit: round2(totalCogs) },
        { accountId: glMapping.inventoryAccountId, credit: round2(totalCogs) },
      ],
    });

    return {
      journalEntryId: entry.id,
      quantityIssued: input.quantity,
      unitCostUsed: current.averageCost,
      totalCogs: round2(totalCogs),
    };
  }
}
