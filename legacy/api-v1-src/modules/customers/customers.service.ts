import { BadRequestException, Injectable } from "@nestjs/common";

export interface CreateCustomerInput {
  organizationId: string;
  name: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
  crNumber?: string;
  streetName?: string;
  buildingNumber?: string;
  city?: string;
  postalZone?: string;
  district?: string;
  countryCode?: string;
}

export interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
  crNumber?: string;
  streetName?: string;
  buildingNumber?: string;
  city?: string;
  postalZone?: string;
  district?: string;
  countryCode?: string;
}

/**
 * Phase 0 scope only — spec band 21 also calls for CR number, national
 * address, contacts, payment terms, credit limit, currency, opening
 * balance, statements, aging, and attachments. Deliberately not modeled
 * yet: this exists only to give SalesService a real customer to bill,
 * not to be the finished Customers module.
 */
export interface CustomersRepository {
  create(input: CreateCustomerInput): Promise<CustomerRow>;
  findById(organizationId: string, customerId: string): Promise<CustomerRow | null>;
  listForOrganization(organizationId: string): Promise<CustomerRow[]>;
}

@Injectable()
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  async createCustomer(input: CreateCustomerInput): Promise<CustomerRow> {
    if (!input.name?.trim()) {
      throw new BadRequestException("Customer name is required");
    }
    validateSaudiInvoiceIdentity(input);
    return this.repo.create(input);
  }

  async listCustomers(organizationId: string): Promise<CustomerRow[]> {
    return this.repo.listForOrganization(organizationId);
  }

  async getCustomer(organizationId: string, customerId: string): Promise<CustomerRow | null> {
    return this.repo.findById(organizationId, customerId);
  }
}

function validateSaudiInvoiceIdentity(input: Pick<CreateCustomerInput, "vatNumber" | "buildingNumber" | "postalZone" | "countryCode">): void {
  if (input.vatNumber && !/^3\d{13}3$/.test(input.vatNumber)) {
    throw new BadRequestException("VAT number must contain 15 digits and start and end with 3");
  }
  if (input.buildingNumber && !/^\d{4}$/.test(input.buildingNumber)) {
    throw new BadRequestException("National address building number must contain 4 digits");
  }
  if (input.postalZone && !/^\d{5}$/.test(input.postalZone)) {
    throw new BadRequestException("National address postal code must contain 5 digits");
  }
  if (input.countryCode && !/^[A-Z]{2}$/.test(input.countryCode)) {
    throw new BadRequestException("Country code must use two uppercase ISO letters");
  }
}
