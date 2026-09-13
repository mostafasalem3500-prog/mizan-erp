import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

export type AccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "REVENUE"
  | "COST_OF_SALES"
  | "EXPENSE"
  | "OTHER_INCOME"
  | "OTHER_EXPENSE";

export interface CreateAccountInput {
  organizationId: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  type: AccountType;
  parentCode?: string;
  isPostable?: boolean;
}

export interface AccountRow {
  id: string;
  organizationId: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  type: AccountType;
  parentId?: string;
  isPostable: boolean;
  isActive: boolean;
}

export interface AccountsRepository {
  create(input: Omit<CreateAccountInput, "parentCode"> & { parentId?: string }): Promise<AccountRow>;
  findByCode(organizationId: string, code: string): Promise<AccountRow | null>;
  findById(organizationId: string, accountId: string): Promise<AccountRow | null>;
  listForOrganization(organizationId: string): Promise<AccountRow[]>;
}

/**
 * The base seed set from spec band 20's Retail example, expressed as data
 * (not code branches) so it is exactly what band 20 asks for: "Seed +
 * Configurable" rather than accounts baked into application logic. Any
 * module (Sales, Purchases, Inventory, POS) that needs "the AR account"
 * now resolves it by CODE through AccountsService — see
 * infra/in-memory-repositories.ts's GL mapping classes — instead of
 * carrying its own hardcoded account-id string.
 */
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
  { code: "3200", nameAr: "الأرباح المبقاة", nameEn: "Retained Earnings", type: "EQUITY", parentCode: "3000", isPostable: true },
  { code: "4000", nameAr: "الإيرادات", nameEn: "Revenue", type: "REVENUE", isPostable: false },
  { code: "4100", nameAr: "المبيعات", nameEn: "Sales", type: "REVENUE", parentCode: "4000", isPostable: true },
  { code: "4200", nameAr: "مردودات المبيعات", nameEn: "Sales Returns", type: "REVENUE", parentCode: "4000", isPostable: true },
  { code: "5000", nameAr: "تكلفة المبيعات", nameEn: "Cost of Sales", type: "COST_OF_SALES", isPostable: false },
  { code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: "COGS", type: "COST_OF_SALES", parentCode: "5000", isPostable: true },
  { code: "6000", nameAr: "المصروفات التشغيلية", nameEn: "Operating Expenses", type: "EXPENSE", isPostable: false },
  { code: "6100", nameAr: "مصروفات عامة", nameEn: "General Expense", type: "EXPENSE", parentCode: "6000", isPostable: true },
  { code: "6200", nameAr: "مصروف الإهلاك", nameEn: "Depreciation Expense", type: "EXPENSE", parentCode: "6000", isPostable: true },
];

@Injectable()
export class AccountsService {
  constructor(private readonly repo: AccountsRepository) {}

  async createAccount(input: CreateAccountInput): Promise<AccountRow> {
    const existing = await this.repo.findByCode(input.organizationId, input.code);
    if (existing) {
      throw new ConflictException(`Account code "${input.code}" already exists for this organization`);
    }

    let parentId: string | undefined;
    if (input.parentCode) {
      const parent = await this.repo.findByCode(input.organizationId, input.parentCode);
      if (!parent) {
        throw new NotFoundException(`Parent account code "${input.parentCode}" not found`);
      }
      parentId = parent.id;
    }

    return this.repo.create({
      organizationId: input.organizationId,
      code: input.code,
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      type: input.type,
      parentId,
      isPostable: input.isPostable ?? true,
    });
  }

  async getAccountByCode(organizationId: string, code: string): Promise<AccountRow | null> {
    return this.repo.findByCode(organizationId, code);
  }

  /** Convenience for callers (GL mapping resolvers) that need an id and treat "not found" as a setup error, not a normal null case. */
  async getAccountIdByCode(organizationId: string, code: string): Promise<string> {
    const account = await this.repo.findByCode(organizationId, code);
    if (!account) {
      throw new NotFoundException(
        `Chart of Accounts is missing required account code "${code}" for organization ${organizationId} — has the default COA been seeded?`,
      );
    }
    return account.id;
  }

  async getAccountById(organizationId: string, accountId: string): Promise<AccountRow | null> {
    return this.repo.findById(organizationId, accountId);
  }

  async listAccounts(organizationId: string): Promise<AccountRow[]> {
    return this.repo.listForOrganization(organizationId);
  }

  /** Creates the full default COA (parents before children, since children reference parents by code). */
  async seedDefaultChartOfAccounts(organizationId: string): Promise<Record<string, string>> {
    const codeToId: Record<string, string> = {};
    for (const def of DEFAULT_COA) {
      const account = await this.createAccount({
        organizationId,
        code: def.code,
        nameAr: def.nameAr,
        nameEn: def.nameEn,
        type: def.type,
        parentCode: def.parentCode,
        isPostable: def.isPostable,
      });
      codeToId[def.code] = account.id;
    }
    return codeToId;
  }
}
