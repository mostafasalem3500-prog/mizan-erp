import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { AppError, forbidden } from "./core";
import { db } from "../db/pool";
import { reqCtx } from "./context";
import { applyBranchScope } from "./branchScope";
import { currentDeviceId, deviceMatches, isDesktopLocal } from "./desktopLicense";

/**
 * Signs the sign-in tokens. It must be set on every server; when it is missing the server makes a random one for this
 * run (so tokens can never be forged with a publicly known default) — sessions then end at each restart.
 */
export const JWT_SECRET = process.env.JWT_SECRET || (console.warn("[auth] JWT_SECRET is not set: using a random secret for this run — users will be signed out at every restart"), randomBytes(48).toString("hex"));

export interface AuthCtx {
  userId: string;
  userName: string;
  email: string;
  companyId: string | null;
  role: string | null;
  superAdmin: boolean;
  branchId?: string | null;
  lockedBranchId?: string | null;
  /** the sign-in session (user_sessions.id); tokens issued before 3.35 have none */
  sid?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth: AuthCtx;
      company: any;
    }
  }
}

export const ROLES: Record<string, { ar: string; perms: string[] }> = {
  OWNER: { ar: "المالك", perms: ["*"] },
  ADMIN: { ar: "مدير النظام", perms: ["*"] },
  ACCOUNTANT: {
    ar: "محاسب",
    perms: ["*.read", "sales.write", "purchases.write", "payments.write", "expenses.write", "accounting.write", "inventory.write", "assets.write", "vat.write", "pos.use", "partners.write", "products.write", "mfg.write"],
  },
  SALES: { ar: "مندوب مبيعات", perms: ["sales.read", "sales.write", "partners.read", "partners.write", "products.read", "inventory.read", "payments.read", "payments.write", "dashboard.read", "reports.sales"] },
  CASHIER: { ar: "كاشير", perms: ["pos.use", "products.read", "partners.read", "partners.write", "sales.read", "dashboard.read"] },
  STOREKEEPER: { ar: "أمين مستودع", perms: ["products.read", "products.write", "inventory.read", "inventory.write", "purchases.read", "partners.read", "dashboard.read", "mfg.read", "mfg.write"] },
  PRODUCTION: { ar: "مشرف إنتاج", perms: ["mfg.read", "mfg.write", "products.read", "inventory.read", "inventory.write", "purchases.read", "partners.read", "dashboard.read"] },
  // 3.53.0: keeps the employee files, leave, documents, attendance and prepares/approves payroll; posting the run and
  // paying it stay with accounting and payments
  HR: { ar: "مسؤول الموارد البشرية", perms: ["hr.read", "hr.write", "dashboard.read"] },
  VIEWER: { ar: "مشاهد / مدقق", perms: ["*.read"] },
};

export function can(role: string | null, perm: string): boolean {
  if (!role) return false;
  const perms = ROLES[role]?.perms || [];
  if (perms.includes("*") || perms.includes(perm)) return true;
  if (perm.endsWith(".read") && perms.includes("*.read")) return true;
  // HR screens were under accounting before 3.53.0: whoever kept them (the accountant) keeps them
  if (perm === "hr.read" && perms.includes("accounting.read")) return true;
  if (perm === "hr.write" && perms.includes("accounting.write")) return true;
  return false;
}

export function signToken(payload: AuthCtx) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

