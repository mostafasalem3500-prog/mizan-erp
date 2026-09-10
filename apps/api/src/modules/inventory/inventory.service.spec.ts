import { BadRequestException, NotFoundException } from "@nestjs/common";
import { InventoryService, InventoryRepository, InventoryGLAccountMapping, StockLevel } from "./inventory.service";
import { ProductsService } from "./products.service";

function makeProductsService(exists: boolean) {
  return {
    getProduct: jest.fn().mockResolvedValue(exists ? { id: "prod-1", organizationId: "org-1", name: "Widget" } : null),
  } as unknown as ProductsService;
}

function makePostingEngine() {
  const calls: any[] = [];
  return {
    engine: {
      post: jest.fn().mockImplementation(async (req: any) => {
        calls.push(req);
        return { id: `je-${calls.length}`, ...req };
      }),
    },
    calls,
  };
}

function makeRepo() {
  const glMapping: InventoryGLAccountMapping = {
    inventoryAccountId: "inventory",
    cogsAccountId: "cogs",
    openingBalanceEquityAccountId: "opening_balance_equity",
  };
  const stock = new Map<string, StockLevel>();
  const repo: InventoryRepository = {
    getGLAccountMapping: jest.fn().mockResolvedValue(glMapping),
    getStockLevel: jest.fn().mockImplementation(async (orgId: string, productId: string) => stock.get(`${orgId}:${productId}`) ?? null),
    saveStockLevel: jest.fn().mockImplementation(async (level: StockLevel) => {
      stock.set(`${level.organizationId}:${level.productId}`, level);
    }),
  };
  return { repo, stock };
}

describe("InventoryService — Weighted Average Costing (spec band 26)", () => {
  test("first receipt sets quantity and average cost directly", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    const result = await service.receiveStock({
      organizationId: "org-1",
      periodId: "period-1",
      productId: "prod-1",
      quantity: 100,
      unitCost: 10,
    });

    expect(result.newAverageCost).toBe("10.00");
    const stock = await service.getStock("org-1", "prod-1");
    expect(stock.quantityOnHand).toBe(100);
  });

  test("second receipt at a different cost recalculates the weighted average correctly", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 100, unitCost: 10 });
    // (100*10 + 50*16) / 150 = (1000 + 800) / 150 = 12.00
    const result = await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 50, unitCost: 16 });

    expect(result.newAverageCost).toBe("12.00");
    const stock = await service.getStock("org-1", "prod-1");
    expect(stock.quantityOnHand).toBe(150);
  });

  test("issuing stock uses the current weighted average cost for COGS, not the original receipt cost", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 100, unitCost: 10 });
    await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 50, unitCost: 16 }); // avg becomes 12.00

    const result = await service.issueStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 30 });

    expect(result.unitCostUsed).toBe("12.00");
    expect(result.totalCogs).toBe("360.00"); // 30 * 12.00

    const stock = await service.getStock("org-1", "prod-1");
    expect(stock.quantityOnHand).toBe(120); // 150 - 30
    expect(stock.averageCost).toBe("12.00"); // issuing never changes the average
  });

  test("posts Dr Inventory / Cr Opening Balance Equity on receipt", async () => {
    const { engine, calls } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 10, unitCost: 5 });

    expect(calls[0].sourceEvent).toBe("INVENTORY_RECEIVED");
    expect(calls[0].lines).toEqual([
      { accountId: "inventory", debit: "50.00" },
      { accountId: "opening_balance_equity", credit: "50.00" },
    ]);
  });

  test("posts Dr COGS / Cr Inventory on issue", async () => {
    const { engine, calls } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 10, unitCost: 5 });
    await service.issueStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 4 });

    const issueCall = calls[1];
    expect(issueCall.sourceEvent).toBe("INVENTORY_ISSUED");
    expect(issueCall.lines).toEqual([
      { accountId: "cogs", debit: "20.00" },
      { accountId: "inventory", credit: "20.00" },
    ]);
  });

  test("rejects issuing more than is on hand", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 5, unitCost: 5 });

    await expect(
      service.issueStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 10 }),
    ).rejects.toThrow(/Insufficient stock/);
  });

  test("rejects a receipt for a product that doesn't exist", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(false), repo);

    await expect(
      service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "ghost", quantity: 1, unitCost: 1 }),
    ).rejects.toThrow(NotFoundException);
  });

  test("rejects zero/negative quantities on both receipt and issue", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    await expect(
      service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 0, unitCost: 1 }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.issueStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: -1 }),
    ).rejects.toThrow(BadRequestException);
  });

  test("skips its own journal posting when called with postJournal=false (integration mode from Sales/Purchases/POS)", async () => {
    const { engine, calls } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new InventoryService(engine as any, makeProductsService(true), repo);

    await service.receiveStock({ organizationId: "org-1", periodId: "period-1", productId: "prod-1", quantity: 10, unitCost: 5 }, false);
    expect(calls).toHaveLength(0); // no journal entry posted — caller (e.g. Purchases) posts its own

    const stock = await service.getStock("org-1", "prod-1");
    expect(stock.quantityOnHand).toBe(10); // but the stock/cost side effect still happened
  });
});
