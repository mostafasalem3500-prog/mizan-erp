/**
 * In-memory implementation of every Repository interface defined across
 * the modules. This exists for exactly one purpose: to let main.ts boot a
 * real, running NestJS server and exercise the full request pipeline
 * (Auth -> Organizations -> Accounting -> ZATCA QR) end-to-end in this
 * sandboxed session, where `prisma generate` cannot reach the network to
 * download its query-engine binary (see README.md).
 *
 * This is NOT a second implementation to maintain going forward — when a
 * real Postgres connection is available, delete this file and implement
 * the same interfaces against Prisma. Every interface here is defined in
 * its owning module (auth.service.ts, organizations.service.ts,
 * accounting-posting-engine.ts, accounting-query.service.ts,
 * permissions.guard.ts) — this file only supplies bodies for them.
 */

import { randomUUID } from "crypto";
import type { AuthUserLookup, UserCredentialsRow, OrganizationMembershipRow } from "../modules/auth/auth.service";
import type { OrganizationsRepository, CreateOrganizationResult, OrganizationRow } from "../modules/organizations/organizations.service";
import type { BranchesRepository, BranchRow, CreateBranchInput } from "../modules/branches/branches.service";
import type { CustomersRepository, CustomerRow, CreateCustomerInput } from "../modules/customers/customers.service";
import type { SalesRepository, SalesGLAccountMapping, SalesInvoiceRecord } from "../modules/sales/sales.service";
import type { ProductsRepository, ProductRow, CreateProductInput } from "../modules/inventory/products.service";
import type { InventoryRepository, InventoryGLAccountMapping, StockLevel } from "../modules/inventory/inventory.service";
import type { SuppliersRepository, SupplierRow, CreateSupplierInput } from "../modules/suppliers/suppliers.service";
import type { PurchasesRepository, PurchasesGLAccountMapping, PurchaseBillRecord } from "../modules/purchases/purchases.service";
import type { PosRepository, PosGLAccountMapping, PosSaleRecord } from "../modules/pos/pos.service";
import type { ShiftsRepository, ShiftRecord } from "../modules/pos/shifts.service";
import type { ExpensesRepository, ExpenseRecord } from "../modules/expenses/expenses.service";
import type { AssetsRepository, AssetRecord } from "../modules/assets/assets.service";
import type { PaymentsRepository, PaymentRecord } from "../modules/payments/payments.service";
import type { AccountTypeLookup, AccountType, GeneralLedgerRepository, LedgerLineRow } from "../modules/reporting/reporting.service";
import type { AccountsRepository, AccountRow } from "../modules/accounts/accounts.service";
import type { PeriodsRepository, PeriodRow, CreatePeriodInput } from "../modules/periods/periods.service";
import { AccountsService } from "../modules/accounts/accounts.service";
import type { RolePermissionLookup } from "../modules/common/permissions.guard";
import type { AccountingQueryRepository, TrialBalanceLine } from "../modules/accounting/accounting-query.service";
import type {
  PrismaClientLike,
  JournalSourceEvent,
} from "../modules/accounting/accounting-posting-engine";

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  isActive: boolean;
}

interface StoredOrgUser {
  organizationId: string;
  userId: string;
  roleId: string;
  branchId?: string;
}

interface StoredRole {
  id: string;
  organizationId: string;
  name: string;
  permissionCodes: string[];
}

