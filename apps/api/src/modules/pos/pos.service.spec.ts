import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PosService, PosRepository, PosGLAccountMapping, PosSaleRecord } from "./pos.service";
import { InventoryService } from "../inventory/inventory.service";
import { ShiftsService } from "./shifts.service";

function makePostingEngine() {
  const calls: any[] = [];
  const reversals: any[] = [];
  return {
    engine: {
      post: jest.fn().mockImplementation(async (req: any) => {
        calls.push(req);
        return { id: `je-${calls.length}`, ...req };
      }),
      reverse: jest.fn().mockImplementation(async (journalEntryId: string, reason: string) => {
        reversals.push({ journalEntryId, reason });
        return { id: `rev-${reversals.length}`, isReversal: true };
      }),
    },
    calls,
    reversals,
  };
}

function makeInventoryService(unitCost = "12.00") {
  let issueCount = 0;
  return {
    issueStock: jest.fn().mockImplementation(async () => {
      issueCount += 1;
      return { journalEntryId: `cogs-je-${issueCount}`, quantityIssued: 1, unitCostUsed: unitCost, totalCogs: "0.00" };
    }),
    receiveStock: jest.fn().mockResolvedValue({ newAverageCost: unitCost }),
  } as unknown as InventoryService;
}

/** A no-op ShiftsService double — sufficient for every test that never passes `shiftId`. */
function makeShiftsService(overrides: Partial<Record<keyof ShiftsService, any>> = {}) {
  return {
    getShift: jest.fn().mockResolvedValue(null),
    recordCashMovement: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ShiftsService;
}

function makeRepo() {
  const sales = new Map<string, PosSaleRecord>();
  const glMapping: PosGLAccountMapping = {
    cashAccountId: "cash",
    cardClearingAccountId: "card_clearing",
    salesRevenueAccountId: "sales",
    vatOutputAccountId: "vat_output",
    salesReturnsAccountId: "sales_returns",
    inventoryAccountId: "inventory",
    cogsAccountId: "cogs",
  };
  const repo: PosRepository = {
    getGLAccountMapping: jest.fn().mockResolvedValue(glMapping),
    saveSale: jest.fn().mockImplementation(async (record: PosSaleRecord) => {
      sales.set(record.id, record);
      return record;
    }),
    findSale: jest.fn().mockImplementation(async (orgId: string, id: string) => {
      const s = sales.get(id);
      return s && s.organizationId === orgId ? s : null;
    }),
  };
  return { repo, sales };
}

describe("PosService — Sell", () => {
  test("cash sale posts Dr Cash / Cr Sales+VAT", async () => {
    const { engine, calls } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Item", quantity: 1, unitPrice: 100, taxCode: "STANDARD" }],
      tenders: [{ method: "CASH", amount: 115 }],
    });

    expect(sale.total).toBe("115.00");
    expect(calls[0].lines).toEqual([
      { accountId: "cash", debit: "115.00" },
      { accountId: "sales", credit: "100.00" },
      { accountId: "vat_output", credit: "15.00" },
    ]);
  });

  test("mixed payment (band 37) splits correctly between Cash and Card Clearing", async () => {
    const { engine, calls } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Item", quantity: 1, unitPrice: 200, taxCode: "ZERO" }],
      tenders: [
        { method: "CASH", amount: 100 },
        { method: "CARD", amount: 100 },
      ],
    });

    expect(calls[0].lines).toEqual([
      { accountId: "cash", debit: "100.00" },
      { accountId: "card_clearing", debit: "100.00" },
      { accountId: "sales", credit: "200.00" },
    ]);
  });

  test("rejects when tender total doesn't match the invoice total", async () => {
    const service = new PosService(makePostingEngine().engine as any, makeInventoryService(), makeRepo().repo, makeShiftsService());

    await expect(
      service.sell({
        organizationId: "org-1",
        periodId: "period-1",
        terminalId: "term-1",
        lines: [{ description: "Item", quantity: 1, unitPrice: 100, taxCode: "STANDARD" }],
        tenders: [{ method: "CASH", amount: 50 }], // short-paid
      }),
    ).rejects.toThrow(/does not match/);
  });

  test("a line with productId triggers a SEPARATE COGS journal entry via InventoryService.issueStock", async () => {
    const { engine, calls } = makePostingEngine();
    const inventory = makeInventoryService("12.00");
    const { repo } = makeRepo();
    const service = new PosService(engine as any, inventory, repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 3, unitPrice: 20, taxCode: "ZERO", productId: "prod-1" }],
      tenders: [{ method: "CASH", amount: 60 }],
    });

    expect(inventory.issueStock).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "prod-1", quantity: 3 }),
    );
    expect(sale.inventoryEffects).toHaveLength(1);
    expect(sale.inventoryEffects[0].unitCostUsed).toBe("12.00");
    expect(calls).toHaveLength(1); // the sale's own revenue entry; COGS entry is posted inside the mocked issueStock, not visible in `calls` here
  });

  test("rejects a sale with no lines", async () => {
    const service = new PosService(makePostingEngine().engine as any, makeInventoryService(), makeRepo().repo, makeShiftsService());

    await expect(
      service.sell({ organizationId: "org-1", periodId: "period-1", terminalId: "term-1", lines: [], tenders: [{ method: "CASH", amount: 0 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  test("rejects a sale with no payment tenders", async () => {
    const service = new PosService(makePostingEngine().engine as any, makeInventoryService(), makeRepo().repo, makeShiftsService());

    await expect(
      service.sell({
        organizationId: "org-1",
        periodId: "period-1",
        terminalId: "term-1",
        lines: [{ description: "X", quantity: 1, unitPrice: 10, taxCode: "STANDARD" }],
        tenders: [],
      }),
    ).rejects.toThrow(/payment tender/);
  });
});

describe("PosService — Sell with an OPT-IN shift (Sprint 12)", () => {
  test("records the cash tender against the open shift after a successful sale", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const shifts = makeShiftsService({
      getShift: jest.fn().mockResolvedValue({ id: "shift-1", organizationId: "org-1", terminalId: "term-1", status: "OPEN" }),
    });
    const service = new PosService(engine as any, makeInventoryService(), repo, shifts);

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      shiftId: "shift-1",
      lines: [{ description: "Item", quantity: 1, unitPrice: 100, taxCode: "STANDARD" }],
      tenders: [{ method: "CASH", amount: 115 }],
    });

    expect(sale.shiftId).toBe("shift-1");
    expect(shifts.recordCashMovement).toHaveBeenCalledWith("org-1", "shift-1", "SALE", 115);
  });

  test("rejects a sale against a shift that isn't OPEN", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const shifts = makeShiftsService({
      getShift: jest.fn().mockResolvedValue({ id: "shift-1", organizationId: "org-1", terminalId: "term-1", status: "CLOSED" }),
    });
    const service = new PosService(engine as any, makeInventoryService(), repo, shifts);

    await expect(
      service.sell({
        organizationId: "org-1",
        periodId: "period-1",
        terminalId: "term-1",
        shiftId: "shift-1",
        lines: [{ description: "Item", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
        tenders: [{ method: "CASH", amount: 10 }],
      }),
    ).rejects.toThrow(/not OPEN/);
  });

  test("rejects a sale against a shift belonging to a DIFFERENT terminal", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const shifts = makeShiftsService({
      getShift: jest.fn().mockResolvedValue({ id: "shift-1", organizationId: "org-1", terminalId: "term-OTHER", status: "OPEN" }),
    });
    const service = new PosService(engine as any, makeInventoryService(), repo, shifts);

    await expect(
      service.sell({
        organizationId: "org-1",
        periodId: "period-1",
        terminalId: "term-1",
        shiftId: "shift-1",
        lines: [{ description: "Item", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
        tenders: [{ method: "CASH", amount: 10 }],
      }),
    ).rejects.toThrow(/belongs to terminal/);
  });

  test("rejects a sale referencing a shift that doesn't exist", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const shifts = makeShiftsService({ getShift: jest.fn().mockResolvedValue(null) });
    const service = new PosService(engine as any, makeInventoryService(), repo, shifts);

    await expect(
      service.sell({
        organizationId: "org-1",
        periodId: "period-1",
        terminalId: "term-1",
        shiftId: "ghost-shift",
        lines: [{ description: "Item", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
        tenders: [{ method: "CASH", amount: 10 }],
      }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("PosService — Return (spec band 41)", () => {
  test("full return reverses the sale journal entry AND the COGS entry, and restores stock at the ORIGINAL unit cost", async () => {
    const { engine, reversals } = makePostingEngine();
    const inventory = makeInventoryService("12.00");
    const { repo } = makeRepo();
    const service = new PosService(engine as any, inventory, repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 2, unitPrice: 20, taxCode: "ZERO", productId: "prod-1" }],
      tenders: [{ method: "CASH", amount: 40 }],
    });

    const returned = await service.returnSale("org-1", sale.id, "Customer changed mind");

    expect(returned.status).toBe("RETURNED");
    expect(reversals).toEqual([
      { journalEntryId: sale.saleJournalEntryId, reason: "Customer changed mind" },
      { journalEntryId: sale.inventoryEffects[0].cogsJournalEntryId, reason: "Customer changed mind" },
    ]);
    expect(inventory.receiveStock).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "prod-1", quantity: 2, unitCost: 12 }),
      false, // restoring stock must NOT post its own opening-balance entry — the reversal above already undid the GL effect
    );
  });

  test("rejects returning a sale that was already returned", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Item", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 10 }],
    });

    await service.returnSale("org-1", sale.id, "first return");

    await expect(service.returnSale("org-1", sale.id, "second attempt")).rejects.toThrow(/already been returned/);
  });

  test("rejects returning a sale that doesn't exist", async () => {
    const service = new PosService(makePostingEngine().engine as any, makeInventoryService(), makeRepo().repo, makeShiftsService());

    await expect(service.returnSale("org-1", "ghost-sale", "reason")).rejects.toThrow(NotFoundException);
  });

  test("a return on a sale linked to a still-OPEN shift records a cash return against it", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const shifts = makeShiftsService({
      getShift: jest.fn().mockResolvedValue({ id: "shift-1", organizationId: "org-1", terminalId: "term-1", status: "OPEN" }),
    });
    const service = new PosService(engine as any, makeInventoryService(), repo, shifts);

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      shiftId: "shift-1",
      lines: [{ description: "Item", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 10 }],
    });

    await service.returnSale("org-1", sale.id, "changed mind");

    expect(shifts.recordCashMovement).toHaveBeenCalledWith("org-1", "shift-1", "RETURN", 10);
  });

  test("a return on a sale whose shift has since CLOSED still succeeds — shift reconciliation is skipped, not blocking", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const getShift = jest.fn().mockResolvedValue({ id: "shift-1", organizationId: "org-1", terminalId: "term-1", status: "OPEN" });
    const shifts = makeShiftsService({ getShift });
    const service = new PosService(engine as any, makeInventoryService(), repo, shifts);

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      shiftId: "shift-1",
      lines: [{ description: "Item", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 10 }],
    });

    // The shift closed sometime between the sale and the return.
    getShift.mockResolvedValue({ id: "shift-1", organizationId: "org-1", terminalId: "term-1", status: "CLOSED" });

    const returned = await service.returnSale("org-1", sale.id, "changed mind");

    expect(returned.status).toBe("RETURNED"); // the return itself is not blocked
    expect(shifts.recordCashMovement).not.toHaveBeenCalledWith("org-1", "shift-1", "RETURN", expect.anything());
  });
});

