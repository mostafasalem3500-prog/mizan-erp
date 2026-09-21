/**
 * Sprint 34 — real Prisma implementations of the three repositories that
 * must move to Postgres TOGETHER before USE_REAL_PRISMA_ACCOUNTING is
 * safe to flip: Accounts (the posting engine writes journal_entry_lines
 * with a real foreign key to accounts.id), Organizations, and Periods.
 * See prisma-seed.ts's header comment for why these can't be migrated
 * one at a time.
 *
 * These are NOT yet wired into app.module.ts — that wiring, plus finally
 * flipping the flag, is the next step, done only after this file's own
 * correctness is checked against a real deploy (this dev sandbox still
 * cannot generate a real typed Prisma Client to type-check these calls
 * against actual model types — see docs/MVP_ROADMAP.md).
 */

import type { PrismaClient } from "@prisma/client";
import type { AccountsRepository, AccountRow, CreateAccountInput } from "../modules/accounts/accounts.service";
import type {
  OrganizationsRepository,
  OrganizationRow,
  CreateOrganizationResult,
} from "../modules/organizations/organizations.service";
import type { PeriodsRepository, PeriodRow, CreatePeriodInput, PeriodStatus } from "../modules/periods/periods.service";
import type { AccountingQueryRepository, JournalEntrySummary, TrialBalanceLine } from "../modules/accounting/accounting-query.service";
import type { GeneralLedgerRepository, LedgerLineRow } from "../modules/reporting/reporting.service";
import type { AuthUserLookup, UserCredentialsRow, OrganizationMembershipRow } from "../modules/auth/auth.service";
import type { CustomersRepository, CustomerRow, CreateCustomerInput } from "../modules/customers/customers.service";
import type { SuppliersRepository, SupplierRow, CreateSupplierInput } from "../modules/suppliers/suppliers.service";
import type { ProductsRepository, ProductRow, CreateProductInput } from "../modules/inventory/products.service";
import type { RolePermissionLookup } from "../modules/common/permissions.guard";
import type { PosRepository, PosGLAccountMapping, PosSaleRecord, AtomicPosSaleInput } from "../modules/pos/pos.service";
import type { SalesRepository, SalesGLAccountMapping, SalesInvoiceRecord } from "../modules/sales/sales.service";
import type { PurchasesRepository, PurchasesGLAccountMapping, PurchaseBillRecord } from "../modules/purchases/purchases.service";
import type { InventoryRepository, InventoryGLAccountMapping, StockLevel } from "../modules/inventory/inventory.service";
import type { ExpensesRepository, ExpenseRecord } from "../modules/expenses/expenses.service";
import type { AssetsRepository, AssetRecord } from "../modules/assets/assets.service";
import type { PaymentsRepository, PaymentRecord } from "../modules/payments/payments.service";
import type { BranchesRepository, BranchRow, CreateBranchInput } from "../modules/branches/branches.service";
import type { ShiftsRepository, ShiftRecord } from "../modules/pos/shifts.service";
import type { AuditLogEntry, AuditSink } from "../modules/common/audit.interceptor";
import { AccountsService } from "../modules/accounts/accounts.service";
import { AccountingPostingEngine } from "../modules/accounting/accounting-posting-engine";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { OWNER_PERMISSIONS } from "./prisma-seed";

function toAccountRow(row: any): AccountRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn ?? undefined,
    type: row.type,
    parentId: row.parentId ?? undefined,
    isPostable: row.isPostable,
    isActive: row.isActive,
  };
}

export class PrismaAccountsRepository implements AccountsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: Omit<CreateAccountInput, "parentCode"> & { parentId?: string }): Promise<AccountRow> {
    const row = await (this.prisma as any).account.create({
      data: {
        organizationId: input.organizationId,
        code: input.code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        type: input.type,
        parentId: input.parentId,
        isPostable: input.isPostable ?? true,
      },
    });
    return toAccountRow(row);
  }

  async findByCode(organizationId: string, code: string): Promise<AccountRow | null> {
    const row = await (this.prisma as any).account.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
    return row ? toAccountRow(row) : null;
  }

  async findById(organizationId: string, accountId: string): Promise<AccountRow | null> {
    const row = await (this.prisma as any).account.findUnique({ where: { id: accountId } });
    // Defensive tenant check — id alone is a real global primary key, but
    // this repository must never let one organization read another's
    // account by guessing/reusing an id.
    if (!row || row.organizationId !== organizationId) return null;
    return toAccountRow(row);
  }

  async listForOrganization(organizationId: string): Promise<AccountRow[]> {
    const rows = await (this.prisma as any).account.findMany({ where: { organizationId } });
    return rows.map(toAccountRow);
  }
}

function toOrganizationRow(row: any): OrganizationRow {
  return {
    id: row.id,
    legalNameAr: row.legalNameAr,
    legalNameEn: row.legalNameEn ?? undefined,
    vatNumber: row.vatNumber ?? undefined,
    crNumber: row.crNumber ?? undefined,
    requireShiftForPosSale: row.requireShiftForPosSale,
    streetName: row.streetName ?? undefined,
    buildingNumber: row.buildingNumber ?? undefined,
    city: row.city ?? undefined,
    postalZone: row.postalZone ?? undefined,
    district: row.district ?? undefined,
    countryCode: row.countryCode ?? undefined,
    commercialName: row.commercialName ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    invoiceFooter: row.invoiceFooter ?? undefined,
    defaultReceiptTemplate: row.defaultReceiptTemplate ?? "thermal",
    invoiceTemplateConfig: row.invoiceTemplateConfig ?? undefined,
  };
}