interface StoredOrganization {
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

interface StoredBranch {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  address?: string;
  isActive: boolean;
}

interface StoredPeriod {
  id: string;
  organizationId: string;
  status: "OPEN" | "SOFT_CLOSED" | "CLOSED" | "LOCKED";
  startDate: string;
  endDate: string;
}

interface StoredLine {
  accountId: string;
  debit: string;
  credit: string;
  costCenterId?: string;
  description?: string;
}

interface StoredJournalEntry {
  id: string;
  organizationId: string;
  branchId?: string;
  periodId: string;
  sourceEvent: JournalSourceEvent;
  sourceDocId?: string;
  reference?: string;
  isReversal: boolean;
  reversedById?: string;
  lines: StoredLine[];
}

/** Every permission a seeded "Owner" role holds — full access, per spec band 101. */
const OWNER_PERMISSIONS = [
  "invoice.view", "invoice.create", "invoice.approve", "invoice.post", "invoice.credit", "invoice.print",
  "invoice_template.view", "invoice_template.edit", "invoice_template.publish",
  "journal.create", "journal.post", "journal.reverse",
  "pos.sell", "pos.return", "pos.discount", "pos.overrideDiscount", "pos.changePrice", "pos.cashIn", "pos.cashOut",
  "bank.reconcile", "reports.pnl.view", "zatca.view", "zatca.manage", "users.manage", "settings.manage",
];

export class InMemoryDatabase {
  users = new Map<string, StoredUser>();
  orgUsers: StoredOrgUser[] = [];
  roles = new Map<string, StoredRole>();
  organizations = new Map<string, StoredOrganization>();
  periods = new Map<string, StoredPeriod>();
  journalEntries = new Map<string, StoredJournalEntry>();
  idempotencyKeys = new Map<string, { journalEntryId: string }>(); // key: `${organizationId}:${key}`
  branches = new Map<string, StoredBranch>();
  customers = new Map<string, CustomerRow>();
  salesInvoices = new Map<string, SalesInvoiceRecord>();
  products = new Map<string, ProductRow>();
  stockLevels = new Map<string, StockLevel>(); // key: `${organizationId}:${productId}`
  suppliers = new Map<string, SupplierRow>();
  purchaseBills = new Map<string, PurchaseBillRecord>();
  posSales = new Map<string, PosSaleRecord>();
  shifts = new Map<string, ShiftRecord>();
  accounts = new Map<string, AccountRow>();
  expenses = new Map<string, ExpenseRecord>();
  assets = new Map<string, AssetRecord>();
  payments = new Map<string, PaymentRecord>();

  /** Seeds one demo organization with an Owner user, ready to log in and post immediately. */
  seedDemoOrganization(ownerEmail: string, ownerPasswordHash: string) {
    const organizationId = randomUUID();
    const roleId = randomUUID();
    const userId = randomUUID();
    const periodId = randomUUID();

    this.organizations.set(organizationId, {
      id: organizationId,
      legalNameAr: "مؤسسة الأفق للتجارة",
      legalNameEn: "Al-Ufuq Trading Est.",
      vatNumber: "300000000000003",
      crNumber: "1010010000",
      streetName: "King Fahd Road",
      buildingNumber: "1234",
      city: "Riyadh",
      postalZone: "12345",
      district: "Al Olaya",
      countryCode: "SA",
    });
    this.roles.set(roleId, {
      id: roleId,
      organizationId,
      name: "Owner",
      permissionCodes: OWNER_PERMISSIONS,
    });
    this.users.set(userId, {
      id: userId,
      email: ownerEmail,
      passwordHash: ownerPasswordHash,
      fullName: "Demo Owner",
      isActive: true,
    });
    this.orgUsers.push({ organizationId, userId, roleId });
    const now = new Date();
    const yearFromNow = new Date(now);
    yearFromNow.setFullYear(yearFromNow.getFullYear() + 1);
    this.periods.set(periodId, {
      id: periodId,
      organizationId,
      status: "OPEN",
      startDate: now.toISOString(),
      endDate: yearFromNow.toISOString(),
    });

    return { organizationId, roleId, userId, periodId };
  }
}

export class InMemoryAuthUserLookup implements AuthUserLookup {
  constructor(private readonly db: InMemoryDatabase) {}

  async findCredentialsByEmail(email: string): Promise<UserCredentialsRow | null> {
    const user = [...this.db.users.values()].find((u) => u.email === email);
    if (!user) return null;
    return { userId: user.id, passwordHash: user.passwordHash, isActive: user.isActive };
  }

