/**
 * Branch-restricted members ("يرى فرعه فقط"): a member with a home branch and restrict_branch=true
 * (never OWNER/ADMIN) is confined to that branch.
 *   • company-level screens are refused (VAT, zakat, budgets, payroll, closing, integrations…)
 *   • list/report endpoints get ?branchId=<their branch> forced
 *   • single records of another branch answer 404
 *   • every posting is checked in the engine (resolveBranch / warehouseBranch)
 */
import type { Request } from "express";
import { db } from "../db/pool";
import { AppError } from "./core";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// company-wide areas a branch-restricted member may not open (read or write)
const BLOCKED = [
  /^\/reports\/(vat|integrity|zakat|budget|cost-centers|salespersons|expenses-by-account)/,
  /^\/vat\//, /^\/vat$/, /^\/closing/, /^\/fiscal/, /^\/periods/, /^\/budgets/, /^\/payroll/, /^\/hr\//, /^\/employees/,
  /^\/assets/, /^\/backup/, /^\/integrations/, /^\/zatca$/, /^\/zatca\/(?!submit\/)/, /^\/users/, /^\/demo\//, /^\/bank/, /^\/recurring/, /^\/cheques/, /^\/audit/,
];
const BLOCKED_WRITE = [/^\/accounts/, /^\/settings/, /^\/branches/, /^\/warehouses/, /^\/currencies/, /^\/price-lists/, /^\/journals\/opening/];
// list / report endpoints that honour ?branchId
const FORCE_QUERY = [/^\/reports\//, /^\/journals$/, /^\/invoices$/, /^\/payments$/, /^\/expenses$/, /^\/dashboard$/, /^\/alerts$/, /^\/pos\/sessions$/, /^\/inventory\//, /^\/collections/, /^\/lots$/, /^\/branches$/, /^\/warehouses$/];

const RECORD: [RegExp, string][] = [
  [new RegExp(`^/invoices/(${UUID})`, "i"), `SELECT branch_id b FROM invoices WHERE id=$1 AND company_id=$2`],
  [new RegExp(`^/payments/(${UUID})`, "i"), `SELECT e.branch_id b FROM payments p JOIN journal_entries e ON e.id=p.journal_id WHERE p.id=$1 AND p.company_id=$2`],
  [new RegExp(`^/expenses/(${UUID})`, "i"), `SELECT e.branch_id b FROM expenses x JOIN journal_entries e ON e.id=x.journal_id WHERE x.id=$1 AND x.company_id=$2`],
  [new RegExp(`^/journals/(${UUID})`, "i"), `SELECT branch_id b FROM journal_entries WHERE id=$1 AND company_id=$2`],
  [new RegExp(`^/pos/session/(${UUID})`, "i"), `SELECT w.branch_id b FROM pos_sessions s JOIN warehouses w ON w.id=s.warehouse_id WHERE s.id=$1 AND s.company_id=$2`],
  [new RegExp(`^/doc-share/(${UUID})`, "i"), `SELECT branch_id b FROM invoices WHERE id=$1 AND company_id=$2`],
];

export async function applyBranchScope(req: Request, companyId: string, locked: string) {
  if ((req as any)._branchScoped === req.path) return;
  (req as any)._branchScoped = req.path;
  const path = req.path;
  const write = req.method !== "GET";
  if (BLOCKED.some((r) => r.test(path)) || (write && BLOCKED_WRITE.some((r) => r.test(path))))
    throw new AppError(403, "هذه الشاشة على مستوى المنشأة — صلاحيتك مقيدة بفرعك", "BRANCH_SCOPE");
  if (req.method === "GET" && FORCE_QUERY.some((r) => r.test(path))) {
    Object.defineProperty(req, "query", { value: { ...(req.query as any), branchId: locked }, writable: true, configurable: true, enumerable: true });
  }
  for (const [re, sql] of RECORD) {
    const m = path.match(re);
    if (!m) continue;
    const r = await db.maybe(sql, [m[1], companyId]);
    if (r && r.b && r.b !== locked) throw new AppError(404, "المستند غير موجود", "NOT_FOUND");
  }
}
