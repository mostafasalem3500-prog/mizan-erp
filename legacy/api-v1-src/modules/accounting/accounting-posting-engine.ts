/**
 * AccountingPostingEngine
 *
 * THE single writer to journal_entries / journal_entry_lines.
 * No other module (sales, pos, purchases, expenses, assets, banking) is
 * permitted to insert into these tables directly — see docs/ARCHITECTURE.md §4.
 *
 * Invariants enforced here, not left to callers:
 *   1. Total Debit === Total Credit for every entry (bands 14-15).
 *   2. The target accounting period must be OPEN (band 18) — posting into a
 *      SOFT_CLOSED / CLOSED / LOCKED period is rejected.
 *   3. The whole write happens in one DB transaction (band 16) — a caller
 *      that bundles inventory movement + payment + journal lines must pass
 *      them all in one PostingRequest so they commit or roll back together.
 *   4. Posted entries are immutable (band 17) — correction happens only via
 *      `reverse()`, which creates a new counter-entry; it never mutates the
 *      original rows.
 *
 * This file is intentionally framework-light (no NestJS decorators yet) so
 * it can be unit-tested in isolation before being wired into a NestJS
 * provider in the next implementation session.
 */

/**
 * This file intentionally does NOT import types from "@prisma/client".
 * Prisma's generated client requires downloading a native query-engine
 * binary, which is unavailable in this sandboxed session (and irrelevant
 * to unit-testing the posting logic itself). The interfaces below describe
 * exactly the subset of the generated client this engine touches; the real
 * PrismaClient produced by `npx prisma generate` against schema.prisma
 * satisfies this shape structurally, so no change is needed here when a
 * real database is wired up in the next session.
 */

export type JournalSourceEvent =
  | "MANUAL_JOURNAL_POSTED"
  | "SALE_INVOICE_POSTED"
  | "POS_SALE_COMPLETED"
  | "POS_RETURN_COMPLETED"
  | "PURCHASE_BILL_POSTED"
  | "PURCHASE_RETURN_COMPLETED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_PAID"
  | "EXPENSE_POSTED"
  | "INVENTORY_RECEIVED"
  | "INVENTORY_ISSUED"
  | "STOCK_ADJUSTED"
  | "ASSET_ACQUIRED"
  | "ASSET_DEPRECIATED"
  | "BANK_TRANSFER"
  | "PERIOD_CLOSED";

interface AccountingPeriodRow {
  id: string;
  status: "OPEN" | "SOFT_CLOSED" | "CLOSED" | "LOCKED";
}

interface JournalEntryLineRow {
  accountId: string;
  debit: unknown;
  credit: unknown;
  costCenterId?: string | null;
  description?: string | null;
}

export interface JournalEntryRow {
  id: string;
  organizationId: string;
  branchId?: string | null;
  periodId: string;
  sourceEvent: JournalSourceEvent;
  sourceDocId?: string | null;
  reference?: string | null;
  isReversal: boolean;
  reversedById?: string | null;
  lines: JournalEntryLineRow[];
}

