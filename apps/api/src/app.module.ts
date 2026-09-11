import { Module } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";

import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { OrganizationsController } from "./modules/organizations/organizations.controller";
import { OrganizationsService } from "./modules/organizations/organizations.service";
import { BranchesController } from "./modules/branches/branches.controller";
import { BranchesService } from "./modules/branches/branches.service";
import { AccountingController } from "./modules/accounting/accounting.controller";
import { AccountingPostingEngine } from "./modules/accounting/accounting-posting-engine";
import { AccountingQueryService } from "./modules/accounting/accounting-query.service";
import { CustomersController } from "./modules/customers/customers.controller";
import { CustomersService } from "./modules/customers/customers.service";
import { SalesController } from "./modules/sales/sales.controller";
import { SalesService } from "./modules/sales/sales.service";
import { ProductsController } from "./modules/inventory/products.controller";
import { ProductsService } from "./modules/inventory/products.service";
import { InventoryController } from "./modules/inventory/inventory.controller";
import { InventoryService } from "./modules/inventory/inventory.service";
import { SuppliersController } from "./modules/suppliers/suppliers.controller";
import { SuppliersService } from "./modules/suppliers/suppliers.service";
import { PurchasesController } from "./modules/purchases/purchases.controller";
import { PurchasesService } from "./modules/purchases/purchases.service";
import { PosController } from "./modules/pos/pos.controller";
import { PosService } from "./modules/pos/pos.service";
import { ShiftsController } from "./modules/pos/shifts.controller";
import { ShiftsService } from "./modules/pos/shifts.service";
import { ReportingController } from "./modules/reporting/reporting.controller";
import { ReportingService } from "./modules/reporting/reporting.service";
import { AccountsController } from "./modules/accounts/accounts.controller";
import { AccountsService } from "./modules/accounts/accounts.service";
import { ExpensesController } from "./modules/expenses/expenses.controller";
import { ExpensesService } from "./modules/expenses/expenses.service";
import { AssetsController } from "./modules/assets/assets.controller";
import { AssetsService } from "./modules/assets/assets.service";
import { BankingController } from "./modules/banking/banking.controller";
import { BankingService } from "./modules/banking/banking.service";
import { PaymentsController } from "./modules/payments/payments.controller";
import { PaymentsService } from "./modules/payments/payments.service";
import { StatementsService } from "./modules/statements/statements.service";
import { StatementsController } from "./modules/statements/statements.controller";
import { AgingService } from "./modules/aging/aging.service";
import { AgingController } from "./modules/aging/aging.controller";
import { PeriodsService } from "./modules/periods/periods.service";
import { PeriodsController } from "./modules/periods/periods.controller";
import { ReceiptsService } from "./modules/receipts/receipts.service";
import { ReceiptsController } from "./modules/receipts/receipts.controller";
import { JwtAuthGuard } from "./modules/common/jwt-auth.guard";
import { TenantGuard } from "./modules/common/tenant.guard";
import { PermissionsGuard } from "./modules/common/permissions.guard";
import { AuditInterceptor, AuditSink } from "./modules/common/audit.interceptor";

import {
  InMemoryDatabase,
  InMemoryAuthUserLookup,
  InMemoryRolePermissionLookup,
  InMemoryOrganizationsRepository,
  InMemoryBranchesRepository,
  InMemoryCustomersRepository,
  InMemorySalesRepository,
  InMemoryProductsRepository,
  InMemoryInventoryRepository,
  InMemorySuppliersRepository,
  InMemoryPurchasesRepository,
  InMemoryPosRepository,
  InMemoryShiftsRepository,
  InMemoryAccountTypeLookup,
  InMemoryGeneralLedgerRepository,
  InMemoryAccountsRepository,
  InMemoryPeriodsRepository,
  InMemoryExpensesRepository,
  InMemoryAssetsRepository,
  InMemoryPaymentsRepository,
  InMemoryAccountingQueryRepository,
  InMemoryPrismaClient,
} from "./infra/in-memory-repositories";
import { PrismaAccountsRepository, PrismaOrganizationsRepository, PrismaPeriodsRepository, PrismaAuthUserLookup } from "./infra/prisma-repositories";