/** Parses the bearer token and loads the active company (tenant) for this request. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  // every router mounted on /api carries this middleware: a request passing through several routers is checked once
  if ((req as any)._authDone) return next();
  try {
    const hdr = req.headers.authorization || "";
    // 3.53.0: the session token is read from the header only — a token in a URL stays in history, proxies and logs
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (!token) throw new AppError(401, "يلزم تسجيل الدخول", "UNAUTHENTICATED");
    let payload: AuthCtx;
    try {
      payload = jwt.verify(token, JWT_SECRET) as AuthCtx;
    } catch {
      throw new AppError(401, "انتهت الجلسة، يرجى تسجيل الدخول مجدداً", "UNAUTHENTICATED");
    }
    // a session ended from another device, or a deactivated user, stops at once; older tokens (no session) end when the password changes
    if (payload.sid) {
      const ses = await db.maybe(`SELECT s.revoked_at, s.last_seen_at, u.is_active FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2`, [payload.sid, payload.userId]);
      if (!ses || ses.revokedAt) throw new AppError(401, "انتهت هذه الجلسة (سُجّل الخروج منها من جهاز آخر أو تغيّرت كلمة المرور) — سجّل الدخول مجدداً", "UNAUTHENTICATED");
      if (ses.isActive === false) throw new AppError(401, "الحساب موقوف", "UNAUTHENTICATED");
      if (Date.now() - new Date(ses.lastSeenAt).getTime() > 5 * 60000) db.exec(`UPDATE user_sessions SET last_seen_at=now() WHERE id=$1`, [payload.sid]).catch(() => undefined);
    } else {
      const u = await db.maybe(`SELECT password_changed_at, is_active FROM users WHERE id=$1`, [payload.userId]);
      const iat = Number((payload as any).iat || 0) * 1000;
      if (!u || u.isActive === false || (u.passwordChangedAt && new Date(u.passwordChangedAt).getTime() > iat + 1000)) throw new AppError(401, "انتهت الجلسة، يرجى تسجيل الدخول مجدداً", "UNAUTHENTICATED");
    }
    req.auth = { ...payload, branchId: null, lockedBranchId: null };
    if (payload.companyId) {
      // re-validate membership on every request so removed users lose access immediately
      const row = await db.maybe(
        `SELECT c.*, m.role AS member_role, m.branch_id AS member_branch_id, m.restrict_branch AS member_restrict FROM companies c JOIN memberships m ON m.company_id=c.id
         WHERE c.id=$1 AND m.user_id=$2 AND m.is_active`,
        [payload.companyId, payload.userId],
      );
      if (!row && !payload.superAdmin) throw new AppError(401, "لم تعد عضواً في هذه المنشأة", "UNAUTHENTICATED");
      if (row) {
        req.company = row;
        if (isDesktopLocal()) row._entitlement = await desktopEntitlement(row.id);
        req.auth.role = row.memberRole;
        req.auth.branchId = row.memberBranchId || null;
        req.auth.lockedBranchId = row.memberRestrict && row.memberBranchId && !["OWNER", "ADMIN"].includes(row.memberRole) ? row.memberBranchId : null;
        if (req.auth.lockedBranchId) await applyBranchScope(req, row.id, req.auth.lockedBranchId);
      } else {
        req.company = await db.maybe("SELECT * FROM companies WHERE id=$1", [payload.companyId]);
        req.auth.role = "OWNER";
      }
    }
    const b = req.body && typeof req.body === "object" ? req.body.branchId : null;
    const locked = req.auth.lockedBranchId || null;
    (req as any)._authDone = true;
    reqCtx.run({ userBranchId: req.auth.branchId || null, bodyBranchId: locked || (typeof b === "string" && b ? b : null), lockedBranchId: locked }, () => next());
  } catch (e) {
    next(e);
  }
}

import { trustedNow, DESKTOP_TRIAL_DAYS, desktopEntitlement } from "../services/desktopGuard";
export function subscriptionState(company: any): { active: boolean; readOnly: boolean; daysLeft: number | null; reason?: string } {
  if (!company) return { active: false, readOnly: true, daysLeft: null, reason: "NO_COMPANY" };
  if (company.status === "SUSPENDED") return { active: false, readOnly: true, daysLeft: 0, reason: "SUSPENDED" };
  // desktop: a licence bound to another PC (e.g. the data folder was copied) does not run here
  const dev = currentDeviceId();
  if (dev && company.licensedDevice && !deviceMatches(company.licensedDevice, dev)) return { active: false, readOnly: true, daysLeft: 0, reason: "DEVICE" };
  // desktop: the end date is what the signed keys pay for (not whatever the local database says), and time never runs backwards
  let endsAt: Date | null = company.subscriptionEndsAt ? new Date(company.subscriptionEndsAt) : null;
  if (dev) {
    const ent = company._entitlement as { keys: number; maxEnd: Date | null } | undefined;
    if (company.plan === "TRIAL" || !company.plan) {
      const cap = new Date((company.createdAt ? new Date(company.createdAt).getTime() : trustedNow()) + (DESKTOP_TRIAL_DAYS() + 1) * 86400000);
      endsAt = !endsAt || endsAt > cap ? cap : endsAt;
    } else if (ent) {
      if (!ent.keys || !ent.maxEnd) return { active: false, readOnly: true, daysLeft: 0, reason: "LICENSE" };
      endsAt = !endsAt || endsAt > ent.maxEnd ? ent.maxEnd : endsAt;
    }
  }
  if (!endsAt) return { active: true, readOnly: false, daysLeft: null };
  const days = Math.ceil((endsAt.getTime() - trustedNow()) / 86400000);
  if (days < 0) return { active: false, readOnly: true, daysLeft: days, reason: "EXPIRED" };
  return { active: true, readOnly: false, daysLeft: days };
}

/** Requires a company context + permission. Write permissions also require an active subscription. */
export function perm(p: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.company) return next(new AppError(400, "اختر المنشأة أولاً", "NO_COMPANY"));
    if (!can(req.auth.role, p) && !req.auth.superAdmin) return next(forbidden());
    if (!p.endsWith(".read")) {
      const s = subscriptionState(req.company);
      if (s.readOnly)
        return next(new AppError(402, s.reason === "SUSPENDED" ? "الحساب موقوف، تواصل مع الإدارة" : s.reason === "LICENSE" ? "لا يوجد مفتاح ترخيص صالح لهذه المنشأة على هذا الجهاز — فعّل مفتاح الترخيص من الإعدادات. النظام في وضع القراءة فقط" : s.reason === "DEVICE" ? "الترخيص مسجَّل لجهاز آخر — النظام في وضع القراءة فقط. اطلب مفتاحاً لهذا الجهاز من مزود النظام" : "انتهى الاشتراك — النظام في وضع القراءة فقط. فعّل مفتاح ترخيص للاستمرار", "SUBSCRIPTION"));
    }
    next();
  };
}

export function superAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.superAdmin) return next(forbidden("هذه الصفحة للمدير العام للنظام فقط"));
  next();
}

export const cid = (req: Request) => req.company.id as string;
export const actor = (req: Request) => req.auth.userName || req.auth.email;

/** route params as plain strings */
export const p = (req: Request) => req.params as unknown as Record<string, string>;