  async findMembership(userId: string, organizationId: string): Promise<OrganizationMembershipRow | null> {
    const membership = this.db.orgUsers.find(
      (m) => m.userId === userId && m.organizationId === organizationId,
    );
    if (!membership) return null;
    return { organizationId: membership.organizationId, roleId: membership.roleId, branchId: membership.branchId };
  }
}

export class InMemoryRolePermissionLookup implements RolePermissionLookup {
  constructor(private readonly db: InMemoryDatabase) {}

  async getPermissionCodesForRole(roleId: string): Promise<string[]> {
    return this.db.roles.get(roleId)?.permissionCodes ?? [];
  }
}

export class InMemoryOrganizationsRepository implements OrganizationsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async vatNumberExists(vatNumber: string): Promise<boolean> {
    return [...this.db.organizations.values()].some((o) => o.vatNumber === vatNumber);
  }

  async createOrganizationWithOwner(input: {
    organization: { legalNameAr: string; legalNameEn?: string; vatNumber?: string; crNumber?: string };
    seededRoleNames: readonly string[];
    ownerRoleName: string;
    owner: { email: string; fullName: string; passwordHash: string };
  }): Promise<CreateOrganizationResult> {
    const organizationId = randomUUID();
    this.db.organizations.set(organizationId, {
      id: organizationId,
      legalNameAr: input.organization.legalNameAr,
      legalNameEn: input.organization.legalNameEn,
      vatNumber: input.organization.vatNumber,
      crNumber: input.organization.crNumber,
    });

    let ownerRoleId = "";
    for (const roleName of input.seededRoleNames) {
      const roleId = randomUUID();
      this.db.roles.set(roleId, {
        id: roleId,
        organizationId,
        name: roleName,
        permissionCodes: roleName === input.ownerRoleName ? OWNER_PERMISSIONS : [],
      });
      if (roleName === input.ownerRoleName) ownerRoleId = roleId;
    }

    const userId = randomUUID();
    this.db.users.set(userId, {
      id: userId,
      email: input.owner.email,
      passwordHash: input.owner.passwordHash,
      fullName: input.owner.fullName,
      isActive: true,
    });
    this.db.orgUsers.push({ organizationId, userId, roleId: ownerRoleId });

    return { organizationId, ownerUserId: userId, ownerRoleId };
  }

  async findById(organizationId: string): Promise<OrganizationRow | null> {
    const row = this.db.organizations.get(organizationId);
    return row ? { ...row } : null;
  }

  async updateSettings(
    organizationId: string,
    settings: Partial<Pick<OrganizationRow, "requireShiftForPosSale">>,
  ): Promise<OrganizationRow> {
    const existing = this.db.organizations.get(organizationId);
    if (!existing) {
      throw new Error(`Organization ${organizationId} not found`); // guarded by the service layer already; this is a defensive fallback
    }
    const updated = { ...existing, ...settings };
    this.db.organizations.set(organizationId, updated);
    return { ...updated };
  }
}

export class InMemoryBranchesRepository implements BranchesRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async codeExistsForOrganization(organizationId: string, code: string): Promise<boolean> {
    return [...this.db.branches.values()].some(
      (b) => b.organizationId === organizationId && b.code === code,
    );
  }

  async create(input: CreateBranchInput): Promise<BranchRow> {
    const id = randomUUID();
    const branch: StoredBranch = {
      id,
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      address: input.address,
      isActive: true,
    };
    this.db.branches.set(id, branch);
    return { ...branch };
  }

  async listForOrganization(organizationId: string): Promise<BranchRow[]> {
    return [...this.db.branches.values()].filter((b) => b.organizationId === organizationId);
  }
}