export interface PrismaTransactionClient {
  [delegate: string]: any;
  accountingPeriod: {
    findUniqueOrThrow(args: { where: { id: string } }): Promise<AccountingPeriodRow>;
  };
  journalEntry: {
    create(args: { data: any; include?: any }): Promise<JournalEntryRow>;
    findUniqueOrThrow(args: { where: { id: string }; include?: any }): Promise<JournalEntryRow>;
    update(args: { where: { id: string }; data: any }): Promise<JournalEntryRow>;
  };
  /**
   * Backs the idempotency guarantee required by spec band 91 ("Repeated
   * Request لا ينتج Duplicate Financial Transaction"). A real schema adds
   * an `idempotency_keys` table with a unique constraint on
   * (organizationId, key) — see schema.prisma. `create` must throw (or the
   * caller must treat a unique-constraint violation as "already posted")
   * when the same key is used twice; this in-process engine handles that
   * by checking `findUnique` first inside the same transaction.
   *
   * Sprint 32 — these signatures were rewritten to match REAL Prisma
   * Client's actual API exactly (`findUnique` with the auto-generated
   * compound-key name from `@@id([organizationId, key])`, and `create`
   * wrapped in `{ data: ... }`) rather than a convenience shape invented
   * for the in-memory shim. This is what makes swapping in a genuine
   * `PrismaClient` instance a drop-in change instead of a rewrite: the
   * in-memory shim in in-memory-repositories.ts was updated to match this
   * same real-Prisma-shaped interface, so both paths are now identical
   * from this engine's point of view.
   */
  idempotencyKey: {
    findUnique(args: {
      where: { organizationId_key: { organizationId: string; key: string } };
    }): Promise<{ journalEntryId: string } | null>;
    create(args: { data: { organizationId: string; key: string; journalEntryId: string } }): Promise<void>;
  };
}

export interface PrismaClientLike {
  $transaction<T>(fn: (tx: PrismaTransactionClient) => Promise<T>, options?: { isolationLevel?: "Serializable" }): Promise<T>;
}

export interface PreparedPosting<T> {
  request: PostingRequest;
  afterPost(tx: PrismaTransactionClient, entry: JournalEntryRow): Promise<T>;
}

/**
 * Minimal fixed-point decimal (4 dp, matching the schema's Decimal(18,4))
 * implemented over BigInt so posting-invariant checks never suffer float
 * rounding. Stands in for `@prisma/client`'s Decimal wrapper, which isn't
 * available without the native query-engine download (see note above).
 * `.plus`/`.equals`/`.toString()` shape is deliberately Decimal-compatible.
 */
class Decimal {
  private readonly scaled: bigint; // value * 10_000

  constructor(value: string | number | Decimal) {
    if (value instanceof Decimal) {
      this.scaled = value.scaled;
      return;
    }
    const str = typeof value === "number" ? value.toString() : value;
    const [whole, frac = ""] = str.split(".");
    const paddedFrac = (frac + "0000").slice(0, 4);
    const sign = whole.startsWith("-") ? -1n : 1n;
    const wholeAbs = whole.replace("-", "") || "0";
    this.scaled = sign * (BigInt(wholeAbs) * 10000n + BigInt(paddedFrac));
  }

  plus(other: Decimal): Decimal {
    const result = Object.create(Decimal.prototype) as Decimal;
    (result as any).scaled = this.scaled + other.scaled;
    return result;
  }

  equals(other: Decimal): boolean {
    return this.scaled === other.scaled;
  }

  toString(): string {
    const negative = this.scaled < 0n;
    const abs = negative ? -this.scaled : this.scaled;
    const whole = abs / 10000n;
    const frac = (abs % 10000n).toString().padStart(4, "0");
    return `${negative ? "-" : ""}${whole}.${frac}`;
  }
}

export interface PostingLineInput {
  accountId: string;
  debit?: string | number;   // accept string to avoid float precision loss at the API boundary
  credit?: string | number;
  costCenterId?: string;
  description?: string;
}

export interface PostingRequest {
  organizationId: string;
  branchId?: string;
  periodId: string;
  sourceEvent: JournalSourceEvent;
  sourceDocId?: string;
  reference?: string;
  lines: PostingLineInput[];
  /**
   * Optional client-supplied idempotency key (spec band 91). When the same
   * key is passed again for the same organization, `post()` returns the
   * ORIGINAL entry instead of creating a duplicate — no error, since a
   * client that retried a timed-out request should see the same success
   * response it would have gotten the first time.
   */
  idempotencyKey?: string;
}

export class UnbalancedEntryError extends Error {
  constructor(totalDebit: Decimal, totalCredit: Decimal) {
    super(
      `Journal entry rejected: total debit (${totalDebit.toString()}) ` +
        `!= total credit (${totalCredit.toString()}). Debit must equal ` +
        `credit for every posting (spec bands 14-15).`,
    );
  }
}

