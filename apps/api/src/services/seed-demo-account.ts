/**
 * Optional showcase account: when DEMO_EMAIL/DEMO_PASSWORD are set and no such user exists,
 * creates the user + a demo company and loads the six-month demo dataset in the background.
 */
import bcrypt from "bcryptjs";
import { db, tx } from "../db/pool";
import { bootstrapCompany } from "../routes/auth";
import { loadDemo, DEMO_VERSION, resetShowcaseCompany } from "./demo";
import { newSallaToken, processEvent, sampleOrder } from "./salla";
import { clearingView, createBatch } from "./clearing";
import { IS_EG } from "../lib/country";

/** Showcase only: connected Salla and Zid stores with processed orders and one platform payout, so the screens are not empty. */
async function showcaseSalla(companyId: string) {
  const wh = await db.one(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code LIMIT 1`, [companyId]);
  for (const [platform, name, orders] of [["SALLA", "متجر الأفق على سلة (تجريبي)", [false, true, false]], ["ZID", "متجر الأفق على زد (تجريبي)", [false, true]]] as const) {
    let conn = await db.maybe(`SELECT * FROM salla_connections WHERE company_id=$1 AND platform=$2`, [companyId, platform]);
    if (!conn) conn = await db.insert("salla_connections", { companyId, platform, token: newSallaToken(), storeName: name, warehouseId: wh.id });
    for (const cod of orders) await processEvent(conn, await sampleOrder(companyId, { cod, warehouseId: conn.warehouseId, platform }), { eventHint: "order.create" });
  }
  // the platform transfers the first Salla orders, each with its commission (2.5% + 1, VAT on it); the last order and Zid's stay owed
  const co = await db.one(`SELECT * FROM companies WHERE id=$1`, [companyId]);
  const open = (await clearingView(db, co, "SALLA")).open;
  if (open.length >= 2) {
    const bank = await db.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='BANK'`, [companyId]);
    await tx((t) => createBatch(t, co, "مستخدم تجريبي", "SALLA", { bankAccountId: bank.id, reference: "تحويل سلة الأسبوعي", isDemo: true, lines: open.slice(0, open.length - 1).map((o: any) => ({ invoiceId: o.invoiceId, gross: o.open, fee: Math.round((o.open * 0.025 + 1) * 100) / 100 })) }));
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
      const c = IS_EG
        ? await bootstrapCompany(t, { nameAr: "شركة النيل للتجارة (حساب تجريبي)", nameEn: "Al Nile Trading Co. (Demo)", vatNumber: "100200300", crNumber: "123456", city: "القاهرة", email }, u.id, "PRO")
        : await bootstrapCompany(t, { nameAr: "مؤسسة الأفق للتجارة (حساب تجريبي)", nameEn: "Al Ufuq Trading Est. (Demo)", vatNumber: "300000000000003", crNumber: "1010010000", city: "مكة المكرمة", email }, u.id, "PRO");
      if (IS_EG) await t.exec(`UPDATE companies SET street='شارع التحرير', building_no='12', district='الدقي', postal_code='12611', phone='01000000000', max_users=10, subscription_ends_at=now() + interval '10 years', invoice_footer='شكراً لتعاملكم معنا — هذا حساب تجريبي لاستعراض النظام' WHERE id=$1`, [c.id]);
      else await t.exec(`UPDATE companies SET street='شارع الملك فهد', building_no='7845', district='العزيزية', postal_code='24243', phone='0541941602', max_users=10, subscription_ends_at=now() + interval '10 years', invoice_footer='شكراً لتعاملكم معنا — هذا حساب تجريبي لاستعراض النظام' WHERE id=$1`, [c.id]);
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
    // mark the load as running from the start, so the hourly jobs (amortisation, periodic reports) keep off this establishment until it is done
    db.exec(`UPDATE companies SET demo_job=$2 WHERE id=$1`, [companyId, JSON.stringify({ step: "تحديث البيانات التجريبية", pct: 1, at: new Date() })])
      .then(() => (stale || c.demoJob?.error ? resetShowcaseCompany(companyId) : Promise.resolve()))
      .then(() => loadDemo(companyId, userId, "مستخدم تجريبي"))
      .then(() => (IS_EG ? Promise.resolve() : showcaseSalla(companyId)).catch((e) => console.error("[demo-account] salla sample", e)))
      .then(() => console.log("[demo-account] demo dataset loaded"))
      .catch(async (e) => {
        console.error("[demo-account] failed", e);
        await db.exec(`UPDATE companies SET demo_job=$2 WHERE id=$1`, [companyId, JSON.stringify({ step: "فشل: " + e.message, pct: 0, error: true, at: new Date() })]);
      });
  }
}
