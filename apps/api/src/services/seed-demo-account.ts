/**
 * Optional showcase account: when DEMO_EMAIL/DEMO_PASSWORD are set and no such user exists,
 * creates the user + a demo company and loads the six-month demo dataset in the background.
 */
import bcrypt from "bcryptjs";
import { db, tx } from "../db/pool";
import { bootstrapCompany } from "../routes/auth";
import { loadDemo, DEMO_VERSION, resetShowcaseCompany } from "./demo";
import { newSallaToken, processEvent, sampleOrder } from "./salla";

/** Showcase only: a connected Salla store with a few processed orders, so the integration screen is not empty. */
async function showcaseSalla(companyId: string) {
  let conn = await db.maybe(`SELECT * FROM salla_connections WHERE company_id=$1`, [companyId]);
  if (!conn) {
    const wh = await db.one(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code LIMIT 1`, [companyId]);
    conn = await db.insert("salla_connections", { companyId, token: newSallaToken(), storeName: "متجر الأفق على سلة (تجريبي)", warehouseId: wh.id });
  }
  for (const cod of [false, true, false]) {
    const body = await sampleOrder(companyId, { cod, warehouseId: conn.warehouseId });
    await processEvent(conn, body);
  }
}

export async function seedDemoAccount() {
  const email = (process.env.DEMO_EMAIL || "").trim().toLowerCase();
  const password = process.env.DEMO_PASSWORD;
  if (!email || !password) return;
  const existing = await db.maybe(`SELECT u.id, m.company_id FROM users u LEFT JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 ORDER BY m.created_at LIMIT 1`, [email]);
  let userId: string, companyId: string;
  if (existing?.companyId) {
    userId = existing.id;
    companyId = existing.companyId;
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const r = await tx(async (t) => {
      const u = existing?.id ? await t.one(`SELECT * FROM users WHERE id=$1`, [existing.id]) : await t.insert("users", { email, passwordHash, fullName: "مستخدم تجريبي" });
      const c = await bootstrapCompany(t, { nameAr: "مؤسسة الأفق للتجارة (حساب تجريبي)", nameEn: "Al Ufuq Trading Est. (Demo)", vatNumber: "300000000000003", crNumber: "1010010000", city: "مكة المكرمة", email }, u.id, "PRO");
      await t.exec(`UPDATE companies SET street='شارع الملك فهد', building_no='7845', district='العزيزية', postal_code='24243', phone='0541941602', max_users=10, subscription_ends_at=now() + interval '10 years', invoice_footer='شكراً لتعاملكم معنا — هذا حساب تجريبي لاستعراض النظام' WHERE id=$1`, [c.id]);
      return { userId: u.id, companyId: c.id };
    });
    userId = r.userId;
    companyId = r.companyId;
    console.log(`[demo-account] created ${email} / company ${companyId}`);
  }
  const c = await db.one(`SELECT demo_loaded, demo_job FROM companies WHERE id=$1`, [companyId]);
  const running = c.demoJob && !c.demoJob.done && !c.demoJob.error && Date.now() - new Date(c.demoJob.at).getTime() < 10 * 60000;
  const stale = c.demoLoaded && Number(c.demoJob?.version || 0) < DEMO_VERSION; // showcase dataset older than this build → refresh
  if ((!c.demoLoaded || stale || c.demoJob?.error) && !running) {
    console.log(stale ? "[demo-account] refreshing showcase dataset to v" + DEMO_VERSION : "[demo-account] loading demo dataset…");
    (stale || c.demoJob?.error ? resetShowcaseCompany(companyId) : Promise.resolve())
      .then(() => loadDemo(companyId, userId, "مستخدم تجريبي"))
      .then(() => showcaseSalla(companyId).catch((e) => console.error("[demo-account] salla sample", e)))
      .then(() => console.log("[demo-account] demo dataset loaded"))
      .catch(async (e) => {
        console.error("[demo-account] failed", e);
        await db.exec(`UPDATE companies SET demo_job=$2 WHERE id=$1`, [companyId, JSON.stringify({ step: "فشل: " + e.message, pct: 0, error: true, at: new Date() })]);
      });
  }
}
