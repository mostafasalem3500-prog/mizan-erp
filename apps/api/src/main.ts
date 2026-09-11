import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import { AppModule } from "./app.module";
import { AuthService } from "./modules/auth/auth.service";
import { AccountsService } from "./modules/accounts/accounts.service";
import { InMemoryDatabase } from "./infra/in-memory-repositories";
import { seedDemoOrganizationWithPrisma } from "./infra/prisma-seed";
import { DomainExceptionFilter } from "./modules/common/domain-exception.filter";

const DEMO_OWNER_EMAIL = "owner@mizan-demo.sa";
const DEMO_OWNER_PASSWORD = "DemoPass123!";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn", "log"] });
  app.useGlobalFilters(new DomainExceptionFilter());

  // Sprint 22 — the first real UI (spec band 143), served as static files
  // alongside the API so there's no CORS setup to get right for this
  // Phase 0 build. This is a lightweight bootstrap UI (login, dashboard,
  // customers, sales invoice creation) calling the real endpoints above —
  // not the eventual Next.js app decided in docs/ARCHITECTURE.md, which
  // remains the target for when the product moves past Phase 0.
  app.useStaticAssets(join(__dirname, "..", "public"));

  const passwordHash = await AuthService.hashPassword(DEMO_OWNER_PASSWORD);

  // Sprint 34 — when USE_REAL_PRISMA_DB is set, seed the SAME real
  // Postgres database the app.module.ts providers now point at (via the
  // shared "RealPrismaClientOrNull" instance, not a second connection),
  // using seedDemoOrganizationWithPrisma() so the organization/period/
  // accounts this seed creates are visible to AccountingPostingEngine
  // and AccountsService alike — the exact consistency prisma-seed.ts's
  // header comment says is required before this flag is safe to flip.
  // Falls back to the original in-memory seed otherwise, unchanged.
  const realPrisma = app.get("RealPrismaClientOrNull", { strict: false });
  let seeded: { organizationId: string; periodId: string };

  if (realPrisma) {
    const result = await seedDemoOrganizationWithPrisma(realPrisma, DEMO_OWNER_EMAIL, passwordHash);
    seeded = { organizationId: result.organizationId, periodId: result.periodId };
    console.log(`Seeded demo organization into REAL Postgres (USE_REAL_PRISMA_DB=true).`);
  } else {
    // Seed one demo organization directly into the shared in-memory store so
    // this Phase 0 build is smoke-testable the moment it starts, without a
    // separate seed script or a real database (spec band 125, scaled down —
    // one branch, one role, one account's worth of activity, not 100
    // products and 6 months of history, per docs/MVP_ROADMAP.md Sprint 1's
    // note on starting small before the full demo dataset).
    const db = app.get(InMemoryDatabase);
    const inMemorySeeded = db.seedDemoOrganization(DEMO_OWNER_EMAIL, passwordHash);
    seeded = { organizationId: inMemorySeeded.organizationId, periodId: inMemorySeeded.periodId };

    // Seed the real default Chart of Accounts (spec band 20) — as of Sprint
    // 10, Sales/Purchases/Inventory/POS/Reporting all resolve their GL
    // account ids by CODE through AccountsService, not hardcoded strings, so
    // this seed is what makes every one of those modules actually postable
    // for the demo organization. (When realPrisma is set, prisma-seed.ts
    // already created the same chart of accounts as part of the call above.)
    const accountsService = app.get(AccountsService);
    await accountsService.seedDefaultChartOfAccounts(seeded.organizationId);
  }

  const portArgIndex = process.argv.indexOf("--port");
  const cliPort = portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : undefined;
  const hostArgIndex = process.argv.indexOf("--host");
  const cliHost = hostArgIndex >= 0 ? process.argv[hostArgIndex + 1] : undefined;
  const port = cliPort || (process.env.PORT ? Number(process.env.PORT) : 3000);
  await app.listen(port, cliHost || "0.0.0.0");

  console.log(`Mizan ERP API (Phase 0) listening on http://localhost:${port}`);
  console.log(`Web UI: http://localhost:${port}/index.html`);
  console.log(`Demo organization seeded — log in with:`);
  console.log(`  POST /api/v1/auth/login`);
  console.log(`  { "email": "${DEMO_OWNER_EMAIL}", "password": "${DEMO_OWNER_PASSWORD}", "organizationId": "${seeded.organizationId}" }`);
  console.log(`Demo accounting period id (OPEN): ${seeded.periodId}`);
  console.log(`Default Chart of Accounts seeded (codes 1000-6100, see docs/ARCHITECTURE.md).`);
}

bootstrap();
