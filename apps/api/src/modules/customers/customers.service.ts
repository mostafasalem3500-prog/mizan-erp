import { Injectable } from "@nestjs/common";

export interface CreateCustomerInput {
  organizationId: string;
  name: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
}

export interface CustomerRow {
  id: string;
  organizationId: string;
  name: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
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
    return this.repo.create(input);
  }

  async listCustomers(organizationId: string): Promise<CustomerRow[]> {
    return this.repo.listForOrganization(organizationId);
  }

  async getCustomer(organizationId: string, customerId: string): Promise<CustomerRow | null> {
    return this.repo.findById(organizationId, customerId);
  }
}
