/**
 * The shape carried inside a signed access token and attached to
 * `request.user` by JwtAuthGuard. This is the ONLY place tenant scope
 * travels through a request — every guard and service downstream reads
 * organizationId from here, never from a request body or query param,
 * so a client can never widen its own scope by passing a different
 * organizationId in the payload (spec band 7: tenant isolation).
 */
export interface AuthTokenPayload {
  userId: string;
  organizationId: string;
  roleId: string;
  branchId?: string;
}

declare module "express" {
  interface Request {
    user?: AuthTokenPayload;
  }
}