export class InMemoryAccountingQueryRepository implements AccountingQueryRepository {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly accountsService: AccountsService,
  ) {}

  async getTrialBalanceForPeriod(organizationId: string, periodId: string): Promise<TrialBalanceLine[]> {
    const totals = new Map<string, { debit: bigint; credit: bigint }>();

    for (const entry of this.db.journalEntries.values()) {
      if (entry.organizationId !== organizationId || entry.periodId !== periodId) continue;
      for (const line of entry.lines) {
        const current = totals.get(line.accountId) ?? { debit: 0n, credit: 0n };
        current.debit += toCents(line.debit);
        current.credit += toCents(line.credit);
        totals.set(line.accountId, current);
      }
    }

    const lines: TrialBalanceLine[] = [];
    for (const [accountId, sums] of totals.entries()) {
      // Resolve the real code/name from the Chart of Accounts (Sprint 11
      // fix — this previously fell back to the raw accountId UUID for
      // both fields, which was correct but unreadable).
      const account = await this.accountsService.getAccountById(organizationId, accountId);
      lines.push({
        accountId,
        accountCode: account?.code ?? accountId,
        accountName: account?.nameEn ?? account?.nameAr ?? accountId,
        totalDebit: fromCents(sums.debit),
        totalCredit: fromCents(sums.credit),
      });
    }
    return lines;
  }
}

/** Implements PrismaClientLike (the subset AccountingPostingEngine needs) over the in-memory store. */
export class InMemoryPrismaClient implements PrismaClientLike {
  constructor(private readonly db: InMemoryDatabase) {}

  async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    // No real rollback semantics here (it's a demo store) — a genuine
    // Postgres transaction is what actually enforces atomicity in
    // production; this in-memory version exists only to exercise the
    // request pipeline end-to-end.
    const tx = {
      accountingPeriod: {
        findUniqueOrThrow: async ({ where }: any) => {
          const period = this.db.periods.get(where.id);
          if (!period) throw new Error(`Accounting period ${where.id} not found`);
          return period;
        },
      },
      idempotencyKey: {
        find: async ({ organizationId, key }: { organizationId: string; key: string }) => {
          return this.db.idempotencyKeys.get(`${organizationId}:${key}`) ?? null;
        },
        create: async ({
          organizationId,
          key,
          journalEntryId,
        }: {
          organizationId: string;
          key: string;
          journalEntryId: string;
        }) => {
          this.db.idempotencyKeys.set(`${organizationId}:${key}`, { journalEntryId });
        },
      },
      journalEntry: {
        create: async ({ data }: any) => {
          const id = randomUUID();
          const entry: StoredJournalEntry = {
            id,
            organizationId: data.organizationId,
            branchId: data.branchId,
            periodId: data.periodId,
            sourceEvent: data.sourceEvent,
            sourceDocId: data.sourceDocId,
            reference: data.reference,
            isReversal: data.isReversal ?? false,
            lines: (data.lines?.create ?? []).map((l: any) => ({
              accountId: l.accountId,
              debit: l.debit?.toString?.() ?? String(l.debit ?? "0"),
              credit: l.credit?.toString?.() ?? String(l.credit ?? "0"),
              costCenterId: l.costCenterId,
              description: l.description,
            })),
          };
          this.db.journalEntries.set(id, entry);
          return { ...entry };
        },
        findUniqueOrThrow: async ({ where }: any) => {
          const entry = this.db.journalEntries.get(where.id);
          if (!entry) throw new Error(`Journal entry ${where.id} not found`);
          return { ...entry };
        },
        update: async ({ where, data }: any) => {
          const entry = this.db.journalEntries.get(where.id);
          if (!entry) throw new Error(`Journal entry ${where.id} not found`);
          Object.assign(entry, data);
          return { ...entry };
        },
      },
    };

    return fn(tx);
  }
}

export class InMemoryCustomersRepository implements CustomersRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async create(input: CreateCustomerInput): Promise<CustomerRow> {
    const id = randomUUID();
    const row: CustomerRow = { id, ...input };
    this.db.customers.set(id, row);
    return { ...row };
  }

  async findById(organizationId: string, customerId: string): Promise<CustomerRow | null> {
    const row = this.db.customers.get(customerId);
    return row && row.organizationId === organizationId ? { ...row } : null;
  }

  async listForOrganization(organizationId: string): Promise<CustomerRow[]> {
    return [...this.db.customers.values()].filter((c) => c.organizationId === organizationId);
  }
}

