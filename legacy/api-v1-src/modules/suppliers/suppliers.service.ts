import { Injectable } from "@nestjs/common";

export interface CreateSupplierInput {
  organizationId: string;
  name: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
}

export interface SupplierRow {
  id: string;
  organizationId: string;
  name: string;
  vatNumber?: string;
  phone?: string;
  email?: string;
}

/** Phase 0 scope only — see customers.service.ts's header comment; the same limitations apply here. */
export interface SuppliersRepository {
  create(input: CreateSupplierInput): Promise<SupplierRow>;
  findById(organizationId: string, supplierId: string): Promise<SupplierRow | null>;
  listForOrganization(organizationId: string): Promise<SupplierRow[]>;
}

@Injectable()
export class SuppliersService {
  constructor(private readonly repo: SuppliersRepository) {}

  async createSupplier(input: CreateSupplierInput): Promise<SupplierRow> {
    return this.repo.create(input);
  }

  async getSupplier(organizationId: string, supplierId: string): Promise<SupplierRow | null> {
    return this.repo.findById(organizationId, supplierId);
  }

  async listSuppliers(organizationId: string): Promise<SupplierRow[]> {
    return this.repo.listForOrganization(organizationId);
  }
}