export class PrismaOrganizationsRepository implements OrganizationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async vatNumberExists(vatNumber: string): Promise<boolean> {
    const row = await (this.prisma as any).organization.findUnique({ where: { vatNumber } });
    return row !== null;
  }

  async createOrganizationWithOwner(input: {
    organization: { legalNameAr: string; legalNameEn?: string; vatNumber?: string; crNumber?: string };
    seededRoleNames: readonly string[];
    ownerRoleName: string;
    owner: { email: string; fullName: string; passwordHash: string };
  }): Promise<CreateOrganizationResult> {
    const organization = await (this.prisma as any).organization.create({ data: input.organization });

    let ownerRoleId = "";
    for (const roleName of input.seededRoleNames) {
      const role = await (this.prisma as any).role.create({
        data: { organizationId: organization.id, name: roleName, isSystem: true },
      });
      if (roleName === input.ownerRoleName) {
        ownerRoleId = role.id;
        for (const code of OWNER_PERMISSIONS) {
          const permission = await (this.prisma as any).permission.upsert({
            where: { code },
            update: {},
            create: { code, module: code.split(".")[0] },
          });
          await (this.prisma as any).rolePermission.create({
            data: { roleId: role.id, permissionId: permission.id },
          });
        }
      }
    }

    const user = await (this.prisma as any).user.create({ data: input.owner });
    await (this.prisma as any).organizationUser.create({
      data: { organizationId: organization.id, userId: user.id, roleId: ownerRoleId },
    });

    return { organizationId: organization.id, ownerUserId: user.id, ownerRoleId };
  }

  async findById(organizationId: string): Promise<OrganizationRow | null> {
    const row = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } });
    return row ? toOrganizationRow(row) : null;
  }

  async updateSettings(
    organizationId: string,
    settings: Partial<Omit<OrganizationRow, "id">>,
  ): Promise<OrganizationRow> {
    const row = await (this.prisma as any).organization.update({
      where: { id: organizationId },
      data: settings,
    });
    return toOrganizationRow(row);
  }
}

function toBranchRow(row: any): BranchRow {
  return { id: row.id, organizationId: row.organizationId, code: row.code, name: row.name, address: row.address ?? undefined, isActive: row.isActive };
}

export class PrismaBranchesRepository implements BranchesRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async codeExistsForOrganization(organizationId: string, code: string): Promise<boolean> {
    return (await (this.prisma as any).branch.findUnique({ where: { organizationId_code: { organizationId, code } } })) !== null;
  }
  async create(input: CreateBranchInput): Promise<BranchRow> {
    return toBranchRow(await (this.prisma as any).branch.create({ data: input }));
  }
  async listForOrganization(organizationId: string): Promise<BranchRow[]> {
    const rows = await (this.prisma as any).branch.findMany({ where: { organizationId }, orderBy: { code: "asc" } });
    return rows.map(toBranchRow);
  }
}

export class PrismaAuthUserLookup implements AuthUserLookup {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Sprint 34 hotfix — found live via a real login attempt on Railway,
   * not caught beforehand: this repository is the FOURTH one that had
   * to move alongside Accounts/Organizations/Periods, and was missed in
   * the original Sprint 34 commit. Without it, seedDemoOrganizationWithPrisma()
   * writes the user into real Postgres, but AuthService's login was still
   * reading from the (empty, in this mode) in-memory users store —
   * findCredentialsByEmail() returned null for every login attempt,
   * surfacing as "Invalid credentials" even with the exact right password.
   * Confirmed against auth.service.ts's actual two distinct error paths
   * (401 "Invalid credentials" vs 401 "User is not a member of this
   * organization") before writing this fix — the error message actually
   * returned ruled out a stale-organization-id mismatch and pointed
   * specifically at findCredentialsByEmail() returning null.
   */
  async findCredentialsByEmail(email: string): Promise<UserCredentialsRow | null> {
    const user = await (this.prisma as any).user.findUnique({ where: { email } });
    if (!user) return null;
    return { userId: user.id, passwordHash: user.passwordHash, isActive: user.isActive };
  }

  async findMembership(userId: string, organizationId: string): Promise<OrganizationMembershipRow | null> {
    const membership = await (this.prisma as any).organizationUser.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!membership) return null;
    return { organizationId: membership.organizationId, roleId: membership.roleId, branchId: membership.branchId ?? undefined };
  }

  async listMemberships(userId: string): Promise<OrganizationMembershipRow[]> {
    const memberships = await (this.prisma as any).organizationUser.findMany({ where: { userId } });
    return memberships.map((m: any) => ({ organizationId: m.organizationId, roleId: m.roleId, branchId: m.branchId ?? undefined }));
  }
}

