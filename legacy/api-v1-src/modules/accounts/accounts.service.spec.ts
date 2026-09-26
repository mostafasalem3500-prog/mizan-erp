import { ConflictException, NotFoundException } from "@nestjs/common";
import { AccountsService, AccountsRepository, AccountRow } from "./accounts.service";

function makeRepo() {
  const accounts = new Map<string, AccountRow>();
  let counter = 0;
  const repo: AccountsRepository = {
    create: jest.fn().mockImplementation(async (input) => {
      counter += 1;
      const row: AccountRow = { id: `acc-${counter}`, isActive: true, ...input };
      accounts.set(`${input.organizationId}:${input.code}`, row);
      accounts.set(row.id, row);
      return row;
    }),
    findByCode: jest.fn().mockImplementation(async (orgId: string, code: string) => accounts.get(`${orgId}:${code}`) ?? null),
    findById: jest.fn().mockImplementation(async (orgId: string, id: string) => {
      const row = accounts.get(id);
      return row && row.organizationId === orgId ? row : null;
    }),
    listForOrganization: jest.fn().mockImplementation(async (orgId: string) =>
      [...accounts.values()].filter((a, i, arr) => a.organizationId === orgId && arr.indexOf(a) === i),
    ),
  };
  return repo;
}

describe("AccountsService", () => {
  test("rejects a duplicate account code within the same organization", async () => {
    const repo = makeRepo();
    const service = new AccountsService(repo);

    await service.createAccount({ organizationId: "org-1", code: "1100", nameAr: "النقدية", type: "ASSET" });

    await expect(
      service.createAccount({ organizationId: "org-1", code: "1100", nameAr: "تكرار", type: "ASSET" }),
    ).rejects.toThrow(ConflictException);
  });

  test("resolves parentCode to the parent's id", async () => {
    const repo = makeRepo();
    const service = new AccountsService(repo);

    const parent = await service.createAccount({ organizationId: "org-1", code: "1000", nameAr: "الأصول", type: "ASSET", isPostable: false });
    const child = await service.createAccount({ organizationId: "org-1", code: "1100", nameAr: "النقدية", type: "ASSET", parentCode: "1000" });

    expect(child.parentId).toBe(parent.id);
  });

  test("rejects creating an account under a parent code that doesn't exist", async () => {
    const repo = makeRepo();
    const service = new AccountsService(repo);

    await expect(
      service.createAccount({ organizationId: "org-1", code: "1100", nameAr: "النقدية", type: "ASSET", parentCode: "9999" }),
    ).rejects.toThrow(NotFoundException);
  });

  test("getAccountIdByCode throws a clear setup error when the code is missing (not a silent undefined)", async () => {
    const repo = makeRepo();
    const service = new AccountsService(repo);

    await expect(service.getAccountIdByCode("org-1", "1100")).rejects.toThrow(/missing required account code/);
  });

  test("seedDefaultChartOfAccounts creates every code from spec band 20's example, with correct parent links", async () => {
    const repo = makeRepo();
    const service = new AccountsService(repo);

    const codeToId = await service.seedDefaultChartOfAccounts("org-1");

    expect(Object.keys(codeToId)).toEqual(
      expect.arrayContaining(["1100", "1200", "1300", "1400", "2100", "2200", "3100", "4100", "4200", "5100", "6100"]),
    );

    const cash = await service.getAccountByCode("org-1", "1100");
    const assetsHeader = await service.getAccountByCode("org-1", "1000");
    expect(cash?.parentId).toBe(assetsHeader?.id);
    expect(assetsHeader?.isPostable).toBe(false); // header accounts are non-postable
    expect(cash?.isPostable).toBe(true);
  });

  test("account codes are scoped per organization — the same code can exist in two different orgs", async () => {
    const repo = makeRepo();
    const service = new AccountsService(repo);

    const a = await service.createAccount({ organizationId: "org-1", code: "1100", nameAr: "النقدية", type: "ASSET" });
    const b = await service.createAccount({ organizationId: "org-2", code: "1100", nameAr: "النقدية", type: "ASSET" });

    expect(a.id).not.toBe(b.id);
    expect(a.organizationId).not.toBe(b.organizationId);
  });
});
