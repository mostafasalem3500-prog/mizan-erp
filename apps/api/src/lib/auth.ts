import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { AppError, forbidden } from "./core";
import { db } from "../db/pool";

export const JWT_SECRET = process.env.JWT_SECRET || "mizan-dev-secret-change-me";

export interface AuthCtx {
  userId: string;
  userName: string;
  email: string;
  companyId: string | null;
  role: string | null;
  superAdmin: boolean;
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
    perms: ["*.read", "sales.write", "purchases.write", "payments.write", "expenses.write", "accounting.write", "inventory.write", "assets.write", "vat.write", "pos.use", "partners.write", "products.write"],
  },
  SALES: { ar: "مندوب مبيعات", perms: ["sales.read", "sales.write", "partners.read", "partners.write", "products.read", "inventory.read", "payments.read", "payments.write", "dashboard.read", "reports.sales"] },
  CASHIER: { ar: "كاشير", perms: ["pos.use", "products.read", "partners.read", "partners.write", "sales.read", "dashboard.read"] },
  STOREKEEPER: { ar: "أمين مستودع", perms: ["products.read", "products.write", "inventory.read", "inventory.write", "purchases.read", "partners.read", "dashboard.read"] },
  VIEWER: { ar: "مشاهد / مدقق", perms: ["*.read"] },
};

export function can(role: string | null, perm: string): boolean {
  if (!role) return false;
  const perms = ROLES[role]?.perms || [];
  if (perms.includes("*") || perms.includes(perm)) return true;
  if (perm.endsWith(".read") && perms.includes("*.read")) return true;
  return false;
}

export function signToken(payload: AuthCtx) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

/** Parses the bearer token and loads the active company (tenant) for this request. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : (req.query.token as string) || "";
    if (!token) throw new AppError(401, "يلزم تسجيل الدخول", "UNAUTHENTICATED");
    let payload: AuthCtx;
    try {
      payload = jwt.verify(token, JWT_SECRET) as AuthCtx;
    } catch {
      throw new AppError(401, "انتهت الجلسة، يرجى تسجيل الدخول مجدداً", "UNAUTHENTICATED");
    }
    req.auth = payload;
    if (payload.companyId) {
      // re-validate membership on every request so removed users lose access immediately
      const row = await db.maybe(
        `SELECT c.*, m.role AS member_role FROM companies c JOIN memberships m ON m.company_id=c.id
         WHERE c.id=$1 AND m.user_id=$2 AND m.is_active`,
        [payload.companyId, payload.userId],
      );
      if (!row && !payload.superAdmin) throw new AppError(401, "لم تعد عضواً في هذه المنشأة", "UNAUTHENTICATED");
      if (row) {
        req.company = row;
        req.auth.role = row.memberRole;
      } else {
        req.company = await db.maybe("SELECT * FROM companies WHERE id=$1", [payload.companyId]);
        req.auth.role = "OWNER";
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function subscriptionState(company: any): { active: boolean; readOnly: boolean; daysLeft: number | null; reason?: string } {
  if (!company) return { active: false, readOnly: true, daysLeft: null, reason: "NO_COMPANY" };
  if (company.status === "SUSPENDED") return { active: false, readOnly: true, daysLeft: 0, reason: "SUSPENDED" };
  if (!company.subscriptionEndsAt) return { active: true, readOnly: false, daysLeft: null };
  const days = Math.ceil((new Date(company.subscriptionEndsAt).getTime() - Date.now()) / 86400000);
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
        return next(new AppError(402, s.reason === "SUSPENDED" ? "الحساب موقوف، تواصل مع الإدارة" : "انتهى الاشتراك — النظام في وضع القراءة فقط. فعّل مفتاح ترخيص للاستمرار", "SUBSCRIPTION"));
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
