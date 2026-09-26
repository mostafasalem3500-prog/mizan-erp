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
import { seedDemoAccount } from "./services/seed-demo-account";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, version: "2.0.0", time: new Date() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
app.use("/api/public", pub);
app.use("/api/auth", auth);
app.use("/api/admin", admin);
app.use("/api", master);
app.use("/api", ops);
app.use("/api", extra);

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
  })
  .catch((e) => {
    console.error("migration failed", e);
    process.exit(1);
  });