describe("PosService — Partial Return (Sprint 16, spec band 41)", () => {
  test("returns part of a single line: prorated tax and a new POS_RETURN_COMPLETED entry using Sales Returns", async () => {
    const { engine, calls } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 10, unitPrice: 20, taxCode: "STANDARD", productId: "prod-1" }],
      tenders: [{ method: "CASH", amount: 230 }],
    });
    calls.length = 0; // clear the sale's own posting call to isolate the return's

    const returned = await service.returnItems("org-1", sale.id, "partial return", [{ lineIndex: 0, quantity: 3 }]);

    expect(returned.status).toBe("PARTIALLY_RETURNED");
    expect(returned.remainingQuantities).toEqual([7]);

    const returnCall = calls[0];
    expect(returnCall.sourceEvent).toBe("POS_RETURN_COMPLETED");
    // 3 units * 20 = 60 net, 15% VAT = 9.00, COGS at 12.00/unit (default mock) = 36.00
    expect(returnCall.lines).toEqual([
      { accountId: "sales_returns", debit: "60.00" },
      { accountId: "vat_output", debit: "9.00" },
      { accountId: "inventory", debit: "36.00" },
      { accountId: "cash", credit: "69.00" },
      { accountId: "cogs", credit: "36.00" },
    ]);
  });

  test("two successive partial returns cannot together exceed the original quantity", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 5, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 50 }],
    });

    await service.returnItems("org-1", sale.id, "first partial", [{ lineIndex: 0, quantity: 3 }]);

    await expect(service.returnItems("org-1", sale.id, "second partial", [{ lineIndex: 0, quantity: 3 }])).rejects.toThrow(
      /only 2 remains/,
    );
  });

  test("returning the last remaining quantity transitions status to fully RETURNED", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 5, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 50 }],
    });

    await service.returnItems("org-1", sale.id, "partial", [{ lineIndex: 0, quantity: 3 }]);
    const final = await service.returnItems("org-1", sale.id, "rest", [{ lineIndex: 0, quantity: 2 }]);

    expect(final.status).toBe("RETURNED");
    expect(final.remainingQuantities).toEqual([0]);
  });

  test("rejects a full returnSale() after a partial return already happened on that sale", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 5, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 50 }],
    });

    await service.returnItems("org-1", sale.id, "partial", [{ lineIndex: 0, quantity: 1 }]);

    await expect(service.returnSale("org-1", sale.id, "trying full return")).rejects.toThrow(/use returnItems/);
  });

  test("rejects a partial return with an invalid line index", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 5, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 50 }],
    });

    await expect(service.returnItems("org-1", sale.id, "bad", [{ lineIndex: 5, quantity: 1 }])).rejects.toThrow(/no line at index/);
  });
});

