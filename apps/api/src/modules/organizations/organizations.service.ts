import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";

export interface CreateOrganizationInput {
  legalNameAr: string;
  legalNameEn?: string;
  commercialName?: string;
  vatNumber?: string;
  crNumber?: string;
  ownerEmail: string;
  ownerFullName: string;
  ownerPassword: string;
}

export interface CreateOrganizationResult {
  organizationId: string;
  ownerUserId: string;
  ownerRoleId: string;
}

export interface OrganizationRow {
  id: string;
  legalNameAr: string;
  legalNameEn?: string;
  vatNumber?: string;
  crNumber?: string;
  requireShiftForPosSale?: boolean;
  streetName?: string;
  buildingNumber?: string;
  city?: string;
  postalZone?: string;
  district?: string;
  countryCode?: string;
}

/**
 * The default roles seeded for every new organization (spec band 101).
 * Only "Owner" is granted every permission at creation time; the rest are
 * created empty and configured later via Settings — spec band 102/103
 * ("Approval Rules... configurable") means default permission sets are a
 * product decision, not something to hardcode here.
 */
export const DEFAULT_SEEDED_ROLES = [
  "Owner",
  "General Manager",
  "Finance Manager",
  "Chief Accountant",
  "Accountant",
  "Branch Manager",
  "Sales",
  "Purchasing",
  "Inventory Manager",
  "POS Supervisor",
  "Cashier",
  "Auditor",
  "Read Only",
] as const;

/**
 * Everything OrganizationsService needs from the database, as an
 * interface — see accounting-posting-engine.ts's header comment for why
 * (no generated Prisma client available in this sandbox). All of it must
 * happen in one transaction: an organization must never exist without an
 * Owner able to log into it.
 */
export interface OrganizationsRepository {
  vatNumberExists(vatNumber: string): Promise<boolean>;
  createOrganizationWithOwner(input: {
    organization: Pick<CreateOrganizationInput, "legalNameAr" | "legalNameEn" | "commercialName" | "vatNumber" | "crNumber">;
    seededRoleNames: readonly string[];
    ownerRoleName: string;
    owner: { email: string; fullName: string; passwordHash: string };
  }): Promise<CreateOrganizationResult>;
  findById(organizationId: string): Promise<OrganizationRow | null>;
  updateSettings(organizationId: string, settings: Partial<Pick<OrganizationRow, "requireShiftForPosSale">>): Promise<OrganizationRow>;
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly repo: OrganizationsRepository) {}

  async createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult> {
    if (input.vatNumber) {
      const exists = await this.repo.vatNumberExists(input.vatNumber);
      if (exists) {
        throw new ConflictException(
          `An organization with VAT number ${input.vatNumber} already exists`,
        );
      }
    }

    const passwordHash = await AuthService.hashPassword(input.ownerPassword);

    return this.repo.createOrganizationWithOwner({
      organization: {
        legalNameAr: input.legalNameAr,
        legalNameEn: input.legalNameEn,
        commercialName: input.commercialName,
        vatNumber: input.vatNumber,
        crNumber: input.crNumber,
      },
      seededRoleNames: DEFAULT_SEEDED_ROLES,
      ownerRoleName: "Owner",
      owner: {
        email: input.ownerEmail,
        fullName: input.ownerFullName,
        passwordHash,
      },
    });
  }

  async getOrganization(organizationId: string): Promise<OrganizationRow | null> {
    return this.repo.findById(organizationId);
  }

  /**
   * Sprint 29 — resolves the product decision left open since Sprint 12
   * ("should a shift be mandatory for every POS sale?") as a per-
   * organization setting rather than a single hardcoded answer, since
   * different businesses legitimately want different defaults (a single
   * fixed retail counter vs. a market with roaming tablet sales). Default
   * is `false` (unchanged Phase 0 behavior — shift stays opt-in) so this
   * is purely additive: nothing that worked before now behaves
   * differently unless an organization explicitly opts in.
   */
  async updateSettings(
    organizationId: string,
    settings: Partial<Pick<OrganizationRow, "requireShiftForPosSale">>,
  ): Promise<OrganizationRow> {
    const org = await this.repo.findById(organizationId);
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }
    return this.repo.updateSettings(organizationId, settings);
  }
}
