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
  /**
   * Sprint 36 — all memberships for a user, so login can resolve the
   * organization automatically when there is exactly one. Requiring the
   * user to type a raw UUID into the login form (the previous behavior)
   * was a real usability defect: the id is an internal technical
   * identifier no human should ever need to know or copy, and it is not
   * a security boundary — the password already is.
   */
  listMemberships(userId: string): Promise<OrganizationMembershipRow[]>;
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

  /**
   * `organizationId` is optional as of Sprint 36. When omitted, it is
   * resolved automatically if the user belongs to exactly one
   * organization — the overwhelmingly common case, and the one where
   * demanding a UUID from the user served no purpose. It stays required
   * (as an explicit choice) only for genuinely multi-organization users,
   * where the system cannot know which tenant to scope the session to.
   */
  async login(email: string, password: string, organizationId?: string): Promise<{ accessToken: string }> {
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

    const membership = await this.resolveMembership(credentials.userId, organizationId);

    return this.issueToken(credentials.userId, membership);
  }

  async loginDemo(email: string): Promise<{ accessToken: string }> {
    const credentials = await this.userLookup.findCredentialsByEmail(email);
    if (!credentials || !credentials.isActive) {
      throw new UnauthorizedException("Demo account is unavailable");
    }
    const membership = await this.resolveMembership(credentials.userId);
    return this.issueToken(credentials.userId, membership, true);
  }

  private async resolveMembership(userId: string, organizationId?: string): Promise<OrganizationMembershipRow> {
    let membership: OrganizationMembershipRow | null;

    if (organizationId) {
      membership = await this.userLookup.findMembership(userId, organizationId);
      if (!membership) {
        throw new UnauthorizedException("User is not a member of this organization");
      }
    } else {
      const memberships = await this.userLookup.listMemberships(userId);
      if (memberships.length === 0) {
        throw new UnauthorizedException("User is not a member of any organization");
      }
      if (memberships.length > 1) {
        // Deliberately not picking one silently: for a genuinely
        // multi-tenant user, guessing which organization they meant
        // would scope their whole session — and every posting they make
        // — to possibly the wrong company's books.
        throw new UnauthorizedException(
          "This account belongs to multiple organizations — organizationId is required to choose one",
        );
      }
      membership = memberships[0];
    }

    return membership;
  }

  private async issueToken(userId: string, membership: OrganizationMembershipRow, demoMode = false): Promise<{ accessToken: string }> {
    const payload: AuthTokenPayload = {
      userId,
      organizationId: membership.organizationId,
      roleId: membership.roleId,
      branchId: membership.branchId,
      ...(demoMode ? { demoMode: true } : {}),
    };

    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken };
  }
}
