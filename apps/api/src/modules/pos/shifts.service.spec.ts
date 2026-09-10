import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ShiftsService, ShiftsRepository, ShiftRecord } from "./shifts.service";

function makeRepo() {
  const shifts = new Map<string, ShiftRecord>();
  let counter = 0;
  const repo: ShiftsRepository = {
    create: jest.fn().mockImplementation(async (input) => {
      counter += 1;
      const record: ShiftRecord = { id: `shift-${counter}`, ...input };
      shifts.set(record.id, record);
      return record;
    }),
    findById: jest.fn().mockImplementation(async (orgId: string, shiftId: string) => {
      const s = shifts.get(shiftId);
      return s && s.organizationId === orgId ? s : null;
    }),
    findOpenShiftForTerminal: jest.fn().mockImplementation(async (orgId: string, terminalId: string) =>
      [...shifts.values()].find((s) => s.organizationId === orgId && s.terminalId === terminalId && s.status === "OPEN") ?? null,
    ),
    update: jest.fn().mockImplementation(async (shiftId: string, patch: Partial<ShiftRecord>) => {
      const s = shifts.get(shiftId)!;
      Object.assign(s, patch);
      return s;
    }),
  };
  return repo;
}

describe("ShiftsService (spec band 42)", () => {
  test("opens a shift with the given opening cash", async () => {
    const service = new ShiftsService(makeRepo());

    const shift = await service.openShift({
      organizationId: "org-1",
      terminalId: "POS-01",
      cashierUserId: "user-1",
      openingCash: 200,
    });

    expect(shift.status).toBe("OPEN");
    expect(shift.openingCash).toBe("200.00");
  });

  test("rejects opening a second shift on a terminal that already has one open", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);

    await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });

    await expect(
      service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-2", openingCash: 100 }),
    ).rejects.toThrow(/already has an open shift/);
  });

  test("allows opening shifts on two DIFFERENT terminals simultaneously", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);

    const shift1 = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });
    const shift2 = await service.openShift({ organizationId: "org-1", terminalId: "POS-02", cashierUserId: "user-2", openingCash: 150 });

    expect(shift1.id).not.toBe(shift2.id);
  });

  test("rejects a negative opening cash amount", async () => {
    const service = new ShiftsService(makeRepo());

    await expect(
      service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: -50 }),
    ).rejects.toThrow(BadRequestException);
  });

  test("closing with actual cash matching expected cash gives zero difference", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);

    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });
    // Simulate sales having happened on this shift (spec band 42's own fields, not yet auto-updated by PosService — see class header comment)
    await repo.update(shift.id, { cashSalesTotal: "500.00", cashReturnsTotal: "50.00" });

    const closed = await service.closeShift({ organizationId: "org-1", shiftId: shift.id, actualCash: 650 });

    // expected = 200 + 500 - 50 = 650
    expect(closed.expectedCash).toBe("650.00");
    expect(closed.actualCash).toBe("650.00");
    expect(closed.cashDifference).toBe("0.00");
    expect(closed.status).toBe("CLOSED");
  });

  test("reports a shortage as a negative difference, not silently", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);

    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });
    await repo.update(shift.id, { cashSalesTotal: "500.00", cashReturnsTotal: "0.00" });

    const closed = await service.closeShift({ organizationId: "org-1", shiftId: shift.id, actualCash: 680 });

    // expected = 700, actual = 680 -> difference = -20 (shortage)
    expect(closed.cashDifference).toBe("-20.00");
  });

  test("rejects closing a shift that was already closed", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);

    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });
    await service.closeShift({ organizationId: "org-1", shiftId: shift.id, actualCash: 200 });

    await expect(service.closeShift({ organizationId: "org-1", shiftId: shift.id, actualCash: 200 })).rejects.toThrow(
      /already closed/,
    );
  });

  test("rejects closing a shift that doesn't exist", async () => {
    const service = new ShiftsService(makeRepo());

    await expect(service.closeShift({ organizationId: "org-1", shiftId: "ghost", actualCash: 0 })).rejects.toThrow(
      NotFoundException,
    );
  });

  test("after closing, a new shift CAN be opened on the same terminal", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);

    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });
    await service.closeShift({ organizationId: "org-1", shiftId: shift.id, actualCash: 200 });

    const newShift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-2", openingCash: 100 });
    expect(newShift.status).toBe("OPEN");
  });
});

describe("ShiftsService — recordCashMovement (Sprint 12 integration point)", () => {
  test("accumulates cash sales onto the shift's running total", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);
    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });

    await service.recordCashMovement("org-1", shift.id, "SALE", 115);
    const updated = await service.recordCashMovement("org-1", shift.id, "SALE", 50);

    expect(updated.cashSalesTotal).toBe("165.00");
  });

  test("accumulates cash returns onto a separate running total", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);
    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });

    await service.recordCashMovement("org-1", shift.id, "SALE", 100);
    const updated = await service.recordCashMovement("org-1", shift.id, "RETURN", 30);

    expect(updated.cashSalesTotal).toBe("100.00");
    expect(updated.cashReturnsTotal).toBe("30.00");
  });

  test("a zero cash amount (e.g. a fully card-paid sale) is a no-op, not an error", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);
    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });

    const result = await service.recordCashMovement("org-1", shift.id, "SALE", 0);
    expect(result.cashSalesTotal).toBe("0.00");
  });

  test("rejects recording a cash movement against a CLOSED shift", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);
    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });
    await service.closeShift({ organizationId: "org-1", shiftId: shift.id, actualCash: 200 });

    await expect(service.recordCashMovement("org-1", shift.id, "SALE", 50)).rejects.toThrow(/not OPEN/);
  });

  test("rejects recording against a shift that doesn't exist", async () => {
    const service = new ShiftsService(makeRepo());

    await expect(service.recordCashMovement("org-1", "ghost-shift", "SALE", 50)).rejects.toThrow(NotFoundException);
  });

  test("end-to-end: opening 200 + cash sales 115 - cash return 30 = expected 285 at close", async () => {
    const repo = makeRepo();
    const service = new ShiftsService(repo);
    const shift = await service.openShift({ organizationId: "org-1", terminalId: "POS-01", cashierUserId: "user-1", openingCash: 200 });

    await service.recordCashMovement("org-1", shift.id, "SALE", 115);
    await service.recordCashMovement("org-1", shift.id, "RETURN", 30);

    const closed = await service.closeShift({ organizationId: "org-1", shiftId: shift.id, actualCash: 285 });

    expect(closed.expectedCash).toBe("285.00");
    expect(closed.cashDifference).toBe("0.00");
  });
});
