import { PrismaAccountsRepository, PrismaOrganizationsRepository, PrismaPeriodsRepository } from "./prisma-repositories";

describe("PrismaAccountsRepository", () => {
  function makeFakePrisma() {
    const accounts = new Map<string, any>();
    let seq = 0;
    return {
      account: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `acct-${++seq}`, isActive: true, ...data };
          accounts.set(row.id, row);
          return row;
        }),
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.organizationId_code) {
            return [...accounts.values()].find(
              (a) => a.organizationId === where.organizationId_code.organizationId && a.code === where.organizationId_code.code,
            ) ?? null;
          }
          return accounts.get(where.id) ?? null;
        }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => [...accounts.values()].filter((a) => a.organizationId === where.organizationId)),
      },
    };
  }

  test("create() maps input to a real Prisma call and returns a well-shaped AccountRow", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaAccountsRepository(prisma as any);

    const account = await repo.create({ organizationId: "org-1", code: "1000", nameAr: "الأصول", type: "ASSET", isPostable: false });

    expect(account.id).toBe("acct-1");
    expect(account.code).toBe("1000");
    expect(account.isPostable).toBe(false);
  });

  test("findByCode() uses the real compound-unique-key shape (organizationId_code)", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaAccountsRepository(prisma as any);
    await repo.create({ organizationId: "org-1", code: "1100", nameAr: "النقدية", type: "ASSET", isPostable: true });

    const found = await repo.findByCode("org-1", "1100");
    expect(found?.code).toBe("1100");
    expect(prisma.account.findUnique).toHaveBeenCalledWith({ where: { organizationId_code: { organizationId: "org-1", code: "1100" } } });
  });

  test("findById() enforces tenant isolation — returns null if the account belongs to a different organization", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaAccountsRepository(prisma as any);
    const created = await repo.create({ organizationId: "org-1", code: "1000", nameAr: "X", type: "ASSET", isPostable: true });

    const foundWrongOrg = await repo.findById("org-OTHER", created.id);
    const foundRightOrg = await repo.findById("org-1", created.id);

    expect(foundWrongOrg).toBeNull();
    expect(foundRightOrg?.id).toBe(created.id);
  });

  test("listForOrganization() only returns accounts for that organization", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaAccountsRepository(prisma as any);
    await repo.create({ organizationId: "org-1", code: "1000", nameAr: "X", type: "ASSET", isPostable: true });
    await repo.create({ organizationId: "org-2", code: "1000", nameAr: "Y", type: "ASSET", isPostable: true });

    const list = await repo.listForOrganization("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].organizationId).toBe("org-1");
  });
});

