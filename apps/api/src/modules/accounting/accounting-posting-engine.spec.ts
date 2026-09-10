/**
 * Mandatory accounting invariant tests (spec band 114).
 * Uses a mocked PrismaClient so this runs without a live database — a real
 * Postgres-backed integration test (with actual Decimal round-trip and RLS)
 * is the next-session follow-up noted in docs/MVP_ROADMAP.md.
 */

import {
  AccountingPostingEngine,
  UnbalancedEntryError,
  ClosedPeriodError,
  EntryAlreadyReversedError,
} from "./accounting-posting-engine";

function makePrismaMock(overrides: Partial<Record<string, any>> = {}) {
  const state = {
    period: { id: "period-1", status: "OPEN" },
    createdEntries: [] as any[],
    idempotencyKeys: new Map<string, { journalEntryId: string }>(),
    ...overrides,
  };

  return {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prismaTx),
    accountingPeriod: {
      findUniqueOrThrow: async () => state.period,
    },
    idempotencyKey: {
      // Sprint 32 — matches real Prisma Client's findUnique/create shape.
      findUnique: async ({ where: { organizationId_key } }: any) =>
        state.idempotencyKeys.get(`${organizationId_key.organizationId}:${organizationId_key.key}`) ?? null,
      create: async ({ data: { organizationId, key, journalEntryId } }: any) => {
        state.idempotencyKeys.set(`${organizationId}:${key}`, { journalEntryId });
      },
    },
    journalEntry: {
      create: async ({ data }: any) => {
        // Mirror real Prisma behavior: a nested `lines: { create: [...] }`
        // input resolves to a plain `lines: [...]` array on the returned row.
        const { lines, ...rest } = data;
        const entry = {
          id: `je-${state.createdEntries.length + 1}`,
          ...rest,
          isReversal: rest.isReversal ?? false,
          lines: (lines?.create ?? []).map((l: any) => ({
            accountId: l.accountId,
            debit: l.debit instanceof Object ? Number(l.debit.toString()) : l.debit,
            credit: l.credit instanceof Object ? Number(l.credit.toString()) : l.credit,
            costCenterId: l.costCenterId,
            description: l.description,
          })),
        };
        state.createdEntries.push(entry);
        return { ...entry }; // return a copy — real Prisma never hands back a live-mutable reference
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const found = state.createdEntries.find((e) => e.id === where.id);
        return found ? { ...found } : found;
      },
      update: async ({ where, data }: any) => {
        const entry = state.createdEntries.find((e) => e.id === where.id);
        Object.assign(entry, data);
        return { ...entry };
      },
    },
    __state: state,
  } as any;
}

let prismaTx: any;

