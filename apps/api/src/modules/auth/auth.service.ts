import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import type { AuthTokenPayload } from "../common/auth-context";

export interface UserCredentialsRow {
  userId: string;
  passwordHash: string;
  isActive: boolean;
}

export interface OrganizationMembershipRow {
  organizationId: string;
  roleId: string;
  branchId?: string;
}

/**
 * Everything this service needs from the database, expressed as an
 * interface so AuthService is unit-testable without Prisma. The real
 * implementation (next session) backs this with the `users` and
 * `organization_users` tables from schema.prisma.
 */
export interface AuthUserLookup {
  findCredentialsByEmail(email: string): Promise<UserCredentialsRow | null>;
  /**
   * A user can belong to more than one organization (spec band 7 —
   * multi-tenant). The login flow must be told which one to scope the
   * token to; this looks up that specific membership, not "the first one".
   */
  findMembership(userId: string, organizationId: string): Promise<OrganizationMembershipRow | null>;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userLookup: AuthUserLookup,
  ) {}

  static async hashPassword(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
  }

  async login(email: string, password: string, organizationId: string): Promise<{ accessToken: string }> {
    const credentials = await this.userLookup.findCredentialsByEmail(email);

    if (!credentials || !credentials.isActive) {
      // Same error for "no such user" and "wrong password" — never reveal
      // which one it was, so login can't be used to enumerate accounts.
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordMatches = await bcrypt.compare(password, credentials.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const membership = await this.userLookup.findMembership(credentials.userId, organizationId);
    if (!membership) {
      throw new UnauthorizedException("User is not a member of this organization");
    }

    const payload: AuthTokenPayload = {
      userId: credentials.userId,
      organizationId: membership.organizationId,
      roleId: membership.roleId,
      branchId: membership.branchId,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken };
  }
}
