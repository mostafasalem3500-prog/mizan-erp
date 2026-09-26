import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

export const PERMISSIONS_KEY = "required_permissions";
export const ROLE_PERMISSION_LOOKUP = "RolePermissionLookup";

/** Decorator: `@RequirePermissions("invoice.post", "invoice.approve")` — ALL listed permissions are required. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Looks up which permission codes a role currently holds. A thin interface
 * so the guard is unit-testable without a real database — the NestJS
 * provider wiring registers a concrete implementation under the
 * ROLE_PERMISSION_LOOKUP token (see app.module.ts); the real one (next
 * session) backs this with Prisma:
 *   role.rolePermissions.map(rp => rp.permission.code)
 */
export interface RolePermissionLookup {
  getPermissionCodesForRole(roleId: string): Promise<string[]>;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ROLE_PERMISSION_LOOKUP) private readonly rolePermissionLookup: RolePermissionLookup,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true; // route carries no @RequirePermissions — JwtAuthGuard alone applies
    }

    const request = context.switchToHttp().getRequest<Request>();
    const roleId = request.user?.roleId;

    if (!roleId) {
      throw new ForbiddenException("No role on token — cannot evaluate permissions");
    }

    const granted = await this.rolePermissionLookup.getPermissionCodesForRole(roleId);
    const grantedSet = new Set(granted);
    const missing = required.filter((p) => !grantedSet.has(p));

    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission(s): ${missing.join(", ")}`,
      );
    }

    return true;
  }
}
