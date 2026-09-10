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

  const prisma = {
    organization: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.organizationCreate.push(data);
        return { id: `org-${++orgSeq}`, ...data };
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
        return { id: `user-${++userSeq}`, ...data };
      }),
    },
    organizationUser: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.organizationUserCreate.push(data);
        return data;
      }),
    },
    fiscalYear: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.fiscalYearCreate.push(data);
        return { id: `fy-${++fiscalYearSeq}`, ...data };
      }),
    },
    accountingPeriod: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.accountingPeriodCreate.push(data);
        return { id: `period-${++periodSeq}`, ...data };
      }),
    },
    account: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        calls.accountCreate.push(data);
        return { id: `acct-${++accountSeq}`, ...data };
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
});