describe("PosService — returnItems atomicity fix (Sprint 28)", () => {
  test("automatically reverses the return's journal entry if restoring inventory fails afterward", async () => {
    const { engine, calls, reversals } = makePostingEngine();
    const { repo } = makeRepo();
    const failingInventory = {
      issueStock: jest.fn().mockResolvedValue({ journalEntryId: "cogs-je-1", quantityIssued: 3, unitCostUsed: "12.00", totalCogs: "36.00" }),
      receiveStock: jest.fn().mockRejectedValue(new Error("simulated inventory restore failure")),
    } as unknown as InventoryService;
    const service = new PosService(engine as any, failingInventory, repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 10, unitPrice: 20, taxCode: "STANDARD", productId: "prod-1" }],
      tenders: [{ method: "CASH", amount: 230 }],
    });
    calls.length = 0;
    reversals.length = 0;

    await expect(service.returnItems("org-1", sale.id, "partial return", [{ lineIndex: 0, quantity: 3 }])).rejects.toThrow(
      "simulated inventory restore failure",
    );

    // The return entry WAS posted (this only fails restoring inventory afterward)...
    expect(calls).toHaveLength(1);
    expect(calls[0].sourceEvent).toBe("POS_RETURN_COMPLETED");
    // ...but it must have been automatically reversed since inventory restoration failed.
    expect(reversals).toHaveLength(1);
    expect(reversals[0].journalEntryId).toBe(calls[0] ? "je-1" : undefined);
  });

  test("does NOT reverse anything when a partial return succeeds normally", async () => {
    const { engine, reversals } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService());

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 10, unitPrice: 20, taxCode: "STANDARD", productId: "prod-1" }],
      tenders: [{ method: "CASH", amount: 230 }],
    });
    reversals.length = 0;

    await service.returnItems("org-1", sale.id, "partial return", [{ lineIndex: 0, quantity: 3 }]);

    expect(reversals).toHaveLength(0);
  });
});

