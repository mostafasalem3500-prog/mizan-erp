import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import type { AuthTokenPayload } from "./auth-context";

/**
 * Verifies the bearer token and attaches its payload to `request.user`.
 * This is intentionally the ONLY place a request's organizationId is
 * established for the rest of the pipeline — TenantGuard and every
 * service read it from here, never from anything client-supplied in the
 * body/query/params (spec band 7).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token);
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, token] = header.split(" ");
    return scheme === "Bearer" ? token : undefined;
  }
}
