import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";

export interface OpenShiftInput {
  organizationId: string;
  terminalId: string;
  cashierUserId: string;
  openingCash: number;
}

export interface CloseShiftInput {
  organizationId: string;
  shiftId: string;
  actualCash: number;
}

export interface ShiftRecord {
  id: string;
  organizationId: string;
  terminalId: string;
  cashierUserId: string;
  openingCash: string;
  /** Populated incrementally as POS sales/returns happen on this shift — see PosService integration note below. */
  cashSalesTotal: string;
  cashReturnsTotal: string;
  status: "OPEN" | "CLOSED";
  actualCash?: string;
  expectedCash?: string;
  cashDifference?: string;
}

export interface ShiftsRepository {
  create(record: Omit<ShiftRecord, "id">): Promise<ShiftRecord>;
  findById(organizationId: string, shiftId: string): Promise<ShiftRecord | null>;
  findOpenShiftForTerminal(organizationId: string, terminalId: string): Promise<ShiftRecord | null>;
  update(shiftId: string, patch: Partial<ShiftRecord>): Promise<ShiftRecord>;
}

function round2(value: number): string {
  return value.toFixed(2);
}

/**
 * Spec band 42. Deliberately NOT wired into PosService.sell()/returnSale()
 * in this sprint — a shift's running cash totals (cashSalesTotal /
 * cashReturnsTotal) are tracked here as fields a caller CAN update, but
 * PosService itself doesn't call ShiftsService yet. Doing that integration
 * properly means deciding how a sale associates with "the currently open
 * shift for this terminal" without silently guessing, which is a product
 * decision (spec band 149: REQUIRES_COMPLIANCE_REVIEW-style judgment call)
 * better made explicitly next sprint than assumed here.
 */
@Injectable()
export class ShiftsService {
  constructor(private readonly repo: ShiftsRepository) {}

  async openShift(input: OpenShiftInput): Promise<ShiftRecord> {
    if (input.openingCash < 0) {
      throw new BadRequestException("Opening cash cannot be negative");
    }

    const existingOpen = await this.repo.findOpenShiftForTerminal(input.organizationId, input.terminalId);
    if (existingOpen) {
      throw new BadRequestException(
        `Terminal ${input.terminalId} already has an open shift (${existingOpen.id}) — close it before opening a new one`,
      );
    }

    return this.repo.create({
      organizationId: input.organizationId,
      terminalId: input.terminalId,
      cashierUserId: input.cashierUserId,
      openingCash: round2(input.openingCash),
      cashSalesTotal: "0.00",
      cashReturnsTotal: "0.00",
      status: "OPEN",
    });
  }

  /**
   * Expected cash = opening + cash sales - cash returns (spec band 42).
   * Difference = actual - expected; reported, never silently absorbed,
   * per band 151 ("النسخة الاحتياطية يمكن استعادتها" spirit — a cash
   * variance must be visible and traceable, not hidden).
   */
  async closeShift(input: CloseShiftInput): Promise<ShiftRecord> {
    const shift = await this.repo.findById(input.organizationId, input.shiftId);
    if (!shift) {
      throw new NotFoundException(`Shift ${input.shiftId} not found`);
    }
    if (shift.status === "CLOSED") {
      throw new BadRequestException(`Shift ${input.shiftId} is already closed`);
    }

    const expectedCash =
      Number(shift.openingCash) + Number(shift.cashSalesTotal) - Number(shift.cashReturnsTotal);
    const cashDifference = input.actualCash - expectedCash;

    return this.repo.update(input.shiftId, {
      status: "CLOSED",
      actualCash: round2(input.actualCash),
      expectedCash: round2(expectedCash),
      cashDifference: round2(cashDifference),
    });
  }

  async getShift(organizationId: string, shiftId: string): Promise<ShiftRecord | null> {
    return this.repo.findById(organizationId, shiftId);
  }

  /**
   * Records a cash sale or cash return against an OPEN shift's running
   * totals — this is the integration point PosService now calls (spec
   * band 42's "Sales"/"Returns"/"Expected Cash" fields), decided
   * explicitly this sprint: a shift is opt-in per sale via `shiftId`
   * (see PosService.sell()'s header comment for the reasoning), not
   * mandatory for every POS sale.
   */
  async recordCashMovement(
    organizationId: string,
    shiftId: string,
    type: "SALE" | "RETURN",
    cashAmount: number,
  ): Promise<ShiftRecord> {
    if (cashAmount <= 0) {
      return this.getShiftOrThrow(organizationId, shiftId); // nothing to record — no cash tender on this transaction
    }

    const shift = await this.getShiftOrThrow(organizationId, shiftId);
    if (shift.status !== "OPEN") {
      throw new BadRequestException(`Cannot record a cash movement against shift ${shiftId}: it is not OPEN`);
    }

    const field = type === "SALE" ? "cashSalesTotal" : "cashReturnsTotal";
    const newTotal = Number(shift[field]) + cashAmount;

    return this.repo.update(shiftId, { [field]: round2(newTotal) } as Partial<ShiftRecord>);
  }

  private async getShiftOrThrow(organizationId: string, shiftId: string): Promise<ShiftRecord> {
    const shift = await this.repo.findById(organizationId, shiftId);
    if (!shift) {
      throw new NotFoundException(`Shift ${shiftId} not found`);
    }
    return shift;
  }
}
