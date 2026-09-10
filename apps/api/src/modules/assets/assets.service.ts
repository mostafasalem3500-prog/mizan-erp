import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AccountingPostingEngine } from "../accounting/accounting-posting-engine";
import { AccountsService } from "../accounts/accounts.service";

export interface AcquireAssetInput {
  organizationId: string;
  periodId: string;
  name: string;
  cost: number;
  residualValue: number;
  usefulLifeMonths: number;
  paymentAccountCode: string; // e.g. "1100" Cash, "2100" AP if unpaid
  idempotencyKey?: string;
}

export interface DepreciateAssetInput {
  organizationId: string;
  periodId: string;
  assetId: string;
  amount?: number; // explicit override; defaults to the straight-line monthly amount
  idempotencyKey?: string;
}

export interface AssetRecord {
  id: string;
  organizationId: string;
  name: string;
  cost: string;
  residualValue: string;
  usefulLifeMonths: number;
  accumulatedDepreciation: string;
  acquisitionJournalEntryId: string;
}

export interface AssetsRepository {
  save(record: AssetRecord): Promise<AssetRecord>;
  findById(organizationId: string, assetId: string): Promise<AssetRecord | null>;
}

function round2(v: number): string {
  return v.toFixed(2);
}

/** Straight-line monthly depreciation (spec band 50) — (cost - residual) / useful life in months. */
export function straightLineMonthlyDepreciation(cost: number, residualValue: number, usefulLifeMonths: number): number {
  if (usefulLifeMonths <= 0) throw new BadRequestException("Useful life must be a positive number of months");
  return (cost - residualValue) / usefulLifeMonths;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly postingEngine: AccountingPostingEngine,
    private readonly accountsService: AccountsService,
    private readonly repo: AssetsRepository,
  ) {}

  /** Dr Fixed Asset / Cr Payment Account (spec band 123's ASSET_ACQUIRED row). */
  async acquireAsset(input: AcquireAssetInput): Promise<AssetRecord> {
    if (input.cost <= 0) throw new BadRequestException("Asset cost must be positive");
    if (input.residualValue < 0) throw new BadRequestException("Residual value cannot be negative");
    if (input.residualValue >= input.cost) throw new BadRequestException("Residual value must be less than cost");

    const assetAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, "1500");
    const paymentAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, input.paymentAccountCode);

    const entry = await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "ASSET_ACQUIRED",
      reference: `Asset acquired: ${input.name}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: assetAccountId, debit: round2(input.cost) },
        { accountId: paymentAccountId, credit: round2(input.cost) },
      ],
    });

    return this.repo.save({
      id: entry.id,
      organizationId: input.organizationId,
      name: input.name,
      cost: round2(input.cost),
      residualValue: round2(input.residualValue),
      usefulLifeMonths: input.usefulLifeMonths,
      accumulatedDepreciation: "0.00",
      acquisitionJournalEntryId: entry.id,
    });
  }

  /**
   * Dr Depreciation Expense / Cr Accumulated Depreciation. Rejects
   * depreciating past the depreciable base (cost - residual) — an asset's
   * book value can approach but never go below its residual value.
   */
  async depreciateAsset(input: DepreciateAssetInput): Promise<AssetRecord> {
    const asset = await this.repo.findById(input.organizationId, input.assetId);
    if (!asset) throw new NotFoundException(`Asset ${input.assetId} not found`);

    const amount = input.amount ?? straightLineMonthlyDepreciation(Number(asset.cost), Number(asset.residualValue), asset.usefulLifeMonths);
    if (amount <= 0) throw new BadRequestException("Depreciation amount must be positive");

    const depreciableBase = Number(asset.cost) - Number(asset.residualValue);
    const newAccumulated = Number(asset.accumulatedDepreciation) + amount;
    if (newAccumulated > depreciableBase + 0.005) {
      throw new BadRequestException(
        `Depreciation of ${amount.toFixed(2)} would take accumulated depreciation (${newAccumulated.toFixed(2)}) past the depreciable base (${depreciableBase.toFixed(2)})`,
      );
    }

    const depreciationExpenseAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, "6200");
    const accumulatedDepreciationAccountId = await this.accountsService.getAccountIdByCode(input.organizationId, "1510");

    await this.postingEngine.post({
      organizationId: input.organizationId,
      periodId: input.periodId,
      sourceEvent: "ASSET_DEPRECIATED",
      reference: `Depreciation: ${asset.name}`,
      idempotencyKey: input.idempotencyKey,
      lines: [
        { accountId: depreciationExpenseAccountId, debit: round2(amount) },
        { accountId: accumulatedDepreciationAccountId, credit: round2(amount) },
      ],
    });

    return this.repo.save({ ...asset, accumulatedDepreciation: round2(newAccumulated) });
  }

  async getAsset(organizationId: string, assetId: string): Promise<AssetRecord | null> {
    return this.repo.findById(organizationId, assetId);
  }
}
