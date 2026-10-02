/** CLI: `npm run selfcheck` — runs the accounting self-check against DATABASE_URL (rolled back) and exits non-zero on failure. */
import { runAccountingSelfCheck } from "./services/selfcheck";
import { pool } from "./db/pool";
import { migrate } from "./db/migrate";

(async () => {
  await migrate();
  const r = await runAccountingSelfCheck();
  for (const c of r.checks) console.log(`${c.ok ? "✔" : "✘"} [${c.group}] ${c.name} — متوقع ${JSON.stringify(c.expected)} / فعلي ${JSON.stringify(c.actual)}`);
  if (r.error) console.log("✘ خطأ:", r.error);
  console.log(`\n${r.ok ? "PASS" : "FAIL"}: ${r.passed} ناجح، ${r.failed} فاشل — ${r.durationMs}ms`);
  await pool.end();
  process.exit(r.ok ? 0 : 1);
})();
