/**
 * Optional showcase account: when DEMO_EMAIL/DEMO_PASSWORD are set and no such user exists,
 * creates the user + a demo company and loads the six-month demo dataset in the background.
 */
import bcrypt from "bcryptjs";
import { db, tx } from "../db/pool";
import { bootstrapCompany } from "../routes/auth";
import { loadDemo } from "./demo";

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
  if (!c.demoLoaded && !(c.demoJob && !c.demoJob.done && !c.demoJob.error && Date.now() - new Date(c.demoJob.at).getTime() < 10 * 60000)) {
    console.log("[demo-account] loading demo dataset…");
    loadDemo(companyId, userId, "مستخدم تجريبي")
      .then(() => console.log("[demo-account] demo dataset loaded"))
      .catch(async (e) => {
        console.error("[demo-account] failed", e);
        await db.exec(`UPDATE companies SET demo_job=$2 WHERE id=$1`, [companyId, JSON.stringify({ step: "فشل: " + e.message, pct: 0, error: true, at: new Date() })]);
      });
  }
}
