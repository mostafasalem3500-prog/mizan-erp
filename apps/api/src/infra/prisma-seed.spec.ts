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
  };
  let orgSeq = 0;
  let roleSeq = 0;
  let permSeq = 0;
  let userSeq = 0;
  let fiscalYearSeq = 0;
  let periodSeq = 0;
  let accountSeq = 0;

  const organizations = new Map<string, any>();
  const users = new Map<string, any>();
  const memberships = new Map<string, any>();
  const fiscalYears = new Map<string, any>();
  const periods = new Map<string, any>();
  const accounts = new Map<string, any>();

  const prisma = {
    organization: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.organizationCreate.push(data);
        const row = { id: `org-${++orgSeq}`, ...data };
        organizations.set(row.id, row);
        return row;
      }),
      // Defaults to "no existing demo org" so every pre-existing test below
      // (which never seeds `organizations`) still takes the create path.
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
      findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
        const row = where.email ? [...users.values()].find((u) => u.email === where.email) : users.get(where.id);
        if (!row) throw new Error("NotFoundError: user");
        return row;
      }),
    },
    organizationUser: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.organizationUserCreate.push(data);
        memberships.set(`${data.organizationId}:${data.userId}`, data);
        return data;
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
        const key = `${where.organizationId_userId.organizationId}:${where.organizationId_userId.userId}`;
        const row = memberships.get(key);
        if (!row) throw new Error("NotFoundError: organizationUser");
        return row;
      }),
    },
    fiscalYear: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.fiscalYearCreate.push(data);
        const row = { id: `fy-${++fiscalYearSeq}`, ...data };
        fiscalYears.set(row.id, row);
        return row;
      }),
    },
    accountingPeriod: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.accountingPeriodCreate.push(data);
        const row = { id: `period-${++periodSeq}`, ...data };
        periods.set(row.id, row);
        return row;
      }),
      findFirstOrThrow: jest.fn().mockImplementation(async ({ where }: any) => {
        const orgId = where.fiscalYear.organizationId;
        const row = [...periods.values()].find(
          (p) => fiscalYears.get(p.fiscalYearId)?.organizationId === orgId && p.status === where.status,
        );
        if (!row) throw new Error("NotFoundError: accountingPeriod");
        return row;
      }),
    },
    account: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.accountCreate.push(data);
        const row = { id: `acct-${++accountSeq}`, ...data };
        accounts.set(row.id, row);
        return row;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) => [...accounts.values()].filter((a) => a.organizationId === where.organizationId)),
    },
  };

  return { prisma, calls, organizations, periods };
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

  test("creates the full chart of accounts (22 accounts) and correctly resolves parent-child links by code", async () => {
    const { prisma, calls } = makeFakePrisma();

    const result = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(calls.accountCreate).toHaveLength(22);
    expect(Object.keys(result.accountIdsByCode)).toHaveLength(22);

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

  test("second call (simulating a redeploy) reuses the existing demo org instead of colliding on vatNumber", async () => {
    const { prisma, calls } = makeFakePrisma();

    const first = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");
    const second = await seedDemoOrganizationWithPrisma(prisma as any, "owner@test.sa", "hashed-password");

    expect(calls.organizationCreate).toHaveLength(1);
    expect(calls.userCreate).toHaveLength(1);
    expect(second).toEqual(first);
  });
});
