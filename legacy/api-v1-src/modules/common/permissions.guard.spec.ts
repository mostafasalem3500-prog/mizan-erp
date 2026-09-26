import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard, RolePermissionLookup } from "./permissions.guard";

function makeContext(user: { roleId?: string } | undefined, metadata: string[] | undefined) {
  const request = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    __metadata: metadata,
  } as unknown as ExecutionContext;
}

describe("PermissionsGuard", () => {
  function makeReflector(metadata: string[] | undefined) {
    return { getAllAndOverride: () => metadata } as unknown as Reflector;
  }

  test("allows the request through when the route requires no permissions", async () => {
    const lookup: RolePermissionLookup = { getPermissionCodesForRole: jest.fn() };
    const guard = new PermissionsGuard(makeReflector(undefined), lookup);
    const ctx = makeContext({ roleId: "role-1" }, undefined);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(lookup.getPermissionCodesForRole).not.toHaveBeenCalled();
  });

  test("allows the request when the role holds every required permission", async () => {
    const lookup: RolePermissionLookup = {
      getPermissionCodesForRole: jest.fn().mockResolvedValue(["invoice.post", "invoice.approve", "invoice.view"]),
    };
    const guard = new PermissionsGuard(makeReflector(["invoice.post", "invoice.approve"]), lookup);
    const ctx = makeContext({ roleId: "role-1" }, ["invoice.post", "invoice.approve"]);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  test("rejects when the role is missing one of several required permissions", async () => {
    const lookup: RolePermissionLookup = {
      getPermissionCodesForRole: jest.fn().mockResolvedValue(["invoice.view"]),
    };
    const guard = new PermissionsGuard(makeReflector(["invoice.post", "invoice.approve"]), lookup);
    const ctx = makeContext({ roleId: "role-1" }, ["invoice.post", "invoice.approve"]);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/invoice\.post/);
  });

  test("rejects when there is no role on the token at all", async () => {
    const lookup: RolePermissionLookup = { getPermissionCodesForRole: jest.fn() };
    const guard = new PermissionsGuard(makeReflector(["invoice.post"]), lookup);
    const ctx = makeContext(undefined, ["invoice.post"]);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/No role on token/);
  });

  test("a cashier-scoped role without pos.overrideDiscount is blocked from that action", async () => {
    // Mirrors spec band 103: discount overrides above threshold require POS Supervisor.
    const cashierPermissions = ["pos.sell", "pos.return"];
    const lookup: RolePermissionLookup = {
      getPermissionCodesForRole: jest.fn().mockResolvedValue(cashierPermissions),
    };
    const guard = new PermissionsGuard(makeReflector(["pos.overrideDiscount"]), lookup);
    const ctx = makeContext({ roleId: "cashier-role" }, ["pos.overrideDiscount"]);

    await expect(guard.canActivate(ctx)).rejects.toThrow(/pos\.overrideDiscount/);
  });
});
