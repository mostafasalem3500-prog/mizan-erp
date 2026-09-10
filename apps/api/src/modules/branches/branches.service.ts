import { ConflictException, Injectable } from "@nestjs/common";

export interface CreateBranchInput {
  organizationId: string;
  code: string;
  name: string;
  address?: string;
}

export interface BranchRow {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  address?: string;
  isActive: boolean;
}

/**
 * Spec band 6: branch code is unique WITHIN an organization, not globally —
 * two different organizations can both have a branch coded "01".
 */
export interface BranchesRepository {
  codeExistsForOrganization(organizationId: string, code: string): Promise<boolean>;
  create(input: CreateBranchInput): Promise<BranchRow>;
  listForOrganization(organizationId: string): Promise<BranchRow[]>;
}

@Injectable()
export class BranchesService {
  constructor(private readonly repo: BranchesRepository) {}

  async createBranch(input: CreateBranchInput): Promise<BranchRow> {
    const exists = await this.repo.codeExistsForOrganization(input.organizationId, input.code);
    if (exists) {
      throw new ConflictException(
        `Branch code "${input.code}" already exists for this organization`,
      );
    }
    return this.repo.create(input);
  }

  async listBranches(organizationId: string): Promise<BranchRow[]> {
    return this.repo.listForOrganization(organizationId);
  }
}