export class InMemorySalesRepository implements SalesRepository {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly accountsService: AccountsService,
  ) {}

  /** Resolved from the real seeded Chart of Accounts by code — see accounts.service.ts's DEFAULT_COA (spec band 20). */
  async getGLAccountMapping(organizationId: string): Promise<SalesGLAccountMapping> {
    return {
      accountsReceivableAccountId: await this.accountsService.getAccountIdByCode(organizationId, "1200"),
      salesRevenueAccountId: await this.accountsService.getAccountIdByCode(organizationId, "4100"),
      vatOutputAccountId: await this.accountsService.getAccountIdByCode(organizationId, "2200"),
    };
  }

  async saveInvoice(record: SalesInvoiceRecord): Promise<SalesInvoiceRecord> {
    this.db.salesInvoices.set(record.id, record);
    return { ...record };
  }

  async findInvoice(organizationId: string, invoiceId: string): Promise<SalesInvoiceRecord | null> {
    const record = this.db.salesInvoices.get(invoiceId);
    return record && record.organizationId === organizationId ? { ...record } : null;
  }

  async listInvoicesForCustomer(organizationId: string, customerId: string): Promise<SalesInvoiceRecord[]> {
    return [...this.db.salesInvoices.values()].filter((r) => r.organizationId === organizationId && r.customerId === customerId);
  }

  async listAllInvoices(organizationId: string): Promise<SalesInvoiceRecord[]> {
    return [...this.db.salesInvoices.values()].filter((r) => r.organizationId === organizationId);
  }
}

export class InMemoryProductsRepository implements ProductsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async create(input: CreateProductInput): Promise<ProductRow> {
    const id = randomUUID();
    const row: ProductRow = { id, ...input };
    this.db.products.set(id, row);
    return { ...row };
  }

  async findById(organizationId: string, productId: string): Promise<ProductRow | null> {
    const row = this.db.products.get(productId);
    return row && row.organizationId === organizationId ? { ...row } : null;
  }

  async listForOrganization(organizationId: string): Promise<ProductRow[]> {
    return [...this.db.products.values()].filter((p) => p.organizationId === organizationId);
  }
}

export class InMemoryInventoryRepository implements InventoryRepository {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly accountsService: AccountsService,
  ) {}

  async getGLAccountMapping(organizationId: string): Promise<InventoryGLAccountMapping> {
    return {
      inventoryAccountId: await this.accountsService.getAccountIdByCode(organizationId, "1300"),
      cogsAccountId: await this.accountsService.getAccountIdByCode(organizationId, "5100"),
      openingBalanceEquityAccountId: await this.accountsService.getAccountIdByCode(organizationId, "3100"),
    };
  }

  async getStockLevel(organizationId: string, productId: string): Promise<StockLevel | null> {
    const level = this.db.stockLevels.get(`${organizationId}:${productId}`);
    return level ? { ...level } : null;
  }

  async saveStockLevel(level: StockLevel): Promise<void> {
    this.db.stockLevels.set(`${level.organizationId}:${level.productId}`, { ...level });
  }
}

export class InMemorySuppliersRepository implements SuppliersRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async create(input: CreateSupplierInput): Promise<SupplierRow> {
    const id = randomUUID();
    const row: SupplierRow = { id, ...input };
    this.db.suppliers.set(id, row);
    return { ...row };
  }

  async findById(organizationId: string, supplierId: string): Promise<SupplierRow | null> {
    const row = this.db.suppliers.get(supplierId);
    return row && row.organizationId === organizationId ? { ...row } : null;
  }

  async listForOrganization(organizationId: string): Promise<SupplierRow[]> {
    return [...this.db.suppliers.values()].filter((s) => s.organizationId === organizationId);
  }
}

