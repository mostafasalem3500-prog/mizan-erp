import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db, tx } from "../db/pool";
import { h, bad, req as need, AppError, conflict, today, addMonths } from "../lib/core";
import { authenticate, signToken, subscriptionState, ROLES, superAdmin, AuthCtx } from "../lib/auth";
import { seedChartOfAccounts, ensureFiscalYear } from "../accounting/engine";
import { ensureZatcaConfig } from "../zatca/stamp";

export const auth = Router();

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 14);

export async function bootstrapCompany(t: any, input: { nameAr: string; nameEn?: string; vatNumber?: string; crNumber?: string; city?: string; phone?: string; email?: string }, ownerUserId: string, plan = "TRIAL") {
  const company = await t.insert("companies", {
    nameAr: input.nameAr.trim(), nameEn: input.nameEn || null, vatNumber: input.vatNumber || null, crNumber: input.crNumber || null, city: input.city || null, phone: input.phone || null, email: input.email || null,
    plan, subscriptionEndsAt: plan === "TRIAL" ? new Date(Date.now() + TRIAL_DAYS * 86400000) : null,
  });
  await t.insert("memberships", { companyId: company.id, userId: ownerUserId, role: "OWNER" });
  await t.insert("branches", { companyId: company.id, code: "MAIN", name: "الفرع الرئيسي" });
  await t.insert("warehouses", { companyId: company.id, code: "MAIN", name: "المستودع الرئيسي", isDefault: true });
  await seedChartOfAccounts(t, company.id);
  await ensureFiscalYear(t, company.id, today());
  await ensureZatcaConfig(t, company.id);
  return company;
}

function publicUser(u: any) {
  return { id: u.id, email: u.email, fullName: u.fullName, phone: u.phone, isSuperAdmin: u.isSuperAdmin };
}

async function companiesOf(userId: string) {
  return db.rows(`SELECT c.id, c.name_ar, c.plan, c.status, c.subscription_ends_at, c.logo, m.role FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=$1 AND m.is_active ORDER BY m.created_at`, [userId]);
}

function tokenFor(u: any, companyId: string | null, role: string | null): AuthCtx & { token: string } {
  const ctx: AuthCtx = { userId: u.id, userName: u.fullName, email: u.email, companyId, role, superAdmin: !!u.isSuperAdmin };
  return { ...ctx, token: signToken(ctx) };
}

