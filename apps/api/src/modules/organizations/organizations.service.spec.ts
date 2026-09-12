import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { OrganizationsService, OrganizationsRepository, DEFAULT_SEEDED_ROLES } from "./organizations.service";

describe("OrganizationsService", () => {
  function makeRepo(vatExists: boolean): OrganizationsRepository {
    return {
      vatNumberExists: jest.fn().mockResolvedValue(vatExists),
      createOrganizationWithOwner: jest.fn().mockResolvedValue({
        organizationId: "org-1",
        ownerUserId: "user-1",
        ownerRoleId: "role-owner",
      }),
      findById: jest.fn().mockResolvedValue(null),
      updateSettings: jest.fn(),
    };
  }

  test("rejects creation when the VAT number is already registered to another organization", async () => {
    const repo = makeRepo(true);
    const service = new OrganizationsService(repo);

    await expect(
      service.createOrganization({
        legalNameAr: "شركة الاختبار",
        vatNumber: "300000000000003",
        ownerEmail: "owner@test.sa",
        ownerFullName: "Test Owner",
        ownerPassword: "S3curePass!",
      }),
    ).rejects.toThrow(ConflictException);

    expect(repo.createOrganizationWithOwner).not.toHaveBeenCalled();
  });

  test("creates the organization with a hashed password and seeds all default roles", async () => {
    const repo = makeRepo(false);
    const service = new OrganizationsService(repo);

    const result = await service.createOrganization({
      legalNameAr: "شركة الاختبار",
      vatNumber: "300000000000003",
      ownerEmail: "owner@test.sa",
      ownerFullName: "Test Owner",
      ownerPassword: "S3curePass!",
    });

    expect(result.organizationId).toBe("org-1");
    const call = (repo.createOrganizationWithOwner as jest.Mock).mock.calls[0][0];

    expect(call.seededRoleNames).toEqual(DEFAULT_SEEDED_ROLES);
    expect(call.ownerRoleName).toBe("Owner");
    expect(call.owner.email).toBe("owner@test.sa");
    // the plaintext password must never reach the repository layer
    expect(call.owner.passwordHash).not.toBe("S3curePass!");
    expect(call.owner.passwordHash.length).toBeGreaterThan(20); // bcrypt hashes are long
  });

  test("allows creation when no VAT number is supplied at all (uniqueness check is skipped, not failed)", async () => {
    const repo = makeRepo(false);
    const service = new OrganizationsService(repo);

    await service.createOrganization({
      legalNameAr: "شركة بدون رقم ضريبي بعد",
      ownerEmail: "owner2@test.sa",
      ownerFullName: "Owner Two",
      ownerPassword: "AnotherPass!1",
    });

    expect(repo.vatNumberExists).not.toHaveBeenCalled();
    expect(repo.createOrganizationWithOwner).toHaveBeenCalled();
  });
});

describe("OrganizationsService — getOrganization", () => {
  test("returns the organization row when found", async () => {
    const repo: OrganizationsRepository = {
      vatNumberExists: jest.fn(),
      createOrganizationWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: "org-1", legalNameAr: "شركة الاختبار", vatNumber: "300000000000003" }),
      updateSettings: jest.fn(),
    };
    const service = new OrganizationsService(repo);

    const org = await service.getOrganization("org-1");
    expect(org?.legalNameAr).toBe("شركة الاختبار");
  });

  test("returns null when the organization doesn't exist", async () => {
    const repo: OrganizationsRepository = {
      vatNumberExists: jest.fn(),
      createOrganizationWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
      updateSettings: jest.fn(),
    };
    const service = new OrganizationsService(repo);

    expect(await service.getOrganization("ghost")).toBeNull();
  });
});

describe("OrganizationsService — updateSettings (Sprint 29)", () => {
  test("updates requireShiftForPosSale and returns the updated row", async () => {
    const repo: OrganizationsRepository = {
      vatNumberExists: jest.fn(),
      createOrganizationWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: "org-1", legalNameAr: "شركة الاختبار" }),
      updateSettings: jest.fn().mockResolvedValue({ id: "org-1", legalNameAr: "شركة الاختبار", requireShiftForPosSale: true }),
    };
    const service = new OrganizationsService(repo);

    const updated = await service.updateSettings("org-1", { requireShiftForPosSale: true });

    expect(updated.requireShiftForPosSale).toBe(true);
    expect(repo.updateSettings).toHaveBeenCalledWith("org-1", { requireShiftForPosSale: true });
  });

  test("throws NotFoundException when the organization doesn't exist", async () => {
    const repo: OrganizationsRepository = {
      vatNumberExists: jest.fn(),
      createOrganizationWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
      updateSettings: jest.fn(),
    };
    const service = new OrganizationsService(repo);

    await expect(service.updateSettings("ghost", { requireShiftForPosSale: true })).rejects.toThrow(NotFoundException);
    expect(repo.updateSettings).not.toHaveBeenCalled();
  });

  test.each([
    [{ vatNumber: "123" }, "VAT number"],
    [{ buildingNumber: "12" }, "building number"],
    [{ postalZone: "1234" }, "postal code"],
    [{ defaultReceiptTemplate: "poster" as any }, "receipt template"],
  ])("rejects invalid Saudi invoice settings: %s", async (settings, message) => {
    const repo: OrganizationsRepository = {
      vatNumberExists: jest.fn(),
      createOrganizationWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: "org-1", legalNameAr: "شركة الاختبار" }),
      updateSettings: jest.fn(),
    };
    const service = new OrganizationsService(repo);

    await expect(service.updateSettings("org-1", settings)).rejects.toThrow(BadRequestException);
    await expect(service.updateSettings("org-1", settings)).rejects.toThrow(message);
    expect(repo.updateSettings).not.toHaveBeenCalled();
  });

  test("normalizes and persists a valid invoice template configuration", async () => {
    const repo: OrganizationsRepository = {
      vatNumberExists: jest.fn(),
      createOrganizationWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: "org-1", legalNameAr: "شركة الاختبار" }),
      updateSettings: jest.fn().mockImplementation(async (_id, settings) => ({ id: "org-1", legalNameAr: "شركة الاختبار", ...settings })),
    };
    const service = new OrganizationsService(repo);

    const updated = await service.updateSettings("org-1", {
      invoiceTemplateConfig: {
        accentColor: "#123ABC",
        documentTitle: "  فاتورة ضريبية  ",
        showCommercialName: true,
        showCrNumber: true,
        showCustomerDetails: true,
        showPaymentSummary: false,
        showQr: true,
        compactLines: false,
      },
    });

    expect(updated.invoiceTemplateConfig?.documentTitle).toBe("فاتورة ضريبية");
    expect(repo.updateSettings).toHaveBeenCalledWith("org-1", expect.objectContaining({
      invoiceTemplateConfig: expect.objectContaining({ accentColor: "#123ABC", showPaymentSummary: false }),
    }));
  });

  test("rejects unsafe invoice logo URLs", async () => {
    const repo: OrganizationsRepository = {
      vatNumberExists: jest.fn(),
      createOrganizationWithOwner: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: "org-1", legalNameAr: "شركة الاختبار" }),
      updateSettings: jest.fn(),
    };
    const service = new OrganizationsService(repo);
    await expect(service.updateSettings("org-1", {
      invoiceTemplateConfig: {
        accentColor: "#073f3e", documentTitle: "فاتورة", logoUrl: "javascript:alert(1)",
        showCommercialName: true, showCrNumber: true, showCustomerDetails: true,
        showPaymentSummary: true, showQr: true, compactLines: false,
      },
    })).rejects.toThrow("logo");
  });
});