export class InMemoryPurchasesRepository implements PurchasesRepository {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly accountsService: AccountsService,
  ) {}

  async getGLAccountMapping(organizationId: string): Promise<PurchasesGLAccountMapping> {
    return {
      inventoryAccountId: await this.accountsService.getAccountIdByCode(organizationId, "1300"),
      vatInputAccountId: await this.accountsService.getAccountIdByCode(organizationId, "1400"),
      accountsPayableAccountId: await this.accountsService.getAccountIdByCode(organizationId, "2100"),
      generalExpenseAccountId: await this.accountsService.getAccountIdByCode(organizationId, "6100"),
    };
  }

  async saveBill(record: PurchaseBillRecord): Promise<PurchaseBillRecord> {
    this.db.purchaseBills.set(record.id, record);
    return { ...record };
  }

  async findBill(organizationId: string, billId: string): Promise<PurchaseBillRecord | null> {
    const record = this.db.purchaseBills.get(billId);
    return record && record.organizationId === organizationId ? { ...record } : null;
  }

  async listBillsForSupplier(organizationId: string, supplierId: string): Promise<PurchaseBillRecord[]> {
    return [...this.db.purchaseBills.values()].filter((r) => r.organizationId === organizationId && r.supplierId === supplierId);
  }

  async listAllBills(organizationId: string): Promise<PurchaseBillRecord[]> {
    return [...this.db.purchaseBills.values()].filter((r) => r.organizationId === organizationId);
  }
}

export class InMemoryPosRepository implements PosRepository {
  constructor(
    private readonly db: InMemoryDatabase,
    private readonly accountsService: AccountsService,
  ) {}

  async getGLAccountMapping(organizationId: string): Promise<PosGLAccountMapping> {
    return {
      cashAccountId: await this.accountsService.getAccountIdByCode(organizationId, "1100"),
      cardClearingAccountId: await this.accountsService.getAccountIdByCode(organizationId, "1120"),
      salesRevenueAccountId: await this.accountsService.getAccountIdByCode(organizationId, "4100"),
      vatOutputAccountId: await this.accountsService.getAccountIdByCode(organizationId, "2200"),
      salesReturnsAccountId: await this.accountsService.getAccountIdByCode(organizationId, "4200"),
      inventoryAccountId: await this.accountsService.getAccountIdByCode(organizationId, "1300"),
      cogsAccountId: await this.accountsService.getAccountIdByCode(organizationId, "5100"),
    };
  }

  async saveSale(record: PosSaleRecord): Promise<PosSaleRecord> {
    this.db.posSales.set(record.id, record);
    return { ...record };
  }

  async findSale(organizationId: string, saleId: string): Promise<PosSaleRecord | null> {
    const record = this.db.posSales.get(saleId);
    return record && record.organizationId === organizationId ? { ...record } : null;
  }
}

export class InMemoryPeriodsRepository implements PeriodsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async listForOrganization(organizationId: string): Promise<PeriodRow[]> {
    return [...this.db.periods.values()]
      .filter((p) => p.organizationId === organizationId)
      .map((p) => ({ id: p.id, organizationId: p.organizationId, status: p.status, startDate: p.startDate, endDate: p.endDate }));
  }

  async create(input: CreatePeriodInput): Promise<PeriodRow> {
    const id = randomUUID();
    const row = { id, organizationId: input.organizationId, status: "OPEN" as const, startDate: input.startDate, endDate: input.endDate };
    this.db.periods.set(id, row);
    return { ...row };
  }
}

export class InMemoryAccountsRepository implements AccountsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async create(input: any): Promise<AccountRow> {
    const id = randomUUID();
    const row: AccountRow = { id, isActive: true, ...input };
    this.db.accounts.set(id, row);
    return { ...row };
  }

  async findByCode(organizationId: string, code: string): Promise<AccountRow | null> {
    const row = [...this.db.accounts.values()].find((a) => a.organizationId === organizationId && a.code === code);
    return row ? { ...row } : null;
  }

  async findById(organizationId: string, accountId: string): Promise<AccountRow | null> {
    const row = this.db.accounts.get(accountId);
    return row && row.organizationId === organizationId ? { ...row } : null;
  }

  async listForOrganization(organizationId: string): Promise<AccountRow[]> {
    return [...this.db.accounts.values()].filter((a) => a.organizationId === organizationId);
  }
}

