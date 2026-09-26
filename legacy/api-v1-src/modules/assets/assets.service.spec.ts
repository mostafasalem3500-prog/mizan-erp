import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AssetsService, AssetsRepository, AssetRecord, straightLineMonthlyDepreciation } from "./assets.service";
import { AccountsService } from "../accounts/accounts.service";

function makeAccounts() {
  const codeToId: Record<string, string> = { "1500": "acc-fixed-asset", "1100": "acc-cash", "6200": "acc-dep-expense", "1510": "acc-accum-dep" };
  return { getAccountIdByCode: jest.fn().mockImplementation(async (_o: string, code: string) => codeToId[code]) } as unknown as AccountsService;
}

function makeEngine() {
  const calls: any[] = [];
  return { engine: { post: jest.fn().mockImplementation(async (r: any) => { calls.push(r); return { id: `je-${calls.length}`, ...r }; }) }, calls };
}

function makeRepo() {
  const assets = new Map<string, AssetRecord>();
  const repo: AssetsRepository = {
    save: jest.fn().mockImplementation(async (r: AssetRecord) => { assets.set(r.id, r); return r; }),
    findById: jest.fn().mockImplementation(async (org: string, id: string) => { const a = assets.get(id); return a && a.organizationId === org ? a : null; }),
  };
  return repo;
}

describe("straightLineMonthlyDepreciation", () => {
  test("computes (cost - residual) / months correctly", () => {
    expect(straightLineMonthlyDepreciation(12000, 0, 24)).toBe(500);
    expect(straightLineMonthlyDepreciation(1000, 100, 12)).toBeCloseTo(75, 5);
  });
});

describe("AssetsService — acquisition", () => {
  test("posts Dr Fixed Asset / Cr Payment Account", async () => {
    const { engine, calls } = makeEngine();
    const service = new AssetsService(engine as any, makeAccounts(), makeRepo());

    const asset = await service.acquireAsset({ organizationId: "org-1", periodId: "period-1", name: "Delivery Van", cost: 12000, residualValue: 0, usefulLifeMonths: 24, paymentAccountCode: "1100" });

    expect(calls[0].lines).toEqual([{ accountId: "acc-fixed-asset", debit: "12000.00" }, { accountId: "acc-cash", credit: "12000.00" }]);
    expect(asset.accumulatedDepreciation).toBe("0.00");
  });

  test("rejects a residual value greater than or equal to cost", async () => {
    const service = new AssetsService(makeEngine().engine as any, makeAccounts(), makeRepo());
    await expect(
      service.acquireAsset({ organizationId: "org-1", periodId: "period-1", name: "X", cost: 1000, residualValue: 1000, usefulLifeMonths: 12, paymentAccountCode: "1100" }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("AssetsService — depreciation", () => {
  test("depreciates by the straight-line monthly amount by default and accumulates correctly", async () => {
    const { engine, calls } = makeEngine();
    const repo = makeRepo();
    const service = new AssetsService(engine as any, makeAccounts(), repo);

    const asset = await service.acquireAsset({ organizationId: "org-1", periodId: "period-1", name: "Van", cost: 12000, residualValue: 0, usefulLifeMonths: 24, paymentAccountCode: "1100" });
    const after1 = await service.depreciateAsset({ organizationId: "org-1", periodId: "period-1", assetId: asset.id });

    expect(calls[1].lines).toEqual([{ accountId: "acc-dep-expense", debit: "500.00" }, { accountId: "acc-accum-dep", credit: "500.00" }]);
    expect(after1.accumulatedDepreciation).toBe("500.00");

    const after2 = await service.depreciateAsset({ organizationId: "org-1", periodId: "period-1", assetId: asset.id });
    expect(after2.accumulatedDepreciation).toBe("1000.00");
  });

  test("rejects depreciation that would exceed the depreciable base", async () => {
    const repo = makeRepo();
    const service = new AssetsService(makeEngine().engine as any, makeAccounts(), repo);

    const asset = await service.acquireAsset({ organizationId: "org-1", periodId: "period-1", name: "Van", cost: 1000, residualValue: 0, usefulLifeMonths: 2, paymentAccountCode: "1100" });
    await service.depreciateAsset({ organizationId: "org-1", periodId: "period-1", assetId: asset.id, amount: 900 });

    await expect(
      service.depreciateAsset({ organizationId: "org-1", periodId: "period-1", assetId: asset.id, amount: 200 }),
    ).rejects.toThrow(/past the depreciable base/);
  });

  test("rejects depreciating an asset that doesn't exist", async () => {
    const service = new AssetsService(makeEngine().engine as any, makeAccounts(), makeRepo());
    await expect(service.depreciateAsset({ organizationId: "org-1", periodId: "period-1", assetId: "ghost" })).rejects.toThrow(NotFoundException);
  });
});