export class PrismaPeriodsRepository implements PeriodsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * The real schema nests AccountingPeriod under FiscalYear, but
   * PeriodRow (and every caller of this repository) treats a period as
   * flat with its own organizationId/startDate/endDate. This repository
   * bridges that gap by creating a matching FiscalYear row alongside
   * each period it creates, and by joining through fiscalYear when
   * listing, rather than requiring every caller to know about fiscal
   * years — a real modeling mismatch, resolved here rather than pushed
   * out to callers.
   */
  async listForOrganization(organizationId: string): Promise<PeriodRow[]> {
    const rows = await (this.prisma as any).accountingPeriod.findMany({
      where: { fiscalYear: { organizationId } },
      include: { fiscalYear: true },
    });
    return rows.map((row: any) => ({
      id: row.id,
      organizationId: row.fiscalYear.organizationId,
      status: row.status,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
    }));
  }

  async create(input: CreatePeriodInput): Promise<PeriodRow> {
    const fiscalYear = await (this.prisma as any).fiscalYear.create({
      data: {
        organizationId: input.organizationId,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        status: "OPEN",
      },
    });
    const period = await (this.prisma as any).accountingPeriod.create({
      data: {
        fiscalYearId: fiscalYear.id,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        status: "OPEN",
      },
    });
    return {
      id: period.id,
      organizationId: input.organizationId,
      status: period.status,
      startDate: input.startDate,
      endDate: input.endDate,
    };
  }

  async findById(organizationId: string, periodId: string): Promise<PeriodRow | null> {
    const row = await (this.prisma as any).accountingPeriod.findUnique({
      where: { id: periodId },
      include: { fiscalYear: true },
    });
    if (!row || row.fiscalYear.organizationId !== organizationId) return null;
    return {
      id: row.id,
      organizationId,
      status: row.status,
      startDate: row.startDate.toISOString(),
      endDate: row.endDate.toISOString(),
    };
  }

  async updateStatus(organizationId: string, periodId: string, status: PeriodStatus): Promise<PeriodRow> {
    const existing = await this.findById(organizationId, periodId);
    if (!existing) throw new Error(`Accounting period ${periodId} not found for organization ${organizationId}`);
    const row = await (this.prisma as any).accountingPeriod.update({ where: { id: periodId }, data: { status } });
    return { ...existing, status: row.status };
  }
}

function decimalString(value: any): string {
  return value?.toFixed?.(4) ?? Number(value ?? 0).toFixed(4);
}

function decimalScaled(value: any): bigint {
  const stringValue = decimalString(value);
  const [whole, fraction = ""] = stringValue.split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (BigInt(whole.replace("-", "") || "0") * 10000n + BigInt((fraction + "0000").slice(0, 4)));
}

