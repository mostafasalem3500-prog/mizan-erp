import { BadRequestException, Injectable } from "@nestjs/common";

export interface PeriodRow {
  id: string;
  organizationId: string;
  status: "OPEN" | "SOFT_CLOSED" | "CLOSED" | "LOCKED";
  startDate: string;
  endDate: string;
}

export interface CreatePeriodInput {
  organizationId: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface PeriodsRepository {
  listForOrganization(organizationId: string): Promise<PeriodRow[]>;
  create(input: CreatePeriodInput): Promise<PeriodRow>;
}

/**
 * Spec band 18. Read side lists periods so a UI can offer a picker
 * instead of requiring the period id to be known in advance. The write
 * side (Sprint 31) closes a real usability gap: until now, exactly one
 * period was ever seeded per organization at creation time, with no way
 * to open a new one — meaning any business using this build past its
 * first period's end date would have nowhere to post new transactions.
 */
@Injectable()
export class PeriodsService {
  constructor(private readonly repo: PeriodsRepository) {}

  async listPeriods(organizationId: string): Promise<PeriodRow[]> {
    return this.repo.listForOrganization(organizationId);
  }

  async createPeriod(input: CreatePeriodInput): Promise<PeriodRow> {
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("startDate and endDate must be valid dates");
    }
    if (end <= start) {
      throw new BadRequestException("endDate must be after startDate");
    }

    const existing = await this.repo.listForOrganization(input.organizationId);
    const overlaps = existing.some((p) => {
      const pStart = new Date(p.startDate);
      const pEnd = new Date(p.endDate);
      return start < pEnd && end > pStart; // standard interval-overlap check
    });
    if (overlaps) {
      throw new BadRequestException("The new period's date range overlaps an existing period for this organization");
    }

    return this.repo.create(input);
  }
}
