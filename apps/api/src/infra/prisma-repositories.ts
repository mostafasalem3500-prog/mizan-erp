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
import type { PeriodsRepository, PeriodRow, CreatePeriodInput } from "../modules/periods/periods.service";
import type { AuthUserLookup, UserCredentialsRow, OrganizationMembershipRow } from "../modules/auth/auth.service";
import type { CustomersRepository, CustomerRow, CreateCustomerInput } from "../modules/customers/customers.service";
import type { SuppliersRepository, SupplierRow, CreateSupplierInput } from "../modules/suppliers/suppliers.service";
import type { ProductsRepository, ProductRow, CreateProductInput } from "../modules/inventory/products.service";
import type { RolePermissionLookup } from "../modules/common/permissions.guard";
import type { PosRepository, PosGLAccountMapping, PosSaleRecord } from "../modules/pos/pos.service";
import { AccountsService } from "../modules/accounts/accounts.service";
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

  async listForOrganization(organizationId: string): Promise<ProductRow[]> {
    const rows = await (this.prisma as any).product.findMany({ where: { organizationId } });
    return rows.map(toProductRow);
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
  constructor(private readonly prisma: PrismaClient, private readonly accounts: AccountsService) {}

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