export class InMemoryShiftsRepository implements ShiftsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async create(record: Omit<ShiftRecord, "id">): Promise<ShiftRecord> {
    const id = randomUUID();
    const full: ShiftRecord = { id, ...record };
    this.db.shifts.set(id, full);
    return { ...full };
  }

  async findById(organizationId: string, shiftId: string): Promise<ShiftRecord | null> {
    const s = this.db.shifts.get(shiftId);
    return s && s.organizationId === organizationId ? { ...s } : null;
  }

  async findOpenShiftForTerminal(organizationId: string, terminalId: string): Promise<ShiftRecord | null> {
    const s = [...this.db.shifts.values()].find(
      (x) => x.organizationId === organizationId && x.terminalId === terminalId && x.status === "OPEN",
    );
    return s ? { ...s } : null;
  }

  async update(shiftId: string, patch: Partial<ShiftRecord>): Promise<ShiftRecord> {
    const s = this.db.shifts.get(shiftId);
    if (!s) throw new Error(`Shift ${shiftId} not found`);
    Object.assign(s, patch);
    return { ...s };
  }
}

/**
 * Conventional GL account-id -> type map — REMOVED (Sprint 10). Account
 * types are now resolved from real Chart-of-Accounts records via
 * AccountsService; see InMemoryAccountTypeLookup below.
 */

export class InMemoryAccountTypeLookup implements AccountTypeLookup {
  constructor(private readonly accountsService: AccountsService) {}

  async getAccountType(organizationId: string, accountId: string): Promise<AccountType | null> {
    const account = await this.accountsService.getAccountById(organizationId, accountId);
    return (account?.type as AccountType) ?? null;
  }
}

export class InMemoryGeneralLedgerRepository implements GeneralLedgerRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async getLedgerLines(organizationId: string, periodId: string, accountId: string): Promise<LedgerLineRow[]> {
    const result: LedgerLineRow[] = [];
    for (const entry of this.db.journalEntries.values()) {
      if (entry.organizationId !== organizationId || entry.periodId !== periodId) continue;
      for (const line of entry.lines) {
        if (line.accountId !== accountId) continue;
        result.push({
          journalEntryId: entry.id,
          sourceEvent: entry.sourceEvent,
          reference: entry.reference ?? undefined,
          debit: line.debit,
          credit: line.credit,
        });
      }
    }
    return result;
  }
}

export class InMemoryExpensesRepository implements ExpensesRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async save(record: ExpenseRecord): Promise<ExpenseRecord> {
    this.db.expenses.set(record.id, record);
    return { ...record };
  }

  async findById(organizationId: string, expenseId: string): Promise<ExpenseRecord | null> {
    const r = this.db.expenses.get(expenseId);
    return r && r.organizationId === organizationId ? { ...r } : null;
  }
}

export class InMemoryAssetsRepository implements AssetsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async save(record: AssetRecord): Promise<AssetRecord> {
    this.db.assets.set(record.id, record);
    return { ...record };
  }

  async findById(organizationId: string, assetId: string): Promise<AssetRecord | null> {
    const r = this.db.assets.get(assetId);
    return r && r.organizationId === organizationId ? { ...r } : null;
  }
}

export class InMemoryPaymentsRepository implements PaymentsRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  async save(record: PaymentRecord): Promise<PaymentRecord> {
    this.db.payments.set(record.id, record);
    return { ...record };
  }

  async listForCustomer(organizationId: string, customerId: string): Promise<PaymentRecord[]> {
    return [...this.db.payments.values()].filter((p) => p.organizationId === organizationId && p.type === "CUSTOMER" && p.partyId === customerId);
  }

  async listForSupplier(organizationId: string, supplierId: string): Promise<PaymentRecord[]> {
    return [...this.db.payments.values()].filter((p) => p.organizationId === organizationId && p.type === "SUPPLIER" && p.partyId === supplierId);
  }
}

function toCents(decimalStr: string): bigint {
  const [whole, frac = ""] = decimalStr.split(".");
  const paddedFrac = (frac + "0000").slice(0, 4);
  const sign = whole.startsWith("-") ? -1n : 1n;
  const wholeAbs = whole.replace("-", "") || "0";
  return sign * (BigInt(wholeAbs) * 10000n + BigInt(paddedFrac));
}

function fromCents(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10000n;
  const frac = (abs % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
