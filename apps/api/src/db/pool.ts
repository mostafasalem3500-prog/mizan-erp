import { Pool, PoolClient, types } from "pg";

// numeric → JS number (amounts are stored with ≤4 decimals, well inside double precision);
// int8 (COUNT) → number; date → keep as 'YYYY-MM-DD' string (no TZ shifting).
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)) as any);
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)) as any);
types.setTypeParser(1082, (v) => v as any);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
});

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

function camelRow(row: any) {
  const out: any = {};
  for (const k of Object.keys(row)) out[camel(k)] = row[k];
  return out;
}

export class NotFoundError extends Error {
  status = 404;
}

/** Thin query helper over a pg client or pool: camelCase rows, snake_case writes. */
export class Db {
  private spCounter = 0;
  constructor(private readonly c: Pool | PoolClient) {}

  /** Runs fn inside a savepoint (only meaningful within tx): a thrown error rolls back just that part. */
  async savepoint<T>(fn: () => Promise<T>): Promise<T> {
    const name = `sp_${++this.spCounter}`;
    await this.c.query(`SAVEPOINT ${name}`);
    try {
      const r = await fn();
      await this.c.query(`RELEASE SAVEPOINT ${name}`);
      return r;
    } catch (e) {
      await this.c.query(`ROLLBACK TO SAVEPOINT ${name}`);
      throw e;
    }
  }

  async rows<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const r = await this.c.query(sql, params);
    return r.rows.map(camelRow);
  }
  async maybe<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const r = await this.rows<T>(sql, params);
    return r[0] ?? null;
  }
  async one<T = any>(sql: string, params: any[] = [], msg = "السجل غير موجود"): Promise<T> {
    const r = await this.maybe<T>(sql, params);
    if (!r) throw new NotFoundError(msg);
    return r;
  }
  async exec(sql: string, params: any[] = []): Promise<number> {
    const r = await this.c.query(sql, params);
    return r.rowCount ?? 0;
  }
  async insert<T = any>(table: string, obj: Record<string, any>): Promise<T> {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    const cols = keys.map((k) => `"${snake(k)}"`).join(",");
    const ph = keys.map((_, i) => `$${i + 1}`).join(",");
    const vals = keys.map((k) => jsonify(obj[k]));
    const r = await this.c.query(`INSERT INTO ${table} (${cols}) VALUES (${ph}) RETURNING *`, vals);
    return camelRow(r.rows[0]);
  }
  async insertMany(table: string, list: Record<string, any>[]): Promise<void> {
    if (!list.length) return;
    const keys = Object.keys(list[0]);
    const cols = keys.map((k) => `"${snake(k)}"`).join(",");
    const vals: any[] = [];
    const tuples = list.map((o) => {
      const ph = keys.map((k) => {
        vals.push(jsonify(o[k]));
        return `$${vals.length}`;
      });
      return `(${ph.join(",")})`;
    });
    await this.c.query(`INSERT INTO ${table} (${cols}) VALUES ${tuples.join(",")}`, vals);
  }
  async update<T = any>(table: string, where: Record<string, any>, obj: Record<string, any>): Promise<T | null> {
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    if (!keys.length) return null;
    const vals = keys.map((k) => jsonify(obj[k]));
    const set = keys.map((k, i) => `"${snake(k)}" = $${i + 1}`).join(",");
    const wk = Object.keys(where);
    const cond = wk.map((k, i) => `"${snake(k)}" = $${keys.length + i + 1}`).join(" AND ");
    const r = await this.c.query(`UPDATE ${table} SET ${set} WHERE ${cond} RETURNING *`, [...vals, ...wk.map((k) => where[k])]);
    return r.rows[0] ? camelRow(r.rows[0]) : null;
  }
}

function jsonify(v: any) {
  if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

export const db = new Db(pool);

export async function tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(new Db(client));
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
