import { BadRequestException } from "@nestjs/common";
import { PeriodsService, PeriodsRepository, PeriodRow } from "./periods.service";

function makeRepo(existing: PeriodRow[] = []): PeriodsRepository {
  const periods = [...existing];
  return {
    listForOrganization: jest.fn().mockImplementation(async (orgId: string) => periods.filter((p) => p.organizationId === orgId)),
    findById: jest.fn().mockImplementation(async (orgId: string, periodId: string) => periods.find((p) => p.organizationId === orgId && p.id === periodId) ?? null),
    updateStatus: jest.fn().mockImplementation(async (orgId: string, periodId: string, status) => {
      const period = periods.find((p) => p.organizationId === orgId && p.id === periodId);
      if (!period) throw new Error("not found");
      period.status = status;
      return { ...period };
    }),
    create: jest.fn().mockImplementation(async (input) => {
      const row: PeriodRow = { id: `period-${periods.length + 1}`, organizationId: input.organizationId, status: "OPEN", startDate: input.startDate, endDate: input.endDate };
      periods.push(row);
      return row;
    }),
  };
}

describe("PeriodsService — listPeriods", () => {
  test("returns periods for the organization only", async () => {
    const repo = makeRepo([{ id: "p1", organizationId: "org-1", status: "OPEN", startDate: "2026-01-01", endDate: "2026-12-31" }]);
    const service = new PeriodsService(repo);
    const periods = await service.listPeriods("org-1");
    expect(periods).toHaveLength(1);
  });
});

describe("PeriodsService — createPeriod (Sprint 31)", () => {
  test("creates a new OPEN period when there's no overlap", async () => {
    const repo = makeRepo();
    const service = new PeriodsService(repo);

    const period = await service.createPeriod({ organizationId: "org-1", startDate: "2027-01-01", endDate: "2027-12-31" });

    expect(period.status).toBe("OPEN");
    expect(period.organizationId).toBe("org-1");
  });

  test("rejects an end date before or equal to the start date", async () => {
    const service = new PeriodsService(makeRepo());
    await expect(service.createPeriod({ organizationId: "org-1", startDate: "2027-06-01", endDate: "2027-01-01" })).rejects.toThrow(BadRequestException);
  });

  test("rejects invalid dates", async () => {
    const service = new PeriodsService(makeRepo());
    await expect(service.createPeriod({ organizationId: "org-1", startDate: "not-a-date", endDate: "2027-01-01" })).rejects.toThrow(BadRequestException);
  });

  test("rejects a period whose range overlaps an existing period for the same organization", async () => {
    const repo = makeRepo([{ id: "p1", organizationId: "org-1", status: "OPEN", startDate: "2026-01-01", endDate: "2026-12-31" }]);
    const service = new PeriodsService(repo);

    await expect(service.createPeriod({ organizationId: "org-1", startDate: "2026-06-01", endDate: "2027-06-01" })).rejects.toThrow(/overlaps/);
  });

  test("allows a non-overlapping period even when other periods exist for the SAME organization", async () => {
    const repo = makeRepo([{ id: "p1", organizationId: "org-1", status: "OPEN", startDate: "2026-01-01", endDate: "2026-12-31" }]);
    const service = new PeriodsService(repo);

    const period = await service.createPeriod({ organizationId: "org-1", startDate: "2027-01-01", endDate: "2027-12-31" });
    expect(period.startDate).toBe("2027-01-01");
  });

  test("does not consider periods belonging to a DIFFERENT organization when checking overlap", async () => {
    const repo = makeRepo([{ id: "p1", organizationId: "org-OTHER", status: "OPEN", startDate: "2026-01-01", endDate: "2026-12-31" }]);
    const service = new PeriodsService(repo);

    const period = await service.createPeriod({ organizationId: "org-1", startDate: "2026-06-01", endDate: "2027-06-01" });
    expect(period.organizationId).toBe("org-1");
  });
});

describe("PeriodsService — accounting close cycle", () => {
  const period: PeriodRow = { id: "p1", organizationId: "org-1", status: "OPEN", startDate: "2026-01-01", endDate: "2026-12-31" };

  function makeClosingService(lines: any[]) {
    const repo = makeRepo([{ ...period }]);
    const query = { getTrialBalance: jest.fn().mockResolvedValue({ lines, totalDebit: "115.0000", totalCredit: "115.0000", isBalanced: true }) };
    const accounts = {
      listAccounts: jest.fn().mockResolvedValue([
        { id: "sales", code: "4100", nameAr: "المبيعات", type: "REVENUE" },
        { id: "expense", code: "6100", nameAr: "مصروفات عامة", type: "EXPENSE" },
        { id: "cash", code: "1100", nameAr: "النقدية", type: "ASSET" },
      ]),
      getAccountIdByCode: jest.fn().mockResolvedValue("retained"),
    };
    const posting = { post: jest.fn().mockResolvedValue({ id: "closing-entry" }) };
    return { service: new PeriodsService(repo, query as any, accounts as any, posting as any), repo, query, accounts, posting };
  }

  test("soft-close validates a balanced trial balance and blocks ordinary posting through period status", async () => {
    const { service } = makeClosingService([]);
    const closed = await service.softClosePeriod("org-1", "p1");
    expect(closed.status).toBe("SOFT_CLOSED");
  });

  test("posts a balanced closing entry and transfers profit to retained earnings before final close", async () => {
    const { service, posting } = makeClosingService([
      { accountId: "sales", totalDebit: "0.0000", totalCredit: "100.0000" },
      { accountId: "expense", totalDebit: "25.0000", totalCredit: "0.0000" },
      { accountId: "cash", totalDebit: "115.0000", totalCredit: "0.0000" },
    ]);

    const result = await service.closePeriod("org-1", "p1");

    expect(result.period.status).toBe("CLOSED");
    expect(result.closingJournalEntryId).toBe("closing-entry");
    expect(posting.post).toHaveBeenCalledWith(expect.objectContaining({
      sourceEvent: "PERIOD_CLOSED",
      idempotencyKey: "period-close-p1",
      lines: expect.arrayContaining([
        expect.objectContaining({ accountId: "sales", debit: "100.0000" }),
        expect.objectContaining({ accountId: "expense", credit: "25.0000" }),
        expect.objectContaining({ accountId: "retained", credit: "75.0000" }),
      ]),
    }));
  });

  test("reopens only a soft-closed period", async () => {
    const repo = makeRepo([{ ...period, status: "SOFT_CLOSED" }]);
    const service = new PeriodsService(repo);
    expect((await service.reopenPeriod("org-1", "p1")).status).toBe("OPEN");
  });
});