export class ClosedPeriodError extends Error {
  constructor(periodId: string, status: string) {
    super(
      `Cannot post to accounting period ${periodId}: status is ${status}, ` +
        `not OPEN (spec band 18).`,
    );
  }
}

export class EntryAlreadyReversedError extends Error {
  constructor(journalEntryId: string) {
    super(`Journal entry ${journalEntryId} has already been reversed.`);
  }
}

export class AccountingPostingEngine {
  constructor(private readonly prisma: PrismaClientLike) {}

  /**
   * Posts one balanced journal entry atomically. Throws before touching the
   * database if the entry does not balance, so a caller never sees a
   * "half-posted" state.
   */
  async post(request: PostingRequest) {
    this.assertBalanced(request.lines);

    return this.prisma.$transaction(async (tx) => {
      if (request.idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: { organizationId_key: { organizationId: request.organizationId, key: request.idempotencyKey } },
        });
        if (existing) {
          // Same request, replayed — return what was already posted rather
          // than posting it again (spec band 91). Not an error: an
          // idempotent replay is a successful no-op from the caller's view.
          return tx.journalEntry.findUniqueOrThrow({ where: { id: existing.journalEntryId } });
        }
      }

      const period = await tx.accountingPeriod.findUniqueOrThrow({
        where: { id: request.periodId },
      });

      const isAuthorizedClosingEntry = request.sourceEvent === "PERIOD_CLOSED" && period.status === "SOFT_CLOSED";
      if (period.status !== "OPEN" && !isAuthorizedClosingEntry) {
        throw new ClosedPeriodError(period.id, period.status);
      }

      const entry = await tx.journalEntry.create({
        data: {
          organizationId: request.organizationId,
          branchId: request.branchId,
          periodId: request.periodId,
          sourceEvent: request.sourceEvent,
          sourceDocId: request.sourceDocId,
          reference: request.reference,
          lines: {
            create: request.lines.map((line) => ({
              accountId: line.accountId,
              // Pass a Prisma-compatible scalar across the repository boundary.
              // The fixed-point Decimal above is deliberately an internal
              // arithmetic type; passing the object itself makes Prisma see
              // `{ scaled: bigint }` instead of a Decimal input and rejects
              // every real PostgreSQL posting.
              debit: new Decimal(line.debit ?? 0).toString(),
              credit: new Decimal(line.credit ?? 0).toString(),
              costCenterId: line.costCenterId,
              description: line.description,
            })),
          },
        },
        include: { lines: true },
      });

      if (request.idempotencyKey) {
        await tx.idempotencyKey.create({
          data: { organizationId: request.organizationId, key: request.idempotencyKey, journalEntryId: entry.id },
        });
      }

      return entry;
    });
  }

  /**
   * Builds and persists one posting together with its operational side
   * effects in the SAME serializable database transaction. The prepare
   * callback may lock/read stock and add COGS lines using the cost that is
   * current inside that transaction. `afterPost` then saves the source
   * document and stock/shift changes before commit.
   *
   * The idempotency lookup deliberately happens before `prepare`: a replay
   * therefore cannot deduct stock or increment a cash drawer twice. The
   * replay callback reads the already-committed source document and returns
   * the same business result as the first request.
   */
  async postPrepared<T>(
    identity: { organizationId: string; idempotencyKey?: string },
    prepare: (tx: PrismaTransactionClient) => Promise<PreparedPosting<T>>,
    onReplay: (tx: PrismaTransactionClient, entry: JournalEntryRow) => Promise<T>,
  ): Promise<T> {
    const execute = () => this.prisma.$transaction(async (tx) => {
      if (identity.idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: {
            organizationId_key: {
              organizationId: identity.organizationId,
              key: identity.idempotencyKey,
            },
          },
        });
        if (existing) {
          const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: existing.journalEntryId } });
          return onReplay(tx, entry);
        }
      }

      const prepared = await prepare(tx);
      const request = prepared.request;
      if (request.organizationId !== identity.organizationId) {
        throw new Error("Prepared posting organization does not match its transaction identity");
      }
      this.assertBalanced(request.lines);

      const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { id: request.periodId } });
      const isAuthorizedClosingEntry = request.sourceEvent === "PERIOD_CLOSED" && period.status === "SOFT_CLOSED";
      if (period.status !== "OPEN" && !isAuthorizedClosingEntry) {
        throw new ClosedPeriodError(period.id, period.status);
      }

      const entry = await tx.journalEntry.create({
        data: {
          organizationId: request.organizationId,
          branchId: request.branchId,
          periodId: request.periodId,
          sourceEvent: request.sourceEvent,
          sourceDocId: request.sourceDocId,
          reference: request.reference,
          lines: {
            create: request.lines.map((line) => ({
              accountId: line.accountId,
              debit: new Decimal(line.debit ?? 0).toString(),
              credit: new Decimal(line.credit ?? 0).toString(),
              costCenterId: line.costCenterId,
              description: line.description,
            })),
          },
        },
        include: { lines: true },
      });

      const result = await prepared.afterPost(tx, entry);
      if (identity.idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: identity.organizationId,
            key: identity.idempotencyKey,
            journalEntryId: entry.id,
          },
        });
      }
      return result;
    }, { isolationLevel: "Serializable" });

    // PostgreSQL may intentionally abort one of two concurrent serializable
    // stock transactions (Prisma P2034). Retrying the entire callback is
    // safe because the aborted attempt committed none of its side effects.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await execute();
      } catch (error: any) {
        const retryableConflict = error?.code === "P2034" || (identity.idempotencyKey && error?.code === "P2002");
        if (!retryableConflict || attempt === 3) throw error;
      }
    }
    throw new Error("Unreachable serializable transaction retry state");
  }

  /**
   * Creates a reversing entry (equal lines with debit/credit swapped) rather
   * than mutating or deleting the original — enforces immutability (band 17).
   */
  async reverse(journalEntryId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const original = await tx.journalEntry.findUniqueOrThrow({
        where: { id: journalEntryId },
        include: { lines: true },
      });

      if (original.reversedById) {
        throw new EntryAlreadyReversedError(journalEntryId);
      }

      const period = await tx.accountingPeriod.findUniqueOrThrow({ where: { id: original.periodId } });
      if (period.status !== "OPEN") {
        throw new ClosedPeriodError(period.id, period.status);
      }

      const reversal = await tx.journalEntry.create({
        data: {
          organizationId: original.organizationId,
          branchId: original.branchId,
          periodId: original.periodId,
          sourceEvent: original.sourceEvent,
          sourceDocId: original.sourceDocId,
          reference: `REVERSAL OF ${original.id}: ${reason}`,
          isReversal: true,
          lines: {
            create: original.lines.map((line) => ({
              accountId: line.accountId,
              debit: line.credit,   // swapped
              credit: line.debit,   // swapped
              costCenterId: line.costCenterId,
              description: `Reversal — ${line.description ?? ""}`.trim(),
            })),
          },
        },
        include: { lines: true },
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: { reversedById: reversal.id },
      });

      return reversal;
    });
  }

  private assertBalanced(lines: PostingLineInput[]) {
    const totalDebit = lines.reduce(
      (sum, l) => sum.plus(new Decimal(l.debit ?? 0)),
      new Decimal(0),
    );
    const totalCredit = lines.reduce(
      (sum, l) => sum.plus(new Decimal(l.credit ?? 0)),
      new Decimal(0),
    );

    if (!totalDebit.equals(totalCredit)) {
      throw new UnbalancedEntryError(totalDebit, totalCredit);
    }
  }
}