auth.post(
  "/register",
  h(async (req) => {
    const b = req.body || {};
    const email = String(need(b, "email", "البريد الإلكتروني")).trim().toLowerCase();
    const password = String(need(b, "password", "كلمة المرور"));
    const fullName = String(need(b, "fullName", "الاسم"));
    const companyName = String(need(b, "companyName", "اسم المنشأة"));
    if (password.length < 8) throw bad("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("البريد الإلكتروني غير صحيح");
    if (b.vatNumber && !/^3\d{13}3$/.test(b.vatNumber)) throw bad("الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بـ 3");
    const exists = await db.maybe(`SELECT id FROM users WHERE email=$1`, [email]);
    if (exists) throw conflict("البريد الإلكتروني مسجل مسبقاً — سجّل الدخول");
    const passwordHash = await bcrypt.hash(password, 10);
    const first = await db.one(`SELECT COUNT(*)::int c FROM users`);
    const out = await tx(async (t) => {
      const u = await t.insert("users", { email, passwordHash, fullName, phone: b.phone || null, isSuperAdmin: first.c === 0 || email === (process.env.SUPER_ADMIN_EMAIL || "").toLowerCase() });
      const c = await bootstrapCompany(t, { nameAr: companyName, nameEn: b.companyNameEn, vatNumber: b.vatNumber, crNumber: b.crNumber, city: b.city, phone: b.phone, email }, u.id);
      await t.insert("audit_logs", { companyId: c.id, userId: u.id, userName: fullName, action: "REGISTER", entity: "company", entityId: c.id, details: { nameAr: c.nameAr } });
      return { u, c };
    });
    return { ...tokenFor(out.u, out.c.id, "OWNER"), user: publicUser(out.u), companies: await companiesOf(out.u.id) };
  }),
);

auth.post(
  "/login",
  h(async (req) => {
    const email = String(need(req.body, "email", "البريد الإلكتروني")).trim().toLowerCase();
    const password = String(need(req.body, "password", "كلمة المرور"));
    const u = await db.maybe(`SELECT * FROM users WHERE email=$1`, [email]);
    if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw new AppError(401, "بيانات الدخول غير صحيحة", "BAD_CREDENTIALS");
    if (!u.isActive) throw new AppError(403, "الحساب موقوف", "INACTIVE");
    await db.exec(`UPDATE users SET last_login_at=now() WHERE id=$1`, [u.id]);
    const companies = await companiesOf(u.id);
    const preferred = req.body.companyId && companies.find((c) => c.id === req.body.companyId);
    const c = preferred || companies[0] || null;
    return { ...tokenFor(u, c?.id || null, c?.role || null), user: publicUser(u), companies };
  }),
);

/** Demo login (public showcase) — enabled only when DEMO_EMAIL/DEMO_PASSWORD are configured. */
auth.get(
  "/demo-credentials",
  h(async () => (process.env.DEMO_EMAIL ? { email: process.env.DEMO_EMAIL, password: process.env.DEMO_PASSWORD } : { email: null })),
);

auth.use(authenticate);

auth.get(
  "/me",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    const companies = await companiesOf(u.id);
    const company = req.company ? { ...req.company, memberRole: undefined } : null;
    return { user: publicUser(u), companies, company, role: req.auth.role, subscription: subscriptionState(req.company), roles: Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.ar])), superAdmin: !!u.isSuperAdmin };
  }),
);

auth.post(
  "/switch",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    const companies = await companiesOf(u.id);
    const c = companies.find((x) => x.id === req.body.companyId) || (u.isSuperAdmin ? await db.maybe(`SELECT id, 'OWNER' AS role FROM companies WHERE id=$1`, [req.body.companyId]) : null);
    if (!c) throw bad("المنشأة غير متاحة لك");
    return { ...tokenFor(u, c.id, c.role), companies };
  }),
);

auth.post(
  "/companies",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    const name = String(need(req.body, "nameAr", "اسم المنشأة"));
    const c = await tx((t) => bootstrapCompany(t, { nameAr: name, nameEn: req.body.nameEn, vatNumber: req.body.vatNumber, crNumber: req.body.crNumber, city: req.body.city }, u.id));
    return { ...tokenFor(u, c.id, "OWNER"), companies: await companiesOf(u.id) };
  }),
);

auth.post(
  "/change-password",
  h(async (req) => {
    const u = await db.one(`SELECT * FROM users WHERE id=$1`, [req.auth.userId]);
    if (!(await bcrypt.compare(String(req.body.current || ""), u.passwordHash))) throw bad("كلمة المرور الحالية غير صحيحة");
    if (String(req.body.next || "").length < 8) throw bad("كلمة المرور الجديدة قصيرة");
    await db.exec(`UPDATE users SET password_hash=$2 WHERE id=$1`, [u.id, await bcrypt.hash(String(req.body.next), 10)]);
    return { ok: true };
  }),
);

