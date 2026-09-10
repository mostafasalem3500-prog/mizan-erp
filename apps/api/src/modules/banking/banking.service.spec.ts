import { BadRequestException } from "@nestjs/common";
import { BankingService } from "./banking.service";
import { AccountsService } from "../accounts/accounts.service";

function makeAccounts() {
  const codeToId: Record<string, string> = { "1100": "acc-cash", "1110": "acc-bank" };
  return { getAccountIdByCode: jest.fn().mockImplementation(async (_o: string, code: string) => codeToId[code]) } as unknown as AccountsService;
}
function makeEngine() {
  const calls: any[] = [];
  return { engine: { post: jest.fn().mockImplementation(async (r: any) => { calls.push(r); return { id: "je-1", ...r }; }) }, calls };
}

describe("BankingService.transfer (spec band 51)", () => {
  test("posts Dr toAccount / Cr fromAccount", async () => {
    const { engine, calls } = makeEngine();
    const service = new BankingService(engine as any, makeAccounts());

    await service.transfer({ organizationId: "org-1", periodId: "period-1", fromAccountCode: "1100", toAccountCode: "1110", amount: 500 });

    expect(calls[0].sourceEvent).toBe("BANK_TRANSFER");
    expect(calls[0].lines).toEqual([{ accountId: "acc-bank", debit: "500.00" }, { accountId: "acc-cash", credit: "500.00" }]);
  });

  test("rejects a non-positive amount", async () => {
    const service = new BankingService(makeEngine().engine as any, makeAccounts());
    await expect(service.transfer({ organizationId: "org-1", periodId: "period-1", fromAccountCode: "1100", toAccountCode: "1110", amount: 0 })).rejects.toThrow(BadRequestException);
  });

  test("rejects transferring an account to itself", async () => {
    const service = new BankingService(makeEngine().engine as any, makeAccounts());
    await expect(service.transfer({ organizationId: "org-1", periodId: "period-1", fromAccountCode: "1100", toAccountCode: "1100", amount: 10 })).rejects.toThrow(/itself/);
  });
});