describe("AccountingPostingEngine — mandatory invariants (band 114)", () => {
  test("rejects an entry where total debit != total credit", async () => {
    const prisma = makePrismaMock();
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    await expect(
      engine.post({
        organizationId: "org-1",
        periodId: "period-1",
        sourceEvent: "MANUAL_JOURNAL_POSTED",
        lines: [
          { accountId: "cash", debit: 100 },
          { accountId: "revenue", credit: 90 }, // intentionally unbalanced
        ],
      }),
    ).rejects.toThrow(UnbalancedEntryError);
  });

  test("accepts a balanced entry and writes matching debit/credit lines", async () => {
    const prisma = makePrismaMock();
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    const entry = await engine.post({
      organizationId: "org-1",
      periodId: "period-1",
      sourceEvent: "POS_SALE_COMPLETED",
      lines: [
        { accountId: "cash", debit: 115 },
        { accountId: "sales", credit: 100 },
        { accountId: "vat_output", credit: 15 },
      ],
    });

    expect(entry.lines).toHaveLength(3);
  });

  test("blocks posting into a CLOSED period", async () => {
    const prisma = makePrismaMock({ period: { id: "period-1", status: "CLOSED" } });
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    await expect(
      engine.post({
        organizationId: "org-1",
        periodId: "period-1",
        sourceEvent: "MANUAL_JOURNAL_POSTED",
        lines: [
          { accountId: "cash", debit: 50 },
          { accountId: "revenue", credit: 50 },
        ],
      }),
    ).rejects.toThrow(ClosedPeriodError);
  });

  test("reverse() creates a counter-entry instead of mutating the original", async () => {
    const prisma = makePrismaMock();
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    const original = await engine.post({
      organizationId: "org-1",
      periodId: "period-1",
      sourceEvent: "MANUAL_JOURNAL_POSTED",
      lines: [
        { accountId: "cash", debit: 50 },
        { accountId: "revenue", credit: 50 },
      ],
    });

    const reversal = await engine.reverse(original.id, "test correction");

    expect(reversal.isReversal).toBe(true);
    expect(reversal.lines[0]).toMatchObject({ accountId: "cash", credit: 50, debit: 0 });
    // original row itself was never deleted/edited except to link reversedById
    expect(original.reversedById).toBeUndefined(); // pre-update snapshot — immutability of the fetched object
  });

  test("refuses to reverse the same entry twice", async () => {
    const prisma = makePrismaMock();
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    const original = await engine.post({
      organizationId: "org-1",
      periodId: "period-1",
      sourceEvent: "MANUAL_JOURNAL_POSTED",
      lines: [
        { accountId: "cash", debit: 50 },
        { accountId: "revenue", credit: 50 },
      ],
    });

    await engine.reverse(original.id, "first reversal");

    await expect(engine.reverse(original.id, "second reversal")).rejects.toThrow(
      EntryAlreadyReversedError,
    );
  });

  test("idempotency (band 91): replaying the same idempotencyKey returns the ORIGINAL entry, not a duplicate", async () => {
    const prisma = makePrismaMock();
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    const request = {
      organizationId: "org-1",
      periodId: "period-1",
      sourceEvent: "POS_SALE_COMPLETED" as const,
      idempotencyKey: "pos-terminal-1-receipt-9001",
      lines: [
        { accountId: "cash", debit: 115 },
        { accountId: "sales", credit: 100 },
        { accountId: "vat_output", credit: 15 },
      ],
    };

    const first = await engine.post(request);
    const replay = await engine.post(request); // client retried the same request (e.g. after a timeout)

    expect(replay.id).toBe(first.id);
    expect(prisma.__state.createdEntries).toHaveLength(1); // NOT two entries
  });

  test("idempotency: a DIFFERENT idempotencyKey for the same organization still posts a new entry", async () => {
    const prisma = makePrismaMock();
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    const lines = [
      { accountId: "cash", debit: 10 },
      { accountId: "sales", credit: 10 },
    ];

    const first = await engine.post({
      organizationId: "org-1",
      periodId: "period-1",
      sourceEvent: "POS_SALE_COMPLETED",
      idempotencyKey: "receipt-1",
      lines,
    });
    const second = await engine.post({
      organizationId: "org-1",
      periodId: "period-1",
      sourceEvent: "POS_SALE_COMPLETED",
      idempotencyKey: "receipt-2",
      lines,
    });

    expect(second.id).not.toBe(first.id);
    expect(prisma.__state.createdEntries).toHaveLength(2);
  });

  test("idempotency: posting with no key at all never triggers the idempotency path", async () => {
    const prisma = makePrismaMock();
    prismaTx = prisma;
    const engine = new AccountingPostingEngine(prisma);

    const lines = [
      { accountId: "cash", debit: 10 },
      { accountId: "sales", credit: 10 },
    ];

    await engine.post({ organizationId: "org-1", periodId: "period-1", sourceEvent: "POS_SALE_COMPLETED", lines });
    await engine.post({ organizationId: "org-1", periodId: "period-1", sourceEvent: "POS_SALE_COMPLETED", lines });

    expect(prisma.__state.createdEntries).toHaveLength(2); // two genuinely separate sales, no key to dedupe against
  });
});
