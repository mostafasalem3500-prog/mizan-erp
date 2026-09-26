import { ExecutionContext } from "@nestjs/common";
import { TenantGuard } from "./tenant.guard";

function makeContext(user: { organizationId?: string } | undefined, params: Record<string, string> = {}) {
  const request = { user, params };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("TenantGuard (spec band 7 — first line of tenant isolation)", () => {
  test("allows a request with no organizationId in the path", () => {
    const guard = new TenantGuard();
    const ctx = makeContext({ organizationId: "org-a" }, {});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test("allows a request whose path organizationId matches the token", () => {
    const guard = new TenantGuard();
    const ctx = makeContext({ organizationId: "org-a" }, { organizationId: "org-a" });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  test("blocks a request whose path organizationId differs from the token — the core cross-tenant case", () => {
    const guard = new TenantGuard();
    const ctx = makeContext({ organizationId: "org-a" }, { organizationId: "org-b" });
    expect(() => guard.canActivate(ctx)).toThrow(/Cross-tenant access denied/);
  });

  test("blocks a request with no organization on the token at all", () => {
    const guard = new TenantGuard();
    const ctx = makeContext(undefined, {});
    expect(() => guard.canActivate(ctx)).toThrow(/No organization on token/);
  });
});
