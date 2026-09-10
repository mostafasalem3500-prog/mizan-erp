/**
 * Sprint 32 (continued) — a real Prisma seed, written directly to Postgres,
 * mirroring InMemoryDatabase.seedDemoOrganization() +
 * AccountsService.seedDefaultChartOfAccounts() exactly in output shape.
 *
 * IMPORTANT — do not wire this in behind USE_REAL_PRISMA_ACCOUNTING alone.
 * That flag only swaps AccountingPostingEngine's own PrismaClientLike.
 * Every other service that resolves a GL account id
 * (AccountsService.getAccountIdByCode, used by Sales/POS/Purchases/
 * Inventory/Assets/Banking/Expenses/Payments) is STILL backed by the
 * in-memory AccountsRepository. If the posting engine is pointed at real
 * Postgres while account ids still come from the in-memory store, every
 * real posting will fail with a Postgres foreign-key violation on
 * journal_entry_lines.accountId, because that id won't exist in the real
 * `accounts` table the engine is now writing against.
 *
 * The organization, its accounting period, AND its full chart of accounts
 * must all live in the same backend (real Postgres) before flipping
 * USE_REAL_PRISMA_ACCOUNTING is safe — this function produces exactly
 * that, but wiring AccountsService itself onto Prisma (a separate,
 * not-yet-done change) is the remaining prerequisite. Tracked explicitly
 * in docs/MVP_ROADMAP.md rather than glossed over.
 */

import type { PrismaClient } from "@prisma/client";

const OWNER_PERMISSIONS = [
  "invoice.view", "invoice.create", "invoice.approve", "invoice.post", "invoice.credit", "invoice.print",
  "invoice_template.view", "invoice_template.edit", "invoice_template.publish",
  "journal.create", "journal.post", "journal.reverse",
  "pos.sell", "pos.return", "pos.discount", "pos.overrideDiscount", "pos.changePrice", "pos.cashIn", "pos.cashOut",
  "bank.reconcile", "reports.pnl.view", "zatca.view", "zatca.manage", "users.manage", "settings.manage",
];

type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "COST_OF_SALES" | "EXPENSE" | "OTHER_INCOME" | "OTHER_EXPENSE";

// Kept byte-for-byte identical to accounts.service.ts's DEFAULT_COA —
// see that file if this ever needs to change; the two must not drift.
const DEFAULT_COA: Array<{ code: string; nameAr: string; nameEn: string; type: AccountType; parentCode?: string; isPostable: boolean }> = [
  { code: "1000", nameAr: "الأصول", nameEn: "Assets", type: "ASSET", isPostable: false },
  { code: "1100", nameAr: "النقدية", nameEn: "Cash", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "1110", nameAr: "البنك", nameEn: "Bank", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "1120", nameAr: "حساب تسوية البطاقات", nameEn: "Card Clearing Account", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "1200", nameAr: "العملاء", nameEn: "Accounts Receivable", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "1300", nameAr: "المخزون", nameEn: "Inventory", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "1400", nameAr: "ضريبة القيمة المضافة - مدخلات", nameEn: "VAT Input", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "1500", nameAr: "الأصول الثابتة", nameEn: "Fixed Assets", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "1510", nameAr: "مجمّع الإهلاك", nameEn: "Accumulated Depreciation", type: "ASSET", parentCode: "1000", isPostable: true },
  { code: "2000", nameAr: "الالتزامات", nameEn: "Liabilities", type: "LIABILITY", isPostable: false },
  { code: "2100", nameAr: "الموردون", nameEn: "Accounts Payable", type: "LIABILITY", parentCode: "2000", isPostable: true },
  { code: "2200", nameAr: "ضريبة القيمة المضافة - مخرجات", nameEn: "VAT Output", type: "LIABILITY", parentCode: "2000", isPostable: true },
  { code: "3000", nameAr: "حقوق الملكية", nameEn: "Equity", type: "EQUITY", isPostable: false },
  { code: "3100", nameAr: "رصيد افتتاحي", nameEn: "Opening Balance Equity", type: "EQUITY", parentCode: "3000", isPostable: true },
  { code: "4000", nameAr: "الإيرادات", nameEn: "Revenue", type: "REVENUE", isPostable: false },
  { code: "4100", nameAr: "المبيعات", nameEn: "Sales", type: "REVENUE", parentCode: "4000", isPostable: true },
  { code: "4200", nameAr: "مردودات المبيعات", nameEn: "Sales Returns", type: "REVENUE", parentCode: "4000", isPostable: true },
  { code: "5000", nameAr: "تكلفة المبيعات", nameEn: "Cost of Sales", type: "COST_OF_SALES", isPostable: false },
  { code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: "COGS", type: "COST_OF_SALES", parentCode: "5000", isPostable: true },
  { code: "6000", nameAr: "المصروفات التشغيلية", nameEn: "Operating Expenses", type: "EXPENSE", isPostable: false },
  { code: "6100", nameAr: "مصروفات عامة", nameEn: "General Expense", type: "EXPENSE", parentCode: "6000", isPostable: true },
  { code: "6200", nameAr: "مصروف الإهلاك", nameEn: "Depreciation Expense", type: "EXPENSE", parentCode: "6000", isPostable: true },
];

