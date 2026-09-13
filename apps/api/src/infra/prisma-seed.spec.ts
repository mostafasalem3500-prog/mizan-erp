import { seedDemoOrganizationWithPrisma } from "./prisma-seed";

function makeFakePrisma() {
  const calls: Record<string, any[]> = {
    organizationCreate: [],
    roleCreate: [],
    permissionUpsert: [],
    rolePermissionCreate: [],
    userCreate: [],
    organizationUserCreate: [],
    fiscalYearCreate: [],
    accountingPeriodCreate: [],
    accountCreate: [],
    productUpsert: [],
  };
  let orgSeq = 0;
  let roleSeq = 0;
  let permSeq = 0;
  let userSeq = 0;
  let fiscalYearSeq = 0;
  let periodSeq = 0;
  let accountSeq = 0;

  // Real, queryable state — needed so findUnique/findFirst/findMany
  // (added for the idempotency fix) behave like a real database instead
  // of always returning nothing.
  const organizations = new Map<string, any>();
  const users = new Map<string, any>();
  const organizationUsers: any[] = [];
  const fiscalYears = new Map<string, any>();
  const accountingPeriods = new Map<string, any>();
  const accounts: any[] = [];
  const products: any[] = [];

  const prisma = {
    organization: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.organizationCreate.push(data);
        const row = { id: `org-${++orgSeq}`, ...data };
        organizations.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where.vatNumber) return [...organizations.values()].find((o) => o.vatNumber === where.vatNumber) ?? null;
        return organizations.get(where.id) ?? null;
      }),
    },
    role: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.roleCreate.push(data);
        return { id: `role-${++roleSeq}`, ...data };
      }),
    },
    permission: {
      upsert: jest.fn().mockImplementation(async ({ where, create }: any) => {
        calls.permissionUpsert.push({ where, create });
        return { id: `perm-${++permSeq}`, ...create };
      }),
    },
    rolePermission: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.rolePermissionCreate.push(data);
        return data;
      }),
    },
    user: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.userCreate.push(data);
        const row = { id: `user-${++userSeq}`, ...data };
        users.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        if (where.email) return [...users.values()].find((u) => u.email === where.email) ?? null;
        return users.get(where.id) ?? null;
      }),
    },
    organizationUser: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.organizationUserCreate.push(data);
        organizationUsers.push(data);
        return data;
      }),
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
        return organizationUsers.find((m) => m.organizationId === where.organizationId && m.userId === where.userId) ?? null;
      }),
    },
    fiscalYear: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.fiscalYearCreate.push(data);
        const row = { id: `fy-${++fiscalYearSeq}`, ...data };
        fiscalYears.set(row.id, row);
        return row;
      }),
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
        return [...fiscalYears.values()].find((fy) => fy.organizationId === where.organizationId) ?? null;
      }),
    },
    accountingPeriod: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.accountingPeriodCreate.push(data);
        const row = { id: `period-${++periodSeq}`, ...data };
        accountingPeriods.set(row.id, row);
        return row;
      }),
      findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
        return [...accountingPeriods.values()].find((p) => p.fiscalYearId === where.fiscalYearId) ?? null;
      }),
    },
    account: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.accountCreate.push(data);
        const row = { id: `acct-${++accountSeq}`, ...data };
        accounts.push(row);
        return row;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) => accounts.filter((a) => a.organizationId === where.organizationId)),
    },
    product: {
      upsert: jest.fn().mockImplementation(async ({ where, create }: any) => {
        calls.productUpsert.push({ where, create });
        const existing = products.find((p) => p.organizationId === where.organizationId_sku.organizationId && p.sku === where.organizationId_sku.sku);
        if (existing) return existing;
        const row = { id: `product-${products.length + 1}`, ...create };
        products.push(row);
        return row;
      }),
    },
  };

  return { prisma, calls };
}


