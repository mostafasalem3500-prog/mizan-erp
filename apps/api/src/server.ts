import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import { migrate } from "./db/migrate";
import { pool } from "./db/pool";
import { AppError } from "./lib/core";
import { auth, admin } from "./routes/auth";
import { master } from "./routes/master";
import { ops } from "./routes/ops";
import { pub, extra } from "./routes/extra";
import { r3 } from "./routes/round3";
import { r4 } from "./routes/round4";
import { r5 } from "./routes/round5";
import { r6 } from "./routes/round6";
import { r7 } from "./routes/round7";
import { r8, v1, portal } from "./routes/round8";
import { r9 } from "./routes/round9";
import { r10, hooks } from "./routes/round10";
import { r12 } from "./routes/round12";
import { runZatcaSelfTest } from "./zatca/selftest";
import { startRecurringScheduler } from "./services/recurring";
import { seedDemoAccount } from "./services/seed-demo-account";

/** Ops aid: ZATCA_SELFTEST=1 runs the developer-portal self-test once at boot for the showcase (or first) company and logs it. */
async function zatcaBootSelfTest() {
  const email = (process.env.DEMO_EMAIL || "").toLowerCase();
  const c = (email && (await pool.query(`SELECT c.* FROM companies c JOIN memberships m ON m.company_id=c.id JOIN users u ON u.id=m.user_id WHERE u.email=$1 LIMIT 1`, [email])).rows[0]) || (await pool.query(`SELECT * FROM companies ORDER BY created_at LIMIT 1`)).rows[0];
  if (!c) return;
  const company = { ...c, nameAr: c.name_ar, vatNumber: c.vat_number, crNumber: c.cr_number, buildingNo: c.building_no, additionalNo: c.additional_no, postalCode: c.postal_code };
  const r = await runZatcaSelfTest(company, { env: "SANDBOX" });
  console.log(`[zatca-selftest] ok=${r.ok} company=${c.name_ar}`);
  for (const s of r.steps) console.log(`[zatca-selftest] step ${s.ok ? "OK " : "ERR"} ${s.name} — ${s.detail || ""}`);
  for (const d of r.docs) console.log(`[zatca-selftest] doc ${d.ok ? "OK " : "ERR"} ${d.typeCode}${d.simplified ? "S" : "B"} http=${d.httpStatus} status=${d.status} errors=${JSON.stringify(d.errors)} warnings=${JSON.stringify(d.warnings)}`);
  for (const n of r.notes) console.log(`[zatca-selftest] note ${n}`);
  await pool.query(`UPDATE zatca_configs SET selftest=$2, selftest_at=now() WHERE company_id=$1`, [c.id, JSON.stringify(r)]);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());
app.use(express.json({ limit: "2mb", verify: (req: any, _res, buf) => { if (String(req.url || "").startsWith("/api/hooks/")) req.rawBody = Buffer.from(buf); } }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, version: "2.0.0", time: new Date() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.use("/api/public", pub);
app.use("/api/public", portal);
app.use("/api/v1", v1);
app.use("/api/hooks", hooks);
app.use("/api/auth", auth);
app.use("/api/admin", admin);
app.use("/api", master);
app.use("/api", ops);
app.use("/api", extra);
app.use("/api", r3);
app.use("/api", r4);
app.use("/api", r5);
app.use("/api", r6);
app.use("/api", r7);
app.use("/api", r8);
app.use("/api", r9);
app.use("/api", r10);
app.use("/api", r12);

app.use("/api", (_req, res) => res.status(404).json({ message: "المسار غير موجود", code: "NOT_FOUND" }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) return res.status(err.status).json({ message: err.message, code: err.code, details: err.details });
  if (err?.status === 404) return res.status(404).json({ message: err.message, code: "NOT_FOUND" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "JSON غير صحيح", code: "BAD_JSON" });
  if (err?.code === "23505") return res.status(409).json({ message: "قيمة مكررة — السجل موجود مسبقاً", code: "CONFLICT" });
  if (err?.code === "23503") return res.status(409).json({ message: "لا يمكن الحذف — السجل مرتبط بسجلات أخرى", code: "CONFLICT" });
  if (typeof err?.message === "string" && err.message.startsWith("UNBALANCED_ENTRY")) return res.status(400).json({ message: "القيد غير متوازن", code: "UNBALANCED" });
  console.error(err);
  res.status(500).json({ message: err?.message || "خطأ غير متوقع", code: "INTERNAL" });
});

// static SPA
const webDir = path.resolve(__dirname, "../web/dist");
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir, { maxAge: "1h", index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(webDir, "index.html"));
  });
}

const port = Number(process.env.PORT || 3000);
migrate()
  .then(() => {
    app.listen(port, "0.0.0.0", () => console.log(`Mizan ERP v2 listening on :${port}`));
    seedDemoAccount().catch((e) => console.error("[demo-account]", e));
    if (process.env.ZATCA_SELFTEST) zatcaBootSelfTest().catch((e) => console.error("[zatca-selftest]", e));
    startRecurringScheduler();
  })
  .catch((e) => {
    console.error("migration failed", e);
    process.exit(1);
  });