export interface PrismaSeedResult {
  organizationId: string;
  roleId: string;
  userId: string;
  periodId: string;
  accountIdsByCode: Record<string, string>;
}

export async function seedDemoOrganizationWithPrisma(
  prisma: PrismaClient,
  ownerEmail: string,
  ownerPasswordHash: string,
): Promise<PrismaSeedResult> {
  const organization = await prisma.organization.create({
    data: {
      legalNameAr: "مؤسسة الأفق للتجارة",
      legalNameEn: "Al-Ufuq Trading Est.",
      vatNumber: "300000000000003",
      crNumber: "1010010000",
    },
  });

  const role = await prisma.role.create({
    data: { organizationId: organization.id, name: "Owner", isSystem: true },
  });

  // Permission is a global catalog (not tenant-scoped) — upsert by code so
  // re-seeding a second demo organization never collides on the unique
  // constraint, then link each one to this organization's Owner role.
  for (const code of OWNER_PERMISSIONS) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, module: code.split(".")[0] },
    });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: permission.id },
    });
  }

  const user = await prisma.user.create({
    data: { email: ownerEmail, passwordHash: ownerPasswordHash, fullName: "Demo Owner" },
  });

  await prisma.organizationUser.create({
    data: { organizationId: organization.id, userId: user.id, roleId: role.id },
  });

  const now = new Date();
  const yearFromNow = new Date(now);
  yearFromNow.setFullYear(yearFromNow.getFullYear() + 1);

  const fiscalYear = await prisma.fiscalYear.create({
    data: { organizationId: organization.id, startDate: now, endDate: yearFromNow, status: "OPEN" },
  });

  const period = await prisma.accountingPeriod.create({
    data: { fiscalYearId: fiscalYear.id, startDate: now, endDate: yearFromNow, status: "OPEN" },
  });

  // Chart of accounts — parents must be created before children reference
  // them (DEFAULT_COA is already ordered that way; codeToId makes each
  // child's parentId resolvable by the time it's needed).
  const accountIdsByCode: Record<string, string> = {};
  for (const def of DEFAULT_COA) {
    const account = await prisma.account.create({
      data: {
        organizationId: organization.id,
        code: def.code,
        nameAr: def.nameAr,
        nameEn: def.nameEn,
        type: def.type,
        parentId: def.parentCode ? accountIdsByCode[def.parentCode] : undefined,
        isPostable: def.isPostable,
      },
    });
    accountIdsByCode[def.code] = account.id;
  }

  return {
    organizationId: organization.id,
    roleId: role.id,
    userId: user.id,
    periodId: period.id,
    accountIdsByCode,
  };
}