function scaledString(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 10000n}.${(absolute % 10000n).toString().padStart(4, "0")}`;
}

export class PrismaAccountingQueryRepository implements AccountingQueryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getTrialBalanceForPeriod(organizationId: string, periodId: string): Promise<TrialBalanceLine[]> {
    const grouped = await (this.prisma as any).journalEntryLine.groupBy({
      by: ["accountId"],
      where: { journalEntry: { organizationId, periodId } },
      _sum: { debit: true, credit: true },
    });
    const accounts = await (this.prisma as any).account.findMany({
      where: { organizationId, id: { in: grouped.map((row: any) => row.accountId) } },
    });
    const byId = new Map(accounts.map((account: any) => [account.id, account]));
    return grouped.map((row: any) => {
      const account: any = byId.get(row.accountId);
      return {
        accountId: row.accountId,
        accountCode: account?.code ?? row.accountId,
        accountName: account?.nameAr ?? account?.nameEn ?? row.accountId,
        totalDebit: decimalString(row._sum.debit),
        totalCredit: decimalString(row._sum.credit),
      };
    });
  }

  async listJournalEntriesForPeriod(organizationId: string, periodId: string): Promise<JournalEntrySummary[]> {
    const entries = await (this.prisma as any).journalEntry.findMany({
      where: { organizationId, periodId },
      include: { lines: { select: { debit: true, credit: true } } },
      orderBy: { postedAt: "desc" },
      take: 250,
    });
    return entries.map((entry: any) => ({
      id: entry.id,
      sourceEvent: entry.sourceEvent,
      sourceDocId: entry.sourceDocId ?? undefined,
      reference: entry.reference ?? undefined,
      postedAt: entry.postedAt.toISOString(),
      isReversal: entry.isReversal,
      reversedById: entry.reversedById ?? undefined,
      totalDebit: scaledString(entry.lines.reduce((sum: bigint, line: any) => sum + decimalScaled(line.debit), 0n)),
      totalCredit: scaledString(entry.lines.reduce((sum: bigint, line: any) => sum + decimalScaled(line.credit), 0n)),
    }));
  }
}

export class PrismaGeneralLedgerRepository implements GeneralLedgerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getLedgerLines(organizationId: string, periodId: string, accountId: string): Promise<LedgerLineRow[]> {
    const lines = await (this.prisma as any).journalEntryLine.findMany({
      where: { accountId, journalEntry: { organizationId, periodId } },
      include: { journalEntry: true },
      orderBy: { journalEntry: { postedAt: "asc" } },
    });
    return lines.map((line: any) => ({
      journalEntryId: line.journalEntryId,
      sourceEvent: line.journalEntry.sourceEvent,
      reference: line.journalEntry.reference ?? undefined,
      debit: decimalString(line.debit),
      credit: decimalString(line.credit),
    }));
  }
}

function toCustomerRow(row: any): CustomerRow {
  return {
    id: row.id, organizationId: row.organizationId, name: row.name,
    vatNumber: row.vatNumber ?? undefined, phone: row.phone ?? undefined, email: row.email ?? undefined,
    crNumber: row.crNumber ?? undefined, streetName: row.streetName ?? undefined,
    buildingNumber: row.buildingNumber ?? undefined, city: row.city ?? undefined,
    postalZone: row.postalZone ?? undefined, district: row.district ?? undefined,
    countryCode: row.countryCode ?? undefined,
  };
}

export class PrismaCustomersRepository implements CustomersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateCustomerInput): Promise<CustomerRow> {
    const row = await (this.prisma as any).customer.create({ data: input });
    return toCustomerRow(row);
  }

  async findById(organizationId: string, customerId: string): Promise<CustomerRow | null> {
    const row = await (this.prisma as any).customer.findUnique({ where: { id: customerId } });
    if (!row || row.organizationId !== organizationId) return null;
    return toCustomerRow(row);
  }

  async listForOrganization(organizationId: string): Promise<CustomerRow[]> {
    const rows = await (this.prisma as any).customer.findMany({ where: { organizationId } });
    return rows.map(toCustomerRow);
  }
}

function toSupplierRow(row: any): SupplierRow {
  return { id: row.id, organizationId: row.organizationId, name: row.name, vatNumber: row.vatNumber ?? undefined, phone: row.phone ?? undefined, email: row.email ?? undefined };
}

export class PrismaSuppliersRepository implements SuppliersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateSupplierInput): Promise<SupplierRow> {
    const row = await (this.prisma as any).supplier.create({ data: input });
    return toSupplierRow(row);
  }

  async findById(organizationId: string, supplierId: string): Promise<SupplierRow | null> {
    const row = await (this.prisma as any).supplier.findUnique({ where: { id: supplierId } });
    if (!row || row.organizationId !== organizationId) return null;
    return toSupplierRow(row);
  }

  async listForOrganization(organizationId: string): Promise<SupplierRow[]> {
    const rows = await (this.prisma as any).supplier.findMany({ where: { organizationId } });
    return rows.map(toSupplierRow);
  }
}

function toProductRow(row: any): ProductRow {
  return { id: row.id, organizationId: row.organizationId, sku: row.sku, name: row.name, unit: row.unit, sellingPrice: Number(row.sellingPrice), taxCode: row.taxCode };
}

export class PrismaProductsRepository implements ProductsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateProductInput): Promise<ProductRow> {
    const row = await (this.prisma as any).product.create({ data: input });
    return toProductRow(row);
  }

  async findById(organizationId: string, productId: string): Promise<ProductRow | null> {
    const row = await (this.prisma as any).product.findUnique({ where: { id: productId } });
    if (!row || row.organizationId !== organizationId) return null;
    return toProductRow(row);
  }

  async findBySku(organizationId: string, sku: string): Promise<ProductRow | null> {
    const row = await (this.prisma as any).product.findUnique({ where: { organizationId_sku: { organizationId, sku } } });
    return row ? toProductRow(row) : null;
  }

  async listForOrganization(organizationId: string): Promise<ProductRow[]> {
    const rows = await (this.prisma as any).product.findMany({ where: { organizationId } });
    return rows.map(toProductRow);
  }
}

function money2(value: any): string {
  return Number(value ?? 0).toFixed(2);
}

function toSalesInvoiceRecord(row: any): SalesInvoiceRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerId: row.customerId,
    periodId: row.periodId ?? "",
    lines: row.lines,
    subtotal: money2(row.subtotal),
    taxTotal: money2(row.taxTotal),
    total: money2(row.total),
    paidAmount: money2(row.paidAmount),
    journalEntryId: row.journalEntryId,
    issueDate: new Date(row.issueDate).toISOString(),
  };
}

export class PrismaSalesRepository implements SalesRepository {
  constructor(private readonly prisma: PrismaClient, private readonly accounts: AccountsService) {}

  async getGLAccountMapping(organizationId: string): Promise<SalesGLAccountMapping> {
    return {
      accountsReceivableAccountId: await this.accounts.getAccountIdByCode(organizationId, "1200"),
      salesRevenueAccountId: await this.accounts.getAccountIdByCode(organizationId, "4100"),
      vatOutputAccountId: await this.accounts.getAccountIdByCode(organizationId, "2200"),
    };
  }

  async saveInvoice(record: SalesInvoiceRecord): Promise<SalesInvoiceRecord> {
    const data = {
      organizationId: record.organizationId,
      customerId: record.customerId,
      periodId: record.periodId,
      lines: record.lines,
      subtotal: record.subtotal,
      taxTotal: record.taxTotal,
      total: record.total,
      paidAmount: record.paidAmount,
      journalEntryId: record.journalEntryId,
      issueDate: new Date(record.issueDate),
    };
    const row = await (this.prisma as any).salesInvoice.upsert({ where: { id: record.id }, create: { id: record.id, ...data }, update: data });
    return toSalesInvoiceRecord(row);
  }

  async findInvoice(organizationId: string, invoiceId: string): Promise<SalesInvoiceRecord | null> {
    const row = await (this.prisma as any).salesInvoice.findFirst({ where: { id: invoiceId, organizationId } });
    return row ? toSalesInvoiceRecord(row) : null;
  }

  async listInvoicesForCustomer(organizationId: string, customerId: string): Promise<SalesInvoiceRecord[]> {
    const rows = await (this.prisma as any).salesInvoice.findMany({ where: { organizationId, customerId }, orderBy: { issueDate: "desc" } });
    return rows.map(toSalesInvoiceRecord);
  }

  async listAllInvoices(organizationId: string): Promise<SalesInvoiceRecord[]> {
    const rows = await (this.prisma as any).salesInvoice.findMany({ where: { organizationId }, orderBy: { issueDate: "desc" } });
    return rows.map(toSalesInvoiceRecord);
  }
}

function toPurchaseBillRecord(row: any): PurchaseBillRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    supplierId: row.supplierId,
    periodId: row.periodId ?? "",
    lines: row.lines,
    subtotal: money2(row.subtotal),
    taxTotal: money2(row.taxTotal),
    total: money2(row.total),
    paidAmount: money2(row.paidAmount),
    journalEntryId: row.journalEntryId,
    issueDate: new Date(row.issueDate).toISOString(),
  };
}

export class PrismaPurchasesRepository implements PurchasesRepository {
  constructor(private readonly prisma: PrismaClient, private readonly accounts: AccountsService) {}

  async getGLAccountMapping(organizationId: string): Promise<PurchasesGLAccountMapping> {
    return {
      inventoryAccountId: await this.accounts.getAccountIdByCode(organizationId, "1300"),
      vatInputAccountId: await this.accounts.getAccountIdByCode(organizationId, "1400"),
      accountsPayableAccountId: await this.accounts.getAccountIdByCode(organizationId, "2100"),
      generalExpenseAccountId: await this.accounts.getAccountIdByCode(organizationId, "6100"),
    };
  }

  async saveBill(record: PurchaseBillRecord): Promise<PurchaseBillRecord> {
    const data = {
      organizationId: record.organizationId,
      supplierId: record.supplierId,
      periodId: record.periodId,
      lines: record.lines,
      subtotal: record.subtotal,
      taxTotal: record.taxTotal,
      total: record.total,
      paidAmount: record.paidAmount,
      journalEntryId: record.journalEntryId,
      issueDate: new Date(record.issueDate),
    };
    const row = await (this.prisma as any).purchaseBill.upsert({ where: { id: record.id }, create: { id: record.id, ...data }, update: data });
    return toPurchaseBillRecord(row);
  }

  async findBill(organizationId: string, billId: string): Promise<PurchaseBillRecord | null> {
    const row = await (this.prisma as any).purchaseBill.findFirst({ where: { id: billId, organizationId } });
    return row ? toPurchaseBillRecord(row) : null;
  }

  async listBillsForSupplier(organizationId: string, supplierId: string): Promise<PurchaseBillRecord[]> {
    const rows = await (this.prisma as any).purchaseBill.findMany({ where: { organizationId, supplierId }, orderBy: { issueDate: "desc" } });
    return rows.map(toPurchaseBillRecord);
  }

  async listAllBills(organizationId: string): Promise<PurchaseBillRecord[]> {
    const rows = await (this.prisma as any).purchaseBill.findMany({ where: { organizationId }, orderBy: { issueDate: "desc" } });
    return rows.map(toPurchaseBillRecord);
  }
}

export class PrismaInventoryRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaClient, private readonly accounts: AccountsService) {}

  async getGLAccountMapping(organizationId: string): Promise<InventoryGLAccountMapping> {
    return {
      inventoryAccountId: await this.accounts.getAccountIdByCode(organizationId, "1300"),
      cogsAccountId: await this.accounts.getAccountIdByCode(organizationId, "5100"),
      openingBalanceEquityAccountId: await this.accounts.getAccountIdByCode(organizationId, "3100"),
    };
  }

  async getStockLevel(organizationId: string, productId: string): Promise<StockLevel | null> {
    const row = await (this.prisma as any).stockLevel.findUnique({ where: { organizationId_productId: { organizationId, productId } } });
    return row ? { organizationId: row.organizationId, productId: row.productId, quantityOnHand: Number(row.quantityOnHand), averageCost: money2(row.averageCost) } : null;
  }

  async saveStockLevel(level: StockLevel): Promise<void> {
    const data = { quantityOnHand: level.quantityOnHand, averageCost: level.averageCost };
    await (this.prisma as any).stockLevel.upsert({
      where: { organizationId_productId: { organizationId: level.organizationId, productId: level.productId } },
      create: { organizationId: level.organizationId, productId: level.productId, ...data },
      update: data,
    });
  }
}

function toExpenseRecord(row: any): ExpenseRecord {
  return { id: row.id, organizationId: row.organizationId, periodId: row.periodId ?? "", expenseAccountCode: row.expenseAccountCode, paymentAccountCode: row.paymentAccountCode, amount: money2(row.amount), taxCode: row.taxCode ?? "STANDARD", taxAmount: money2(row.taxAmount), total: money2(row.total), description: row.description, journalEntryId: row.journalEntryId };
}

export class PrismaExpensesRepository implements ExpensesRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async save(record: ExpenseRecord): Promise<ExpenseRecord> {
    const { id, ...data } = record;
    const row = await (this.prisma as any).expense.upsert({ where: { id }, create: { id, ...data }, update: data });
    return toExpenseRecord(row);
  }
  async findById(organizationId: string, expenseId: string): Promise<ExpenseRecord | null> {
    const row = await (this.prisma as any).expense.findFirst({ where: { id: expenseId, organizationId } });
    return row ? toExpenseRecord(row) : null;
  }
  async listAll(organizationId: string): Promise<ExpenseRecord[]> {
    const rows = await (this.prisma as any).expense.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    return rows.map(toExpenseRecord);
  }
}

function toAssetRecord(row: any): AssetRecord {
  return { id: row.id, organizationId: row.organizationId, name: row.name, cost: money2(row.cost), residualValue: money2(row.residualValue), usefulLifeMonths: row.usefulLifeMonths, accumulatedDepreciation: money2(row.accumulatedDepreciation), acquisitionJournalEntryId: row.acquisitionJournalEntryId };
}

export class PrismaAssetsRepository implements AssetsRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async save(record: AssetRecord): Promise<AssetRecord> {
    const { id, ...data } = record;
    const row = await (this.prisma as any).asset.upsert({ where: { id }, create: { id, ...data }, update: data });
    return toAssetRecord(row);
  }
  async findById(organizationId: string, assetId: string): Promise<AssetRecord | null> {
    const row = await (this.prisma as any).asset.findFirst({ where: { id: assetId, organizationId } });
    return row ? toAssetRecord(row) : null;
  }
}

function toPaymentRecord(row: any): PaymentRecord {
  return { id: row.id, organizationId: row.organizationId, type: row.type, partyId: row.partyId, amount: money2(row.amount), journalEntryId: row.journalEntryId };
}

export class PrismaPaymentsRepository implements PaymentsRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async save(record: PaymentRecord): Promise<PaymentRecord> {
    const { id, ...data } = record;
    const row = await (this.prisma as any).payment.upsert({ where: { id }, create: { id, ...data }, update: data });
    return toPaymentRecord(row);
  }
  async listForCustomer(organizationId: string, customerId: string): Promise<PaymentRecord[]> {
    const rows = await (this.prisma as any).payment.findMany({ where: { organizationId, type: "CUSTOMER", partyId: customerId }, orderBy: { createdAt: "desc" } });
    return rows.map(toPaymentRecord);
  }
  async listForSupplier(organizationId: string, supplierId: string): Promise<PaymentRecord[]> {
    const rows = await (this.prisma as any).payment.findMany({ where: { organizationId, type: "SUPPLIER", partyId: supplierId }, orderBy: { createdAt: "desc" } });
    return rows.map(toPaymentRecord);
  }
}

function toShiftRecord(row: any): ShiftRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    terminalId: row.terminalId,
    cashierUserId: row.cashierUserId,
    openingCash: money2(row.openingCash),
    cashSalesTotal: money2(row.cashSalesTotal),
    cashReturnsTotal: money2(row.cashReturnsTotal),
    status: row.status,
    actualCash: row.actualCash == null ? undefined : money2(row.actualCash),
    expectedCash: row.expectedCash == null ? undefined : money2(row.expectedCash),
    cashDifference: row.cashDifference == null ? undefined : money2(row.cashDifference),
  };
}

export class PrismaShiftsRepository implements ShiftsRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async create(record: Omit<ShiftRecord, "id">): Promise<ShiftRecord> {
    return toShiftRecord(await (this.prisma as any).posShift.create({ data: record }));
  }
  async findById(organizationId: string, shiftId: string): Promise<ShiftRecord | null> {
    const row = await (this.prisma as any).posShift.findFirst({ where: { id: shiftId, organizationId } });
    return row ? toShiftRecord(row) : null;
  }
  async findOpenShiftForTerminal(organizationId: string, terminalId: string): Promise<ShiftRecord | null> {
    const row = await (this.prisma as any).posShift.findFirst({ where: { organizationId, terminalId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
    return row ? toShiftRecord(row) : null;
  }
  async update(shiftId: string, patch: Partial<ShiftRecord>): Promise<ShiftRecord> {
    const { id: _id, ...data } = patch;
    if (data.status === "CLOSED") (data as any).closedAt = new Date();
    return toShiftRecord(await (this.prisma as any).posShift.update({ where: { id: shiftId }, data }));
  }
}

export class PrismaAuditSink implements AuditSink {
  constructor(private readonly prisma: PrismaClient) {}
  async record(entry: AuditLogEntry): Promise<void> {
    await (this.prisma as any).auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId,
        organizationId: entry.organizationId,
        branchId: entry.branchId,
        entityPath: entry.entityPath,
        requestBody: entry.requestBody == null ? null : entry.requestBody,
        timestamp: new Date(entry.timestamp),
        outcome: entry.outcome,
        errorMessage: entry.errorMessage,
      },
    });
  }
}

/**
 * Sprint 37 — the FIFTH repository found still bound to the empty
 * in-memory store while USE_REAL_PRISMA_DB is on, and the exact same
 * class of bug as PrismaAuthUserLookup in Sprint 34. Found the same way:
 * a real user hitting a real deployed endpoint, getting
 * "Missing required permission(s): reports.pnl.view" even though the
 * Owner role genuinely HAS that permission in Postgres — because
 * PermissionsGuard was reading role permissions from InMemoryDatabase,
 * which the real-Prisma boot path never populates.
 *
 * The lesson from Sprint 34 was recorded but not fully applied: the fix
 * then covered only the repositories that sprint happened to touch,
 * rather than auditing every remaining in-memory-only provider. The
 * remaining ones are now listed in docs/MVP_ROADMAP.md so this doesn't
 * happen a third time.
 */
export class PrismaRolePermissionLookup implements RolePermissionLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async getPermissionCodesForRole(roleId: string): Promise<string[]> {
    const rolePermissions = await (this.prisma as any).rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });
    return rolePermissions.map((rp: any) => rp.permission.code);
  }
}

function toPosSaleRecord(row: any): PosSaleRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerId: row.customerId ?? undefined,
    customerName: row.customer?.name ?? undefined,
    invoiceNumber: row.invoiceNumber,
    terminalId: row.terminalId,
    periodId: row.periodId,
    lines: row.lines,
    tenders: row.tenders,
    subtotal: Number(row.subtotal).toFixed(2),
    taxTotal: Number(row.taxTotal).toFixed(2),
    total: Number(row.total).toFixed(2),
    saleJournalEntryId: row.saleJournalEntryId,
    inventoryEffects: row.inventoryEffects,
    status: row.status,
    shiftId: row.shiftId ?? undefined,
    receiptTemplate: row.receiptTemplate ?? "thermal",
    invoiceTemplateSnapshot: row.invoiceTemplateSnapshot ?? undefined,
    soldAt: new Date(row.soldAt).toISOString(),
    remainingQuantities: row.remainingQuantities,
  };
}

export class PrismaPosRepository implements PosRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly accounts: AccountsService,
    private readonly postingEngine?: AccountingPostingEngine,
  ) {}

  async getGLAccountMapping(organizationId: string): Promise<PosGLAccountMapping> {
    return {
      cashAccountId: await this.accounts.getAccountIdByCode(organizationId, "1100"),
      cardClearingAccountId: await this.accounts.getAccountIdByCode(organizationId, "1120"),
      salesRevenueAccountId: await this.accounts.getAccountIdByCode(organizationId, "4100"),
      vatOutputAccountId: await this.accounts.getAccountIdByCode(organizationId, "2200"),
      salesReturnsAccountId: await this.accounts.getAccountIdByCode(organizationId, "4200"),
      inventoryAccountId: await this.accounts.getAccountIdByCode(organizationId, "1300"),
      cogsAccountId: await this.accounts.getAccountIdByCode(organizationId, "5100"),
    };
  }

  async saveSale(record: PosSaleRecord): Promise<PosSaleRecord> {
    const data = {
      organizationId: record.organizationId,
      customerId: record.customerId,
      invoiceNumber: record.invoiceNumber ?? record.id.slice(0, 8),
      terminalId: record.terminalId,
      periodId: record.periodId,
      lines: record.lines,
      tenders: record.tenders,
      subtotal: record.subtotal,
      taxTotal: record.taxTotal,
      total: record.total,
      saleJournalEntryId: record.saleJournalEntryId,
      inventoryEffects: record.inventoryEffects,
      remainingQuantities: record.remainingQuantities,
      status: record.status,
      shiftId: record.shiftId,
      receiptTemplate: record.receiptTemplate,
      invoiceTemplateSnapshot: record.invoiceTemplateSnapshot,
      soldAt: new Date(record.soldAt),
    };
    const row = await (this.prisma as any).posSale.upsert({ where: { id: record.id }, create: { id: record.id, ...data }, update: data });
    return toPosSaleRecord(row);
  }

  async completeSaleAtomically(input: AtomicPosSaleInput): Promise<PosSaleRecord> {
    if (!this.postingEngine) {
      throw new Error("Atomic POS posting requires AccountingPostingEngine");
    }

    return this.postingEngine.postPrepared(
      { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
      async (tx) => {
        const stockByProduct = new Map<string, { quantityOnHand: number; averageCost: string }>();
        const effects: Array<Omit<PosSaleRecord["inventoryEffects"][number], "cogsJournalEntryId">> = [];
        let totalCogsMinor = 0;

        for (let lineIndex = 0; lineIndex < input.lines.length; lineIndex++) {
          const line = input.lines[lineIndex];
          if (!line.productId) continue;

          let stock = stockByProduct.get(line.productId);
          if (!stock) {
            const product = await tx.product.findFirst({
              where: { id: line.productId, organizationId: input.organizationId },
              select: { id: true },
            });
            if (!product) throw new NotFoundException(`Product ${line.productId} not found`);

            const row = await tx.stockLevel.findUnique({
              where: {
                organizationId_productId: {
                  organizationId: input.organizationId,
                  productId: line.productId,
                },
              },
            });
            stock = {
              quantityOnHand: row ? Number(row.quantityOnHand) : 0,
              averageCost: row ? Number(row.averageCost).toFixed(2) : "0.00",
            };
          }

          if (stock.quantityOnHand < line.quantity) {
            throw new BadRequestException(
              `Insufficient stock for product ${line.productId}: have ${stock.quantityOnHand}, tried to issue ${line.quantity}`,
            );
          }

          const lineCogsMinor = Math.round(line.quantity * Number(stock.averageCost) * 100);
          totalCogsMinor += lineCogsMinor;
          stock.quantityOnHand -= line.quantity;
          stockByProduct.set(line.productId, stock);
          effects.push({
            lineIndex,
            productId: line.productId,
            quantity: line.quantity,
            unitCostUsed: stock.averageCost,
          });
        }

        const mapping = await this.getGLAccountMapping(input.organizationId);
        const financialLines = [
          ...input.financialLines,
          ...(totalCogsMinor > 0
            ? [
                { accountId: mapping.cogsAccountId, debit: (totalCogsMinor / 100).toFixed(2) },
                { accountId: mapping.inventoryAccountId, credit: (totalCogsMinor / 100).toFixed(2) },
              ]
            : []),
        ];

        return {
          request: {
            organizationId: input.organizationId,
            branchId: input.branchId,
            periodId: input.periodId,
            sourceEvent: "POS_SALE_COMPLETED" as const,
            reference: `POS sale — terminal ${input.terminalId}`,
            idempotencyKey: input.idempotencyKey,
            lines: financialLines,
          },
          afterPost: async (transaction: any, entry: any) => {
            for (const [productId, stock] of stockByProduct) {
              await transaction.stockLevel.upsert({
                where: {
                  organizationId_productId: { organizationId: input.organizationId, productId },
                },
                create: {
                  organizationId: input.organizationId,
                  productId,
                  quantityOnHand: stock.quantityOnHand,
                  averageCost: stock.averageCost,
                },
                update: { quantityOnHand: stock.quantityOnHand, averageCost: stock.averageCost },
              });
            }

            if (input.shiftId) {
              const shifted = await transaction.posShift.updateMany({
                where: {
                  id: input.shiftId,
                  organizationId: input.organizationId,
                  terminalId: input.terminalId,
                  status: "OPEN",
                },
                data: { cashSalesTotal: { increment: input.cashTendered } },
              });
              if (shifted.count !== 1) {
                throw new BadRequestException(`Shift ${input.shiftId} is no longer OPEN`);
              }
            }

            const soldAt = new Date();
            const invoiceNumber = `POS-${soldAt.toISOString().slice(0, 10).replaceAll("-", "")}-${entry.id.slice(0, 8).toUpperCase()}`;
            const row = await transaction.posSale.create({
              data: {
                id: entry.id,
                organizationId: input.organizationId,
                customerId: input.customerId,
                invoiceNumber,
                terminalId: input.terminalId,
                periodId: input.periodId,
                lines: input.lines,
                tenders: input.tenders,
                subtotal: input.subtotal,
                taxTotal: input.taxTotal,
                total: input.total,
                saleJournalEntryId: entry.id,
                inventoryEffects: effects.map((effect) => ({ ...effect, cogsJournalEntryId: entry.id })),
                remainingQuantities: input.lines.map((line) => line.quantity),
                status: "COMPLETED",
                shiftId: input.shiftId,
                receiptTemplate: input.receiptTemplate,
                invoiceTemplateSnapshot: input.invoiceTemplateSnapshot,
                soldAt,
              },
              include: { customer: true },
            });
            return toPosSaleRecord(row);
          },
        };
      },
      async (tx, entry) => {
        const row = await tx.posSale.findFirst({
          where: { id: entry.id, organizationId: input.organizationId },
          include: { customer: true },
        });
        if (!row) throw new Error(`Idempotent POS sale ${entry.id} has no persisted source document`);
        return toPosSaleRecord(row);
      },
    );
  }

  async findSale(organizationId: string, saleId: string): Promise<PosSaleRecord | null> {
    const row = await (this.prisma as any).posSale.findFirst({ where: { organizationId, OR: [{ id: saleId }, { invoiceNumber: saleId }] } });
    return row ? toPosSaleRecord(row) : null;
  }

  async searchSales(organizationId: string, query = ""): Promise<PosSaleRecord[]> {
    const rows = await (this.prisma as any).posSale.findMany({
      where: { organizationId },
      include: { customer: true },
      orderBy: { soldAt: "desc" },
      take: 200,
    });
    const needle = query.toLowerCase();
    return rows.map(toPosSaleRecord).filter((sale: PosSaleRecord) =>
      !needle || sale.id.toLowerCase().includes(needle) || sale.invoiceNumber?.toLowerCase().includes(needle) || sale.customerId?.toLowerCase().includes(needle) || sale.customerName?.toLowerCase().includes(needle) || sale.lines.some((line) => line.description.toLowerCase().includes(needle)),
    );
  }
}