describe("seedDemoOrganizationWithPrisma", () => {
  test("creates exactly one organization, role, user, fiscal year, and period", async () => {
    const { prisma, calls } = makeFakePrisma();

    await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(calls.organizationCreate).toHaveLength(1);
    expect(calls.roleCreate).toHaveLength(1);
    expect(calls.userCreate).toHaveLength(1);
    expect(calls.fiscalYearCreate).toHaveLength(1);
    expect(calls.accountingPeriodCreate).toHaveLength(1);
    expect(calls.organizationUserCreate).toHaveLength(1);
    expect(calls.productUpsert).toHaveLength(8);
  });

  test("the returned result shape matches what main.ts expects (organizationId, roleId, userId, periodId)", async () => {
    const { prisma } = makeFakePrisma();

    const result = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(result.organizationId).toBe("org-1");
    expect(result.roleId).toBe("role-1");
    expect(result.userId).toBe("user-1");
    expect(result.periodId).toBe("period-1");
  });

  test("the accounting period is linked to the fiscal year, not directly to the organization (real schema shape)", async () => {
    const { prisma, calls } = makeFakePrisma();

    await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(calls.accountingPeriodCreate[0].fiscalYearId).toBe("fy-1");
    expect(calls.accountingPeriodCreate[0]).not.toHaveProperty("organizationId");
  });

  test("seeds all 25 owner permissions, upserted by code (not plain create) so re-seeding never collides", async () => {
    const { prisma, calls } = makeFakePrisma();

    await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(calls.permissionUpsert).toHaveLength(25);
    expect(calls.rolePermissionCreate).toHaveLength(25);
    const codes = calls.permissionUpsert.map((c) => c.where.code);
    expect(codes).toContain("pos.sell");
    expect(codes).toContain("journal.post");
    expect(codes).toContain("settings.manage");
  });

  test("creates the full chart of accounts (23 accounts) and correctly resolves parent-child links by code", async () => {
    const { prisma, calls } = makeFakePrisma();

    const result = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(calls.accountCreate).toHaveLength(23);
    expect(Object.keys(result.accountIdsByCode)).toHaveLength(23);

    const cashLine = calls.accountCreate.find((c) => c.code === "1100");
    const assetsId = result.accountIdsByCode["1000"];
    expect(cashLine.parentId).toBe(assetsId);
    expect(cashLine.parentId).not.toBe("1000");
  });

  test("top-level header accounts (no parentCode) get parentId undefined, not a bogus value", async () => {
    const { prisma, calls } = makeFakePrisma();

    await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    const assetsHeader = calls.accountCreate.find((c) => c.code === "1000");
    expect(assetsHeader.parentId).toBeUndefined();
    expect(assetsHeader.isPostable).toBe(false);
  });

  test("passes the exact email and password hash given by the caller through to User.create", async () => {
    const { prisma, calls } = makeFakePrisma();

    await seedDemoOrganizationWithPrisma(prisma as any, "specific-owner@mizan.sa", "specific-hash-value");

    expect(calls.userCreate[0].email).toBe("specific-owner@mizan.sa");
    expect(calls.userCreate[0].passwordHash).toBe("specific-hash-value");
  });
});

describe("seedDemoOrganizationWithPrisma — idempotency (Sprint 34 hotfix #2)", () => {
  test("calling it twice against the SAME prisma instance does NOT throw a unique-constraint error", async () => {
    const { prisma } = makeFakePrisma();

    const first = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");
    const second = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(second.organizationId).toBe(first.organizationId);
  });

  test("the second call does NOT create a second organization, role, user, or set of accounts", async () => {
    const { prisma, calls } = makeFakePrisma();

    await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");
    await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(calls.organizationCreate).toHaveLength(1);
    expect(calls.userCreate).toHaveLength(1);
    expect(calls.accountCreate).toHaveLength(23);
    expect(calls.productUpsert).toHaveLength(16);
    expect(calls.productUpsert.map((call) => call.where.organizationId_sku.sku)).toEqual([
      "DEMO-001", "DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005", "DEMO-006", "DEMO-007", "DEMO-008",
      "DEMO-001", "DEMO-002", "DEMO-003", "DEMO-004", "DEMO-005", "DEMO-006", "DEMO-007", "DEMO-008",
    ]);
  });

  test("the second call returns the SAME roleId, userId, periodId, and accountIdsByCode as the first", async () => {
    const { prisma } = makeFakePrisma();

    const first = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");
    const second = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(second.roleId).toBe(first.roleId);
    expect(second.userId).toBe(first.userId);
    expect(second.periodId).toBe(first.periodId);
    expect(second.accountIdsByCode["1000"]).toBe(first.accountIdsByCode["1000"]);
  });

  test("throws a clear error (rather than guessing) if the organization exists but is missing expected related data", async () => {
    const { prisma } = makeFakePrisma();
    // Simulate a partial prior seed: organization exists, but nothing else was ever created for it.
    await (prisma as any).organization.create({
      data: { legalNameAr: "X", vatNumber: "300000000000003" },
    });

    await expect(seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password")).rejects.toThrow(
      /missing expected related data/,
    );
  });
});