/** Logs to stdout — the Phase 0 stand-in for a real `audit_logs` table writer. */
class ConsoleAuditSink implements AuditSink {
  async record(entry: Parameters<AuditSink["record"]>[0]): Promise<void> {
    console.log("[AUDIT]", JSON.stringify(entry));
  }
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? "dev-only-secret-change-in-production",
      signOptions: { expiresIn: "12h" },
    }),
  ],
  controllers: [
    AuthController,
    OrganizationsController,
    BranchesController,
    AccountingController,
    CustomersController,
    SalesController,
    ProductsController,
    InventoryController,
    SuppliersController,
    PurchasesController,
    PosController,
    ShiftsController,
    ReportingController,
    AccountsController,
    ExpensesController,
    AssetsController,
    BankingController,
    PaymentsController,
    StatementsController,
    AgingController,
    PeriodsController,
    ReceiptsController,
  ],
  providers: [
    Reflector,
    { provide: InMemoryDatabase, useValue: new InMemoryDatabase() },

    {
      provide: "AuthUserLookup",
      useFactory: (db: InMemoryDatabase, realPrisma: any) =>
        realPrisma ? new PrismaAuthUserLookup(realPrisma) : new InMemoryAuthUserLookup(db),
      inject: [InMemoryDatabase, "RealPrismaClientOrNull"],
    },
    { provide: AuthService, useFactory: (jwt: JwtService, lookup: any) => new AuthService(jwt, lookup), inject: [JwtService, "AuthUserLookup"] },

    { provide: "RolePermissionLookup", useFactory: (db: InMemoryDatabase) => new InMemoryRolePermissionLookup(db), inject: [InMemoryDatabase] },
    PermissionsGuard,

    {
      provide: "OrganizationsRepository",
      useFactory: (db: InMemoryDatabase, realPrisma: any) =>
        realPrisma ? new PrismaOrganizationsRepository(realPrisma) : new InMemoryOrganizationsRepository(db),
      inject: [InMemoryDatabase, "RealPrismaClientOrNull"],
    },
    { provide: OrganizationsService, useFactory: (repo: any) => new OrganizationsService(repo), inject: ["OrganizationsRepository"] },

    { provide: "BranchesRepository", useFactory: (db: InMemoryDatabase) => new InMemoryBranchesRepository(db), inject: [InMemoryDatabase] },
    { provide: BranchesService, useFactory: (repo: any) => new BranchesService(repo), inject: ["BranchesRepository"] },

    {
      // Sprint 34 — a single shared real PrismaClient instance (or null),
      // consumed by AccountingPostingEngine AND the three repositories
      // that must move together (Accounts, Organizations, Periods) — see
      // prisma-repositories.ts and prisma-seed.ts's header comments for
      // why these can't be flipped one at a time. Renamed from Sprint
      // 32's USE_REAL_PRISMA_ACCOUNTING to USE_REAL_PRISMA_DB now that
      // the flag's scope covers more than just the posting engine.
      provide: "RealPrismaClientOrNull",
      useFactory: () => {
        if (process.env.USE_REAL_PRISMA_DB === "true") {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { PrismaClient } = require("@prisma/client");
          return new PrismaClient();
        }
        return null;
      },
    },
    {
      provide: "PrismaClientLike",
      useFactory: (db: InMemoryDatabase, realPrisma: any) => realPrisma ?? new InMemoryPrismaClient(db),
      inject: [InMemoryDatabase, "RealPrismaClientOrNull"],
    },
    { provide: AccountingPostingEngine, useFactory: (prisma: any) => new AccountingPostingEngine(prisma), inject: ["PrismaClientLike"] },

    { provide: "AccountingQueryRepository", useFactory: (db: InMemoryDatabase, accounts: AccountsService) => new InMemoryAccountingQueryRepository(db, accounts), inject: [InMemoryDatabase, AccountsService] },
    { provide: AccountingQueryService, useFactory: (repo: any) => new AccountingQueryService(repo), inject: ["AccountingQueryRepository"] },

    { provide: "CustomersRepository", useFactory: (db: InMemoryDatabase) => new InMemoryCustomersRepository(db), inject: [InMemoryDatabase] },
    { provide: CustomersService, useFactory: (repo: any) => new CustomersService(repo), inject: ["CustomersRepository"] },

    {
      provide: "AccountsRepository",
      useFactory: (db: InMemoryDatabase, realPrisma: any) =>
        realPrisma ? new PrismaAccountsRepository(realPrisma) : new InMemoryAccountsRepository(db),
      inject: [InMemoryDatabase, "RealPrismaClientOrNull"],
    },
    { provide: AccountsService, useFactory: (repo: any) => new AccountsService(repo), inject: ["AccountsRepository"] },

    { provide: "SalesRepository", useFactory: (db: InMemoryDatabase, accounts: AccountsService) => new InMemorySalesRepository(db, accounts), inject: [InMemoryDatabase, AccountsService] },
    {
      provide: SalesService,
      useFactory: (engine: AccountingPostingEngine, customers: CustomersService, repo: any) =>
        new SalesService(engine, customers, repo),
      inject: [AccountingPostingEngine, CustomersService, "SalesRepository"],
    },

    { provide: "ProductsRepository", useFactory: (db: InMemoryDatabase) => new InMemoryProductsRepository(db), inject: [InMemoryDatabase] },
    { provide: ProductsService, useFactory: (repo: any) => new ProductsService(repo), inject: ["ProductsRepository"] },

    { provide: "InventoryRepository", useFactory: (db: InMemoryDatabase, accounts: AccountsService) => new InMemoryInventoryRepository(db, accounts), inject: [InMemoryDatabase, AccountsService] },
    {
      provide: InventoryService,
      useFactory: (engine: AccountingPostingEngine, products: ProductsService, repo: any) =>
        new InventoryService(engine, products, repo),
      inject: [AccountingPostingEngine, ProductsService, "InventoryRepository"],
    },

    { provide: "SuppliersRepository", useFactory: (db: InMemoryDatabase) => new InMemorySuppliersRepository(db), inject: [InMemoryDatabase] },
    { provide: SuppliersService, useFactory: (repo: any) => new SuppliersService(repo), inject: ["SuppliersRepository"] },

    { provide: "PurchasesRepository", useFactory: (db: InMemoryDatabase, accounts: AccountsService) => new InMemoryPurchasesRepository(db, accounts), inject: [InMemoryDatabase, AccountsService] },
    {
      provide: PurchasesService,
      useFactory: (engine: AccountingPostingEngine, suppliers: SuppliersService, inventory: InventoryService, repo: any, products: ProductsService) =>
        new PurchasesService(engine, suppliers, inventory, repo, products),
      inject: [AccountingPostingEngine, SuppliersService, InventoryService, "PurchasesRepository", ProductsService],
    },

    { provide: "PosRepository", useFactory: (db: InMemoryDatabase, accounts: AccountsService) => new InMemoryPosRepository(db, accounts), inject: [InMemoryDatabase, AccountsService] },
    {
      provide: PosService,
      useFactory: (engine: AccountingPostingEngine, inventory: InventoryService, repo: any, shifts: ShiftsService, orgs: OrganizationsService) =>
        new PosService(engine, inventory, repo, shifts, orgs),
      inject: [AccountingPostingEngine, InventoryService, "PosRepository", ShiftsService, OrganizationsService],
    },

    { provide: "ShiftsRepository", useFactory: (db: InMemoryDatabase) => new InMemoryShiftsRepository(db), inject: [InMemoryDatabase] },
    { provide: ShiftsService, useFactory: (repo: any) => new ShiftsService(repo), inject: ["ShiftsRepository"] },

    { provide: "AccountTypeLookup", useFactory: (accounts: AccountsService) => new InMemoryAccountTypeLookup(accounts), inject: [AccountsService] },
    { provide: "GeneralLedgerRepository", useFactory: (db: InMemoryDatabase) => new InMemoryGeneralLedgerRepository(db), inject: [InMemoryDatabase] },
    {
      provide: ReportingService,
      useFactory: (accQuery: AccountingQueryService, typeLookup: any, ledgerRepo: any, accounts: AccountsService) =>
        new ReportingService(accQuery, typeLookup, ledgerRepo, accounts),
      inject: [AccountingQueryService, "AccountTypeLookup", "GeneralLedgerRepository", AccountsService],
    },

    { provide: "ExpensesRepository", useFactory: (db: InMemoryDatabase) => new InMemoryExpensesRepository(db), inject: [InMemoryDatabase] },
    {
      provide: ExpensesService,
      useFactory: (engine: AccountingPostingEngine, accounts: AccountsService, repo: any) => new ExpensesService(engine, accounts, repo),
      inject: [AccountingPostingEngine, AccountsService, "ExpensesRepository"],
    },

    { provide: "AssetsRepository", useFactory: (db: InMemoryDatabase) => new InMemoryAssetsRepository(db), inject: [InMemoryDatabase] },
    {
      provide: AssetsService,
      useFactory: (engine: AccountingPostingEngine, accounts: AccountsService, repo: any) => new AssetsService(engine, accounts, repo),
      inject: [AccountingPostingEngine, AccountsService, "AssetsRepository"],
    },

    {
      provide: BankingService,
      useFactory: (engine: AccountingPostingEngine, accounts: AccountsService) => new BankingService(engine, accounts),
      inject: [AccountingPostingEngine, AccountsService],
    },

    { provide: "PaymentsRepository", useFactory: (db: InMemoryDatabase) => new InMemoryPaymentsRepository(db), inject: [InMemoryDatabase] },
    {
      provide: PaymentsService,
      useFactory: (engine: AccountingPostingEngine, accounts: AccountsService, repo: any, sales: SalesService, purchases: PurchasesService) =>
        new PaymentsService(engine, accounts, repo, sales, purchases),
      inject: [AccountingPostingEngine, AccountsService, "PaymentsRepository", SalesService, PurchasesService],
    },

    {
      provide: StatementsService,
      useFactory: (sales: SalesService, purchases: PurchasesService, payments: PaymentsService) =>
        new StatementsService(sales, purchases, payments),
      inject: [SalesService, PurchasesService, PaymentsService],
    },

    {
      provide: AgingService,
      useFactory: (sales: SalesService, purchases: PurchasesService) => new AgingService(sales, purchases),
      inject: [SalesService, PurchasesService],
    },

    {
      provide: "PeriodsRepository",
      useFactory: (db: InMemoryDatabase, realPrisma: any) =>
        realPrisma ? new PrismaPeriodsRepository(realPrisma) : new InMemoryPeriodsRepository(db),
      inject: [InMemoryDatabase, "RealPrismaClientOrNull"],
    },
    { provide: PeriodsService, useFactory: (repo: any) => new PeriodsService(repo), inject: ["PeriodsRepository"] },

    {
      provide: ReceiptsService,
      useFactory: (orgs: OrganizationsService, pos: PosService, sales: SalesService) => new ReceiptsService(orgs, pos, sales),
      inject: [OrganizationsService, PosService, SalesService],
    },

    { provide: "AuditSink", useClass: ConsoleAuditSink },
    AuditInterceptor,

    JwtAuthGuard,
    TenantGuard,
  ],
})
export class AppModule {}