describe("PrismaOrganizationsRepository", () => {
  function makeFakePrisma() {
    const organizations = new Map<string, any>();
    const permissions = new Map<string, any>();
    const seq = { org: 0, role: 0, user: 0, perm: 0 };
    return {
      organization: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `org-${++seq.org}`, requireShiftForPosSale: false, ...data };
          organizations.set(row.id, row);
          return row;
        }),
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where.vatNumber) return [...organizations.values()].find((o) => o.vatNumber === where.vatNumber) ?? null;
          return organizations.get(where.id) ?? null;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const existing = organizations.get(where.id);
          const updated = { ...existing, ...data };
          organizations.set(where.id, updated);
          return updated;
        }),
      },
      role: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `role-${++seq.role}`, ...data })) },
      permission: {
        upsert: jest.fn().mockImplementation(async ({ where, create }: any) => {
          if (!permissions.has(where.code)) permissions.set(where.code, { id: `perm-${++seq.perm}`, ...create });
          return permissions.get(where.code);
        }),
      },
      rolePermission: { create: jest.fn().mockResolvedValue(undefined) },
      user: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: `user-${++seq.user}`, ...data })) },
      organizationUser: { create: jest.fn().mockResolvedValue(undefined) },
    };
  }

  test("vatNumberExists() returns true only when a matching organization exists", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaOrganizationsRepository(prisma as any);
    await repo.createOrganizationWithOwner({
      organization: { legalNameAr: "شركة", vatNumber: "300000000000003" },
      seededRoleNames: ["Owner"],
      ownerRoleName: "Owner",
      owner: { email: "a@b.com", fullName: "A", passwordHash: "h" },
    });

    expect(await repo.vatNumberExists("300000000000003")).toBe(true);
    expect(await repo.vatNumberExists("999999999999999")).toBe(false);
  });

  test("createOrganizationWithOwner() only grants OWNER_PERMISSIONS to the owner role, not other seeded roles", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaOrganizationsRepository(prisma as any);

    await repo.createOrganizationWithOwner({
      organization: { legalNameAr: "شركة" },
      seededRoleNames: ["Owner", "Cashier"],
      ownerRoleName: "Owner",
      owner: { email: "a@b.com", fullName: "A", passwordHash: "h" },
    });

    expect(prisma.role.create).toHaveBeenCalledTimes(2);
    expect(prisma.permission.upsert).toHaveBeenCalledTimes(25);
    expect(prisma.rolePermission.create).toHaveBeenCalledTimes(25);
  });

  test("createOrganizationWithOwner() returns the owner's role id, not the last-created role", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaOrganizationsRepository(prisma as any);

    const result = await repo.createOrganizationWithOwner({
      organization: { legalNameAr: "شركة" },
      seededRoleNames: ["Owner", "Cashier"],
      ownerRoleName: "Owner",
      owner: { email: "a@b.com", fullName: "A", passwordHash: "h" },
    });

    expect(result.ownerRoleId).toBe("role-1");
  });

  test("findById() maps requireShiftForPosSale correctly", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaOrganizationsRepository(prisma as any);
    const created = await repo.createOrganizationWithOwner({
      organization: { legalNameAr: "شركة" },
      seededRoleNames: ["Owner"],
      ownerRoleName: "Owner",
      owner: { email: "a@b.com", fullName: "A", passwordHash: "h" },
    });

    const found = await repo.findById(created.organizationId);
    expect(found?.requireShiftForPosSale).toBe(false);
  });

  test("updateSettings() persists requireShiftForPosSale via a real Prisma update call", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaOrganizationsRepository(prisma as any);
    const created = await repo.createOrganizationWithOwner({
      organization: { legalNameAr: "شركة" },
      seededRoleNames: ["Owner"],
      ownerRoleName: "Owner",
      owner: { email: "a@b.com", fullName: "A", passwordHash: "h" },
    });

    const updated = await repo.updateSettings(created.organizationId, { requireShiftForPosSale: true });
    expect(updated.requireShiftForPosSale).toBe(true);

    const refetched = await repo.findById(created.organizationId);
    expect(refetched?.requireShiftForPosSale).toBe(true);
  });
});

describe("PrismaPeriodsRepository — bridges the FiscalYear/AccountingPeriod schema mismatch", () => {
  function makeFakePrisma() {
    const fiscalYears = new Map<string, any>();
    const periods = new Map<string, any>();
    const seq = { fy: 0, period: 0 };
    return {
      fiscalYear: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `fy-${++seq.fy}`, ...data };
          fiscalYears.set(row.id, row);
          return row;
        }),
      },
      accountingPeriod: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const row = { id: `period-${++seq.period}`, ...data };
          periods.set(row.id, row);
          return row;
        }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const orgId = where.fiscalYear.organizationId;
          return [...periods.values()]
            .filter((p) => fiscalYears.get(p.fiscalYearId)?.organizationId === orgId)
            .map((p) => ({ ...p, fiscalYear: fiscalYears.get(p.fiscalYearId) }));
        }),
      },
    };
  }

  test("create() creates a matching FiscalYear row alongside the AccountingPeriod", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaPeriodsRepository(prisma as any);

    const period = await repo.create({ organizationId: "org-1", startDate: "2027-01-01T00:00:00.000Z", endDate: "2027-12-31T00:00:00.000Z" });

    expect(prisma.fiscalYear.create).toHaveBeenCalledTimes(1);
    expect(prisma.accountingPeriod.create).toHaveBeenCalledTimes(1);
    expect(period.organizationId).toBe("org-1");
    expect(period.status).toBe("OPEN");
  });

  test("listForOrganization() joins through fiscalYear and returns a flat PeriodRow with organizationId", async () => {
    const prisma = makeFakePrisma();
    const repo = new PrismaPeriodsRepository(prisma as any);
    await repo.create({ organizationId: "org-1", startDate: "2027-01-01T00:00:00.000Z", endDate: "2027-12-31T00:00:00.000Z" });
    await repo.create({ organizationId: "org-2", startDate: "2027-01-01T00:00:00.000Z", endDate: "2027-12-31T00:00:00.000Z" });

    const list = await repo.listForOrganization("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].organizationId).toBe("org-1");
  });
});
