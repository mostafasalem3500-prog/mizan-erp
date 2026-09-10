import { BadRequestException } from "@nestjs/common";
import { PeriodsService, PeriodsRepository, PeriodRow } from "./periods.service";

function makeRepo(existing: PeriodRow[] = []): PeriodsRepository {
  const periods = [...existing];
  return {
    listForOrganization: jest.fn().mockImplementation(async (orgId: string) => periods.filter((p) => p.organizationId === orgId)),
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
