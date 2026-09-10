import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "path";
import { AppModule } from "./app.module";
import { AuthService } from "./modules/auth/auth.service";
import { AccountsService } from "./modules/accounts/accounts.service";
import { InMemoryDatabase } from "./infra/in-memory-repositories";
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

  // Seed one demo organization directly into the shared in-memory store so
  // this Phase 0 build is smoke-testable the moment it starts, without a
  // separate seed script or a real database (spec band 125, scaled down —
  // one branch, one role, one account's worth of activity, not 100
  // products and 6 months of history, per docs/MVP_ROADMAP.md Sprint 1's
  // note on starting small before the full demo dataset).
  const db = app.get(InMemoryDatabase);
  const passwordHash = await AuthService.hashPassword(DEMO_OWNER_PASSWORD);
  const seeded = db.seedDemoOrganization(DEMO_OWNER_EMAIL, passwordHash);

  // Seed the real default Chart of Accounts (spec band 20) — as of Sprint
  // 10, Sales/Purchases/Inventory/POS/Reporting all resolve their GL
  // account ids by CODE through AccountsService, not hardcoded strings, so
  // this seed is what makes every one of those modules actually postable
  // for the demo organization.
  const accountsService = app.get(AccountsService);
  await accountsService.seedDefaultChartOfAccounts(seeded.organizationId);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);

  console.log(`Mizan ERP API (Phase 0) listening on http://localhost:${port}`);
  console.log(`Web UI: http://localhost:${port}/index.html`);
  console.log(`Demo organization seeded — log in with:`);
  console.log(`  POST /api/v1/auth/login`);
  console.log(`  { "email": "${DEMO_OWNER_EMAIL}", "password": "${DEMO_OWNER_PASSWORD}", "organizationId": "${seeded.organizationId}" }`);
  console.log(`Demo accounting period id (OPEN): ${seeded.periodId}`);
  console.log(`Default Chart of Accounts seeded (codes 1000-6100, see docs/ARCHITECTURE.md).`);
}

bootstrap();
