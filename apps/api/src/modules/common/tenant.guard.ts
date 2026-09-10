import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

/**
 * First layer of tenant isolation (spec band 7). If a route has an
 * `:organizationId` path param, this guard rejects the request outright
 * when it doesn't match the caller's own token — before any handler or
 * repository code runs, and regardless of what the handler would have
 * done with it.
 *
 * This guard alone is NOT the whole isolation story: routes that don't
 * carry an explicit organizationId param (the common case — most routes
 * scope implicitly to "my organization") rely on every repository query
 * being built with `where: { organizationId: request.user.organizationId }`,
 * enforced centrally via a Prisma client extension (see
 * docs/ARCHITECTURE.md §3), plus Postgres Row Level Security as a second,
 * independent layer. Both of those are still pending implementation —
 * tracked in docs/MVP_ROADMAP.md — this guard only closes the narrower
 * "organizationId appears directly in the URL" gap.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const tokenOrgId = request.user?.organizationId;
    const paramOrgId = request.params?.organizationId;

    if (!tokenOrgId) {
      throw new ForbiddenException("No organization on token");
    }

    if (paramOrgId && paramOrgId !== tokenOrgId) {
      throw new ForbiddenException(
        "Cross-tenant access denied: path organization does not match token organization",
      );
    }

    return true;
  }
}
