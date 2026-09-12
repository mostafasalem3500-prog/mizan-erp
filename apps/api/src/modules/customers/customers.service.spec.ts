import { BadRequestException } from "@nestjs/common";
import { CustomersRepository, CustomersService } from "./customers.service";

describe("CustomersService — Saudi invoice identity", () => {
  function makeRepo(): CustomersRepository {
    return {
      create: jest.fn().mockImplementation(async (input) => ({ id: "customer-1", ...input })),
      findById: jest.fn(),
      listForOrganization: jest.fn(),
    };
  }

  test("accepts invoice-ready customer identity and national address", async () => {
    const repo = makeRepo();
    const service = new CustomersService(repo);
    const customer = await service.createCustomer({
      organizationId: "org-1",
      name: "شركة العميل",
      vatNumber: "300000000000003",
      buildingNumber: "1234",
      postalZone: "12345",
      countryCode: "SA",
    });

    expect(customer.id).toBe("customer-1");
    expect(repo.create).toHaveBeenCalled();
  });

  test.each([
    [{ name: "عميل", vatNumber: "300" }, "VAT number"],
    [{ name: "عميل", buildingNumber: "123" }, "building number"],
    [{ name: "عميل", postalZone: "1234" }, "postal code"],
    [{ name: "عميل", countryCode: "Saudi Arabia" }, "Country code"],
    [{ name: "  " }, "Customer name"],
  ])("rejects invalid customer identity: %s", async (fields, message) => {
    const repo = makeRepo();
    const service = new CustomersService(repo);

    await expect(service.createCustomer({ organizationId: "org-1", ...fields })).rejects.toThrow(BadRequestException);
    await expect(service.createCustomer({ organizationId: "org-1", ...fields })).rejects.toThrow(message);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