auth.post(
  "/activate-license",
  h(async (req) => {
    if (!req.company) throw bad("اختر المنشأة أولاً");
    if (!["OWNER", "ADMIN"].includes(req.auth.role || "") && !req.auth.superAdmin) throw new AppError(403, "المالك فقط يمكنه تفعيل الترخيص");
    const key = String(need(req.body, "key", "مفتاح الترخيص")).trim().toUpperCase();
    return tx(async (t) => {
      const lic = await t.maybe(`SELECT * FROM license_keys WHERE key=$1 FOR UPDATE`, [key]);
      if (!lic) throw bad("مفتاح الترخيص غير صحيح");
      if (lic.activatedAt) throw conflict("هذا المفتاح مستخدم مسبقاً");
      const c = await t.one(`SELECT * FROM companies WHERE id=$1 FOR UPDATE`, [req.company.id]);
      const base = c.subscriptionEndsAt && new Date(c.subscriptionEndsAt) > new Date() && c.plan !== "TRIAL" ? new Date(c.subscriptionEndsAt) : new Date();
      const ends = new Date(base);
      ends.setMonth(ends.getMonth() + lic.months);
      await t.exec(`UPDATE companies SET plan=$2, max_users=$3, subscription_ends_at=$4, status='ACTIVE', updated_at=now() WHERE id=$1`, [c.id, lic.plan, lic.maxUsers, ends]);
      await t.exec(`UPDATE license_keys SET company_id=$2, activated_at=now() WHERE id=$1`, [lic.id, c.id]);
      await t.insert("audit_logs", { companyId: c.id, userId: req.auth.userId, userName: req.auth.userName, action: "LICENSE_ACTIVATED", entity: "company", entityId: c.id, details: { plan: lic.plan, months: lic.months, ends } });
      return { plan: lic.plan, maxUsers: lic.maxUsers, subscriptionEndsAt: ends };
    });
  }),
);

// ─── super admin ───────────────────────────────────────────────────────────
export const admin = Router();
admin.use(authenticate, superAdmin);

admin.get(
  "/overview",
  h(async () => {
    const companies = await db.rows(`SELECT c.*, (SELECT COUNT(*)::int FROM memberships m WHERE m.company_id=c.id) users, (SELECT COUNT(*)::int FROM invoices i WHERE i.company_id=c.id AND i.status='POSTED') invoices, (SELECT MAX(created_at) FROM audit_logs a WHERE a.company_id=c.id) last_activity FROM companies c ORDER BY c.created_at DESC`);
    const keys = await db.rows(`SELECT k.*, c.name_ar AS company_name FROM license_keys k LEFT JOIN companies c ON c.id=k.company_id ORDER BY k.created_at DESC LIMIT 200`);
    const users = await db.one(`SELECT COUNT(*)::int c FROM users`);
    return { companies, keys, usersCount: users.c };
  }),
);

admin.post(
  "/license-keys",
  h(async (req) => {
    const plan = String(req.body.plan || "PRO").toUpperCase();
    if (!["BASIC", "PRO", "ENTERPRISE"].includes(plan)) throw bad("الخطة غير صحيحة");
    const months = Math.max(1, Math.min(60, Number(req.body.months) || 12));
    const maxUsers = Math.max(1, Math.min(500, Number(req.body.maxUsers) || (plan === "BASIC" ? 3 : plan === "PRO" ? 10 : 100)));
    const count = Math.max(1, Math.min(50, Number(req.body.count) || 1));
    const out = [];
    for (let i = 0; i < count; i++) {
      const raw = randomBytes(10).toString("hex").toUpperCase();
      const key = `MZN-${plan.slice(0, 3)}-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
      out.push(await db.insert("license_keys", { key, plan, months, maxUsers, note: req.body.note || null }));
    }
    return out;
  }),
);

admin.post(
  "/companies/:id/status",
  h(async (req) => {
    const status = req.body.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    await db.exec(`UPDATE companies SET status=$2, updated_at=now() WHERE id=$1`, [req.params.id, status]);
    return { ok: true };
  }),
);

admin.post(
  "/companies/:id/extend",
  h(async (req) => {
    const c = await db.one(`SELECT * FROM companies WHERE id=$1`, [req.params.id]);
    const months = Number(req.body.months) || 1;
    const base = c.subscriptionEndsAt && new Date(c.subscriptionEndsAt) > new Date() ? new Date(c.subscriptionEndsAt) : new Date();
    base.setMonth(base.getMonth() + months);
    await db.exec(`UPDATE companies SET subscription_ends_at=$2, plan=COALESCE($3, plan), max_users=COALESCE($4, max_users) WHERE id=$1`, [c.id, base, req.body.plan || null, req.body.maxUsers || null]);
    return { subscriptionEndsAt: base };
  }),
);
