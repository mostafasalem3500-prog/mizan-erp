import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { AuthService, AuthUserLookup } from "./auth.service";

describe("AuthService", () => {
  const jwtService = new JwtService({ secret: "test-secret" });

  async function makeLookupWithUser(password: string) {
    const passwordHash = await bcrypt.hash(password, 4); // low rounds for fast tests
    const lookup: AuthUserLookup = {
      findCredentialsByEmail: jest.fn().mockImplementation(async (email: string) =>
        email === "owner@mizan.test"
          ? { userId: "user-1", passwordHash, isActive: true }
          : null,
      ),
      findMembership: jest.fn().mockImplementation(async (userId: string, organizationId: string) =>
        userId === "user-1" && organizationId === "org-1"
          ? { organizationId: "org-1", roleId: "role-owner", branchId: "branch-1" }
          : null,
      ),
    };
    return lookup;
  }

  test("issues a token whose payload carries userId/organizationId/roleId on correct credentials", async () => {
    const lookup = await makeLookupWithUser("correct-password");
    const auth = new AuthService(jwtService, lookup);

    const { accessToken } = await auth.login("owner@mizan.test", "correct-password", "org-1");
    const decoded = jwtService.decode(accessToken) as any;

    expect(decoded.userId).toBe("user-1");
    expect(decoded.organizationId).toBe("org-1");
    expect(decoded.roleId).toBe("role-owner");
  });

  test("rejects a wrong password", async () => {
    const lookup = await makeLookupWithUser("correct-password");
    const auth = new AuthService(jwtService, lookup);

    await expect(auth.login("owner@mizan.test", "wrong-password", "org-1")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  test("rejects an unknown email with the SAME error as a wrong password (no account enumeration)", async () => {
    const lookup = await makeLookupWithUser("correct-password");
    const auth = new AuthService(jwtService, lookup);

    let unknownEmailError: Error | undefined;
    let wrongPasswordError: Error | undefined;

    try {
      await auth.login("nobody@mizan.test", "anything", "org-1");
    } catch (e) {
      unknownEmailError = e as Error;
    }
    try {
      await auth.login("owner@mizan.test", "wrong-password", "org-1");
    } catch (e) {
      wrongPasswordError = e as Error;
    }

    expect(unknownEmailError?.message).toBe(wrongPasswordError?.message);
  });

  test("rejects login into an organization the user does not belong to", async () => {
    const lookup = await makeLookupWithUser("correct-password");
    const auth = new AuthService(jwtService, lookup);

    await expect(
      auth.login("owner@mizan.test", "correct-password", "org-does-not-belong-to-user"),
    ).rejects.toThrow(/not a member/);
  });

  test("rejects a deactivated user even with the correct password", async () => {
    const passwordHash = await bcrypt.hash("correct-password", 4);
    const lookup: AuthUserLookup = {
      findCredentialsByEmail: jest.fn().mockResolvedValue({
        userId: "user-1",
        passwordHash,
        isActive: false,
      }),
      findMembership: jest.fn(),
    };
    const auth = new AuthService(jwtService, lookup);

    await expect(auth.login("owner@mizan.test", "correct-password", "org-1")).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
