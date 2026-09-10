import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PurchasesService, PurchasesRepository, PurchasesGLAccountMapping } from "./purchases.service";
import { SuppliersService } from "../suppliers/suppliers.service";
import { InventoryService } from "../inventory/inventory.service";
import { ProductsService } from "../inventory/products.service";

function makeSuppliersService(exists: boolean) {
  return {
    getSupplier: jest.fn().mockResolvedValue(exists ? { id: "sup-1", organizationId: "org-1", name: "ACME Supplies" } : null),
  } as unknown as SuppliersService;
}

function makePostingEngine() {
  const calls: any[] = [];
  const reverseCalls: any[] = [];
  return {
    engine: {
      post: jest.fn().mockImplementation(async (req: any) => {
        calls.push(req);
        return { id: `je-${calls.length}`, ...req };
      }),
      reverse: jest.fn().mockImplementation(async (journalEntryId: string, reason: string) => {
        reverseCalls.push({ journalEntryId, reason });
        return { id: `reversal-${reverseCalls.length}` };
      }),
    },
    calls,
    reverseCalls,
  };
}

function makeInventoryService() {
  return { receiveStock: jest.fn().mockResolvedValue({ newAverageCost: "10.00" }) } as unknown as InventoryService;
}

function makeProductsService(exists: boolean = true) {
  return {
    getProduct: jest.fn().mockResolvedValue(exists ? { id: "prod-1", organizationId: "org-1", sku: "SKU-1", name: "Product" } : null),
  } as unknown as ProductsService;
}

function makeRepo(): PurchasesRepository {
  const glMapping: PurchasesGLAccountMapping = {
    inventoryAccountId: "inventory",
    vatInputAccountId: "vat_input",
    accountsPayableAccountId: "accounts_payable",
    generalExpenseAccountId: "general_expense",
  };
  const bills = new Map<string, any>();
  return {
    getGLAccountMapping: jest.fn().mockResolvedValue(glMapping),
    saveBill: jest.fn().mockImplementation(async (record) => { bills.set(record.id, record); return record; }),
    findBill: jest.fn().mockImplementation(async (_org: string, id: string) => bills.get(id) ?? null),
    listBillsForSupplier: jest.fn().mockResolvedValue([]),
    listAllBills: jest.fn().mockResolvedValue([]),
  };
}