describe("PosService — mandatory shift setting (Sprint 29)", () => {
  function makeOrgsService(requireShift: boolean) {
    return { getOrganization: jest.fn().mockResolvedValue({ id: "org-1", legalNameAr: "X", requireShiftForPosSale: requireShift }) };
  }

  test("rejects a shiftId-less sale when the organization requires a shift", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService(), makeOrgsService(true) as any);

    await expect(
      service.sell({
        organizationId: "org-1",
        periodId: "period-1",
        terminalId: "term-1",
        lines: [{ description: "Widget", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
        tenders: [{ method: "CASH", amount: 10 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  test("allows a shiftId-less sale when the organization does NOT require a shift", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService(), makeOrgsService(false) as any);

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 10 }],
    });

    expect(sale.total).toBe("10.00");
  });

  test("still allows a shiftId-less sale when NO organizationsService is provided at all (fully backward compatible)", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const service = new PosService(engine as any, makeInventoryService(), repo, makeShiftsService()); // no 5th arg

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 10 }],
    });

    expect(sale.total).toBe("10.00");
  });

  test("a sale WITH a valid shiftId succeeds even when the organization requires one", async () => {
    const { engine } = makePostingEngine();
    const { repo } = makeRepo();
    const shifts = makeShiftsService({
      getShift: jest.fn().mockResolvedValue({ id: "shift-1", organizationId: "org-1", terminalId: "term-1", status: "OPEN" }),
    });
    const service = new PosService(engine as any, makeInventoryService(), repo, shifts, makeOrgsService(true) as any);

    const sale = await service.sell({
      organizationId: "org-1",
      periodId: "period-1",
      terminalId: "term-1",
      lines: [{ description: "Widget", quantity: 1, unitPrice: 10, taxCode: "ZERO" }],
      tenders: [{ method: "CASH", amount: 10 }],
      shiftId: "shift-1",
    });

    expect(sale.shiftId).toBe("shift-1");
  });
});
