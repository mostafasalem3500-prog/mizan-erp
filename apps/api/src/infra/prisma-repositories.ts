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
    settings: Partial<Pick<OrganizationRow, "requireShiftForPosSale">>,
  ): Promise<OrganizationRow> {
    const row = await (this.prisma as any).organization.update({
      where: { id: organizationId },
      data: settings,
    });
    return toOrganizationRow(row);
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
