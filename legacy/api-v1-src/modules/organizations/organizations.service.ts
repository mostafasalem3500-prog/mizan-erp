import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
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

export type ReceiptTemplate = "thermal" | "a4" | "simple";

export interface InvoiceTemplateConfig {
  accentColor: string;
  secondaryColor: string;
  documentTitle: string;
  logoUrl?: string;
  fontFamily: "plex" | "cairo" | "system";
  headerAlignment: "right" | "center";
  tableStyle: "lines" | "striped" | "minimal";
  qrPosition: "center" | "left";
  showCommercialName: boolean;
  showCrNumber: boolean;
  showSellerAddress: boolean;
  showSellerContact: boolean;
  showCustomerDetails: boolean;
  showPaymentSummary: boolean;
  showQr: boolean;
  compactLines: boolean;
}

export const DEFAULT_INVOICE_TEMPLATE_CONFIG: InvoiceTemplateConfig = {
  accentColor: "#073f3e",
  secondaryColor: "#c89b3c",
  documentTitle: "فاتورة ضريبية مبسطة",
  fontFamily: "plex",
  headerAlignment: "center",
  tableStyle: "lines",
  qrPosition: "center",
  showCommercialName: true,
  showCrNumber: true,
  showSellerAddress: true,
  showSellerContact: true,
  showCustomerDetails: true,
  showPaymentSummary: true,
  showQr: true,
  compactLines: false,
};

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
  commercialName?: string;
  phone?: string;
  email?: string;
  invoiceFooter?: string;
  defaultReceiptTemplate?: ReceiptTemplate;
  invoiceTemplateConfig?: InvoiceTemplateConfig;
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
  updateSettings(organizationId: string, settings: Partial<Omit<OrganizationRow, "id">>): Promise<OrganizationRow>;
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
    settings: Partial<Omit<OrganizationRow, "id">>,
  ): Promise<OrganizationRow> {
    const org = await this.repo.findById(organizationId);
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }
    if (settings.vatNumber && !/^3\d{13}3$/.test(settings.vatNumber)) {
      throw new BadRequestException("VAT number must contain 15 digits and start and end with 3");
    }
    if (settings.buildingNumber && !/^\d{4}$/.test(settings.buildingNumber)) {
      throw new BadRequestException("National address building number must contain 4 digits");
    }
    if (settings.postalZone && !/^\d{5}$/.test(settings.postalZone)) {
      throw new BadRequestException("National address postal code must contain 5 digits");
    }
    if (settings.countryCode && !/^[A-Z]{2}$/.test(settings.countryCode)) {
      throw new BadRequestException("Country code must use two uppercase ISO letters");
    }
    if (settings.defaultReceiptTemplate && !["thermal", "a4", "simple"].includes(settings.defaultReceiptTemplate)) {
      throw new BadRequestException("Unsupported receipt template");
    }
    if (settings.invoiceTemplateConfig) {
      settings.invoiceTemplateConfig = validateInvoiceTemplateConfig(settings.invoiceTemplateConfig);
    }
    return this.repo.updateSettings(organizationId, settings);
  }
}

function validateInvoiceTemplateConfig(input: InvoiceTemplateConfig): InvoiceTemplateConfig {
  const config = { ...DEFAULT_INVOICE_TEMPLATE_CONFIG, ...input };
  if (!/^#[0-9A-Fa-f]{6}$/.test(config.accentColor)) {
    throw new BadRequestException("Invoice accent color must be a six-digit hex color");
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(config.secondaryColor)) {
    throw new BadRequestException("Invoice secondary color must be a six-digit hex color");
  }
  config.documentTitle = String(config.documentTitle ?? "").trim();
  if (!config.documentTitle || config.documentTitle.length > 80) {
    throw new BadRequestException("Invoice document title must contain 1 to 80 characters");
  }
  if (config.logoUrl) {
    config.logoUrl = String(config.logoUrl).trim();
    if (config.logoUrl.length > 500 || !/^(https?:\/\/|\/)/.test(config.logoUrl)) {
      throw new BadRequestException("Invoice logo must be a valid HTTPS/HTTP or site-relative URL");
    }
  }
  if (!["plex", "cairo", "system"].includes(config.fontFamily)) throw new BadRequestException("Unsupported invoice font");
  if (!["right", "center"].includes(config.headerAlignment)) throw new BadRequestException("Unsupported invoice header alignment");
  if (!["lines", "striped", "minimal"].includes(config.tableStyle)) throw new BadRequestException("Unsupported invoice table style");
  if (!["center", "left"].includes(config.qrPosition)) throw new BadRequestException("Unsupported invoice QR position");
  for (const key of ["showCommercialName", "showCrNumber", "showSellerAddress", "showSellerContact", "showCustomerDetails", "showPaymentSummary", "showQr", "compactLines"] as const) {
    if (typeof config[key] !== "boolean") throw new BadRequestException(`Invoice template option ${key} must be boolean`);
  }
  return config;
}