describe("PurchasesService", () => {
  test("posts Dr Inventory + VAT Input / Cr Accounts Payable for a stocked, standard-rated line", async () => {
    const { engine, calls } = makePostingEngine();
    const inventory = makeInventoryService();
    const repo = makeRepo();
    const service = new PurchasesService(engine as any, makeSuppliersService(true), inventory, repo, makeProductsService());

    const bill = await service.createBill({
      organizationId: "org-1",
      periodId: "period-1",
      supplierId: "sup-1",
      lines: [{ description: "Widgets", quantity: 100, unitCost: 10, taxCode: "STANDARD", productId: "prod-1" }],
    });

    expect(bill.subtotal).toBe("1000.00");
    expect(bill.taxTotal).toBe("150.00");
    expect(bill.total).toBe("1150.00");
    expect(calls[0].lines).toEqual([
      { accountId: "inventory", debit: "1000.00" },
      { accountId: "vat_input", debit: "150.00" },
      { accountId: "accounts_payable", credit: "1150.00" },
    ]);
  });

  test("routes a non-stocked line (no productId) to the general expense account instead of Inventory", async () => {
    const { engine, calls } = makePostingEngine();
    const inventory = makeInventoryService();
    const repo = makeRepo();
    const service = new PurchasesService(engine as any, makeSuppliersService(true), inventory, repo, makeProductsService());

    await service.createBill({
      organizationId: "org-1",
      periodId: "period-1",
      supplierId: "sup-1",
      lines: [{ description: "Office rent", quantity: 1, unitCost: 500, taxCode: "STANDARD" }],
    });

    expect(calls[0].lines).toEqual([
      { accountId: "general_expense", debit: "500.00" },
      { accountId: "vat_input", debit: "75.00" },
      { accountId: "accounts_payable", credit: "575.00" },
    ]);
    expect(inventory.receiveStock).not.toHaveBeenCalled();
  });

  test("splits a mixed bill correctly between Inventory and general expense", async () => {
    const { engine, calls } = makePostingEngine();
    const inventory = makeInventoryService();
    const repo = makeRepo();
    const service = new PurchasesService(engine as any, makeSuppliersService(true), inventory, repo, makeProductsService());

    await service.createBill({
      organizationId: "org-1",
      periodId: "period-1",
      supplierId: "sup-1",
      lines: [
        { description: "Stocked widgets", quantity: 10, unitCost: 10, taxCode: "ZERO", productId: "prod-1" },
        { description: "Delivery fee", quantity: 1, unitCost: 50, taxCode: "ZERO" },
      ],
    });

    expect(calls[0].lines).toEqual([
      { accountId: "inventory", debit: "100.00" },
      { accountId: "general_expense", debit: "50.00" },
      { accountId: "accounts_payable", credit: "150.00" },
    ]);
  });

  test("calls InventoryService.receiveStock for each stocked line with postToOpeningBalance=false (no duplicate journal entry)", async () => {
    const { engine } = makePostingEngine();
    const inventory = makeInventoryService();
    const repo = makeRepo();
    const service = new PurchasesService(engine as any, makeSuppliersService(true), inventory, repo, makeProductsService());

    await service.createBill({
      organizationId: "org-1",
      periodId: "period-1",
      supplierId: "sup-1",
      lines: [{ description: "Widgets", quantity: 20, unitCost: 15, taxCode: "STANDARD", productId: "prod-9" }],
    });

    expect(inventory.receiveStock).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "prod-9", quantity: 20, unitCost: 15 }),
      false, // must NOT post its own opening-balance journal entry — the bill already posted Dr Inventory
    );
  });

  test("rejects a bill with zero lines", async () => {
    const service = new PurchasesService(makePostingEngine().engine as any, makeSuppliersService(true), makeInventoryService(), makeRepo(), makeProductsService());

    await expect(
      service.createBill({ organizationId: "org-1", periodId: "period-1", supplierId: "sup-1", lines: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a bill for a supplier that doesn't exist", async () => {
    const service = new PurchasesService(makePostingEngine().engine as any, makeSuppliersService(false), makeInventoryService(), makeRepo(), makeProductsService());

    await expect(
      service.createBill({
        organizationId: "org-1",
        periodId: "period-1",
        supplierId: "ghost",
        lines: [{ description: "X", quantity: 1, unitCost: 10, taxCode: "STANDARD" }],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("PurchasesService — applyPayment (Sprint 19)", () => {
  test("applies a partial payment and updates paidAmount", async () => {
    const repo = makeRepo();
    const service = new PurchasesService(makePostingEngine().engine as any, makeSuppliersService(true), makeInventoryService(), repo, makeProductsService());

    const bill = await service.createBill({
      organizationId: "org-1", periodId: "period-1", supplierId: "sup-1",
      lines: [{ description: "X", quantity: 1, unitCost: 100, taxCode: "ZERO" }],
    });

    const updated = await service.applyPayment("org-1", bill.id, 40);
    expect(updated.paidAmount).toBe("40.00");
  });

  test("rejects a payment that would overpay the bill", async () => {
    const repo = makeRepo();
    const service = new PurchasesService(makePostingEngine().engine as any, makeSuppliersService(true), makeInventoryService(), repo, makeProductsService());

    const bill = await service.createBill({
      organizationId: "org-1", periodId: "period-1", supplierId: "sup-1",
      lines: [{ description: "X", quantity: 1, unitCost: 100, taxCode: "ZERO" }],
    });

    await expect(service.applyPayment("org-1", bill.id, 150)).rejects.toThrow(/overpay/);
  });

  test("rejects applying a payment to a bill that doesn't exist", async () => {
    const service = new PurchasesService(makePostingEngine().engine as any, makeSuppliersService(true), makeInventoryService(), makeRepo(), makeProductsService());
    await expect(service.applyPayment("org-1", "ghost-bill", 10)).rejects.toThrow(NotFoundException);
  });
});

describe("PurchasesService — atomicity fix (Sprint 28)", () => {
  test("rejects a bill referencing a non-existent product BEFORE posting any journal entry", async () => {
    const { engine, calls } = makePostingEngine();
    const service = new PurchasesService(
      engine as any,
      makeSuppliersService(true),
      makeInventoryService(),
      makeRepo(),
      makeProductsService(false), // product does NOT exist
    );

    await expect(
      service.createBill({
        organizationId: "org-1",
        periodId: "period-1",
        supplierId: "sup-1",
        lines: [{ description: "X", quantity: 1, unitCost: 10, taxCode: "STANDARD", productId: "ghost-product" }],
      }),
    ).rejects.toThrow(NotFoundException);

    // The critical assertion: no journal entry was posted for the bad line.
    // Before this fix, `post()` would have already been called here.
    expect(calls).toHaveLength(0);
  });

  test("allows a bill with a valid product to proceed normally", async () => {
    const { engine, calls } = makePostingEngine();
    const service = new PurchasesService(
      engine as any,
      makeSuppliersService(true),
      makeInventoryService(),
      makeRepo(),
      makeProductsService(true),
    );

    await service.createBill({
      organizationId: "org-1",
      periodId: "period-1",
      supplierId: "sup-1",
      lines: [{ description: "X", quantity: 1, unitCost: 10, taxCode: "STANDARD", productId: "prod-1" }],
    });

    expect(calls).toHaveLength(1);
  });

  test("automatically reverses the journal entry if inventory update fails after posting", async () => {
    const { engine, calls, reverseCalls } = makePostingEngine();
    const failingInventory = {
      receiveStock: jest.fn().mockRejectedValue(new Error("simulated inventory failure")),
    } as unknown as InventoryService;

    const service = new PurchasesService(
      engine as any,
      makeSuppliersService(true),
      failingInventory,
      makeRepo(),
      makeProductsService(true),
    );

    await expect(
      service.createBill({
        organizationId: "org-1",
        periodId: "period-1",
        supplierId: "sup-1",
        lines: [{ description: "X", quantity: 1, unitCost: 10, taxCode: "STANDARD", productId: "prod-1" }],
      }),
    ).rejects.toThrow("simulated inventory failure");

    // The journal entry WAS posted (product existed, validation passed)...
    expect(calls).toHaveLength(1);
    // ...but since inventory update failed afterward, it must have been reversed.
    expect(reverseCalls).toHaveLength(1);
    expect(reverseCalls[0].journalEntryId).toBe(calls[0] ? "je-1" : undefined);
  });

  test("does NOT reverse anything when everything succeeds", async () => {
    const { engine, reverseCalls } = makePostingEngine();
    const service = new PurchasesService(
      engine as any,
      makeSuppliersService(true),
      makeInventoryService(),
      makeRepo(),
      makeProductsService(true),
    );

    await service.createBill({
      organizationId: "org-1",
      periodId: "period-1",
      supplierId: "sup-1",
      lines: [{ description: "X", quantity: 1, unitCost: 10, taxCode: "STANDARD", productId: "prod-1" }],
    });

    expect(reverseCalls).toHaveLength(0);
  });
});
