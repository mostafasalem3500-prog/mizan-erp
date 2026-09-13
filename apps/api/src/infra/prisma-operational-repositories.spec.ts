import {
  PrismaAssetsRepository,
  PrismaAuditSink,
  PrismaBranchesRepository,
  PrismaExpensesRepository,
  PrismaInventoryRepository,
  PrismaPaymentsRepository,
  PrismaPurchasesRepository,
  PrismaSalesRepository,
  PrismaShiftsRepository,
} from "./prisma-repositories";

const accounts = {
  getAccountIdByCode: jest.fn(async (_organizationId: string, code: string) => `account-${code}`),
};

describe("Prisma operational repositories", () => {
  test("sales invoices survive through Prisma upsert and remain tenant scoped", async () => {
    const rows = new Map<string, any>();
    const prisma = {
      salesInvoice: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const row = rows.has(where.id) ? { ...rows.get(where.id), ...update } : create;
          rows.set(where.id, row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const row = rows.get(where.id);
          return row?.organizationId === where.organizationId ? row : null;
        }),
        findMany: jest.fn(async ({ where }: any) => [...rows.values()].filter((row) => row.organizationId === where.organizationId && (!where.customerId || row.customerId === where.customerId))),
      },
    };
    const repo = new PrismaSalesRepository(prisma as any, accounts as any);
    const invoice = await repo.saveInvoice({ id: "inv-1", organizationId: "org-1", customerId: "c-1", lines: [], subtotal: "100.00", taxTotal: "15.00", total: "115.00", paidAmount: "0.00", journalEntryId: "je-1", issueDate: "2026-09-13T10:00:00.000Z" });

    expect(invoice.total).toBe("115.00");
    expect(await repo.findInvoice("org-2", "inv-1")).toBeNull();
    expect((await repo.listInvoicesForCustomer("org-1", "c-1"))[0].id).toBe("inv-1");
    expect(await repo.getGLAccountMapping("org-1")).toEqual({ accountsReceivableAccountId: "account-1200", salesRevenueAccountId: "account-4100", vatOutputAccountId: "account-2200" });
  });

  test("purchase bills and payment applications update the persisted document", async () => {
    const rows = new Map<string, any>();
    const prisma = {
      purchaseBill: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const row = rows.has(where.id) ? { ...rows.get(where.id), ...update } : create;
          rows.set(where.id, row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const row = rows.get(where.id);
          return row?.organizationId === where.organizationId ? row : null;
        }),
        findMany: jest.fn(async ({ where }: any) => [...rows.values()].filter((row) => row.organizationId === where.organizationId && (!where.supplierId || row.supplierId === where.supplierId))),
      },
    };
    const repo = new PrismaPurchasesRepository(prisma as any, accounts as any);
    const base = { id: "bill-1", organizationId: "org-1", supplierId: "s-1", lines: [], subtotal: "200.00", taxTotal: "30.00", total: "230.00", journalEntryId: "je-2", issueDate: "2026-09-13T10:00:00.000Z" };
    await repo.saveBill({ ...base, paidAmount: "0.00" });
    const paid = await repo.saveBill({ ...base, paidAmount: "50.00" });

    expect(paid.paidAmount).toBe("50.00");
    expect((await repo.listAllBills("org-1"))).toHaveLength(1);
  });

  test("inventory uses a compound tenant/product key and decimal conversion", async () => {
    const rows = new Map<string, any>();
    const prisma = {
      stockLevel: {
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const key = `${where.organizationId_productId.organizationId}:${where.organizationId_productId.productId}`;
          rows.set(key, rows.has(key) ? { ...rows.get(key), ...update } : create);
          return rows.get(key);
        }),
        findUnique: jest.fn(async ({ where }: any) => rows.get(`${where.organizationId_productId.organizationId}:${where.organizationId_productId.productId}`) ?? null),
      },
    };
    const repo = new PrismaInventoryRepository(prisma as any, accounts as any);
    await repo.saveStockLevel({ organizationId: "org-1", productId: "p-1", quantityOnHand: 3.5, averageCost: "12.25" });

    expect(await repo.getStockLevel("org-1", "p-1")).toEqual({ organizationId: "org-1", productId: "p-1", quantityOnHand: 3.5, averageCost: "12.25" });
    expect(await repo.getStockLevel("org-2", "p-1")).toBeNull();
  });

  test("expenses, assets, and payments map Prisma decimals to API money strings", async () => {
    const expense = { upsert: jest.fn(async ({ create }: any) => create), findFirst: jest.fn(async () => null) };
    const asset = { upsert: jest.fn(async ({ create }: any) => create), findFirst: jest.fn(async () => null) };
    const paymentRows: any[] = [];
    const payment = {
      upsert: jest.fn(async ({ create }: any) => { paymentRows.push(create); return create; }),
      findMany: jest.fn(async ({ where }: any) => paymentRows.filter((row) => row.organizationId === where.organizationId && row.type === where.type && row.partyId === where.partyId)),
    };
    const prisma = { expense, asset, payment };

    const savedExpense = await new PrismaExpensesRepository(prisma as any).save({ id: "e-1", organizationId: "org-1", expenseAccountCode: "6100", paymentAccountCode: "1100", amount: "10.00", taxAmount: "1.50", total: "11.50", description: "اختبار", journalEntryId: "je-e" });
    const savedAsset = await new PrismaAssetsRepository(prisma as any).save({ id: "a-1", organizationId: "org-1", name: "جهاز", cost: "1200.00", residualValue: "0.00", usefulLifeMonths: 12, accumulatedDepreciation: "100.00", acquisitionJournalEntryId: "je-a" });
    const payments = new PrismaPaymentsRepository(prisma as any);
    await payments.save({ id: "pay-1", organizationId: "org-1", type: "CUSTOMER", partyId: "c-1", amount: "25.50", journalEntryId: "je-p" });

    expect(savedExpense.total).toBe("11.50");
    expect(savedAsset.accumulatedDepreciation).toBe("100.00");
    expect((await payments.listForCustomer("org-1", "c-1"))[0].amount).toBe("25.50");
    expect(await payments.listForSupplier("org-1", "c-1")).toEqual([]);
  });

  test("branches use the organization/code compound key", async () => {
    const branch = {
      findUnique: jest.fn(async ({ where }: any) => where.organizationId_code.code === "EXISTS" ? { id: "b0" } : null),
      create: jest.fn(async ({ data }: any) => ({ id: "b1", isActive: true, ...data })),
      findMany: jest.fn(async () => [{ id: "b1", organizationId: "org-1", code: "01", name: "الرئيسي", isActive: true }]),
    };
    const repo = new PrismaBranchesRepository({ branch } as any);
    expect(await repo.codeExistsForOrganization("org-1", "EXISTS")).toBe(true);
    expect((await repo.create({ organizationId: "org-1", code: "01", name: "الرئيسي" })).isActive).toBe(true);
    expect(await repo.listForOrganization("org-1")).toHaveLength(1);
  });

  test("shifts and audit events are persisted through Prisma", async () => {
    const shifts = new Map<string, any>();
    const auditRows: any[] = [];
    const posShift = {
      create: jest.fn(async ({ data }: any) => { const row = { id: "shift-1", ...data }; shifts.set(row.id, row); return row; }),
      findFirst: jest.fn(async ({ where }: any) => [...shifts.values()].find((row) => row.organizationId === where.organizationId && (!where.id || row.id === where.id) && (!where.terminalId || row.terminalId === where.terminalId) && (!where.status || row.status === where.status)) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...shifts.get(where.id), ...data }; shifts.set(where.id, row); return row; }),
    };
    const auditLog = { create: jest.fn(async ({ data }: any) => { auditRows.push(data); return data; }) };
    const prisma = { posShift, auditLog };
    const shiftsRepo = new PrismaShiftsRepository(prisma as any);
    const created = await shiftsRepo.create({ organizationId: "org-1", terminalId: "T1", cashierUserId: "u1", openingCash: "100.00", cashSalesTotal: "0.00", cashReturnsTotal: "0.00", status: "OPEN" });
    const closed = await shiftsRepo.update(created.id, { status: "CLOSED", actualCash: "100.00", expectedCash: "100.00", cashDifference: "0.00" });
    await new PrismaAuditSink(prisma as any).record({ action: "period.close", organizationId: "org-1", entityPath: "/periods/p1/close", requestBody: {}, timestamp: "2026-09-13T10:00:00.000Z", outcome: "success" });

    expect(closed.status).toBe("CLOSED");
    expect(await shiftsRepo.findOpenShiftForTerminal("org-1", "T1")).toBeNull();
    expect(auditRows[0]).toEqual(expect.objectContaining({ action: "period.close", organizationId: "org-1", outcome: "success" }));
  });
});
