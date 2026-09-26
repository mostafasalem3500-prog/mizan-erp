import fs from "fs";
import path from "path";
import { pool } from "./pool";

/** Applies db/migrations/*.sql in order, once each, inside a transaction per file. */
export async function migrate(): Promise<void> {
  const dir = path.resolve(__dirname, "../../db/migrations");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(`CREATE TABLE IF NOT EXISTS mizan_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query("SELECT name FROM mizan_migrations")).rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      console.log(`[migrate] applying ${f}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO mizan_migrations(name) VALUES ($1)", [f]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => undefined);
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log("[migrate] done");
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
