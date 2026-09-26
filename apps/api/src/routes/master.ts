import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, tx } from "../db/pool";
import { h, bad, conflict, notFound, req as need, num, paging, TAX_CODES, AppError } from "../lib/core";
import { authenticate, perm, cid, actor, p, ROLES } from "../lib/auth";
import { TYPE_BY_CLASS, SUBTYPE_AR } from "../accounting/coa";

export const master = Router();
master.use(authenticate);

export async function audit(req: any, action: string, entity: string, entityId: string | null, details?: any) {
  await db.insert("audit_logs", { companyId: req.company?.id || null, userId: req.auth.userId, userName: actor(req), action, entity, entityId, details: details || null }).catch(() => undefined);
}

// ─── partners ──────────────────────────────────────────────────────────────
master.get(
  "/partners",
  perm("partners.read"),
  h(async (req) => {
    const { limit, offset } = paging(req.query);
    const role = req.query.role === "SUPPLIER" ? "is_supplier" : req.query.role === "CUSTOMER" ? "is_customer" : null;
    const params: any[] = [cid(req)];
    const where = ["p.company_id=$1"];
    if (role) where.push(`p.${role}`);
    if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(p.name ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.phone ILIKE $${params.length} OR p.vat_number ILIKE $${params.length})`); }
    if (req.query.active !== "all") where.push("p.is_active");
    params.push(limit, offset);
    const rows = await db.rows(
      `SELECT p.*, COALESCE((SELECT SUM(CASE WHEN a.system_key='AR' THEN l.debit-l.credit ELSE l.credit-l.debit END) FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE l.partner_id=p.id AND a.system_key IN ('AR','AP') AND e.status='POSTED' AND ((a.system_key='AR' AND p.is_customer) OR (a.system_key='AP' AND p.is_supplier))),0) balance
       FROM partners p WHERE ${where.join(" AND ")} ORDER BY p.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  }),
);

master.get("/partners/:id", perm("partners.read"), h(async (req) => db.one(`SELECT * FROM partners WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)], "الطرف غير موجود")));

master.post(
  "/partners",
  perm("partners.write"),
  h(async (req) => {
    const b = req.body || {};
    const name = String(need(b, "name", "الاسم")).trim();
    if (!b.isCustomer && !b.isSupplier) b.isCustomer = true;
    if (b.vatNumber && !/^3\d{13}3$/.test(b.vatNumber)) throw bad("الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بـ 3");
    const code = b.code?.trim() || (await nextCode(cid(req), b.isSupplier && !b.isCustomer ? "S" : "C"));
    const row = await db.insert("partners", {
      companyId: cid(req), code, name, nameEn: b.nameEn || null, isCustomer: !!b.isCustomer, isSupplier: !!b.isSupplier, kind: b.kind === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY",
      vatNumber: b.vatNumber || null, crNumber: b.crNumber || null, phone: b.phone || null, email: b.email || null, street: b.street || null, buildingNo: b.buildingNo || null,
      district: b.district || null, city: b.city || null, postalCode: b.postalCode || null, country: b.country || "SA", creditLimit: num(b.creditLimit), paymentTerms: Math.max(0, Math.round(num(b.paymentTerms))), notes: b.notes || null,
    }).catch((e) => { if (e.code === "23505") throw conflict("كود العميل/المورد مستخدم مسبقاً"); throw e; });
    await audit(req, "CREATE", "partner", row.id, { name });
    return row;
  }),
);

master.put(
  "/partners/:id",
  perm("partners.write"),
  h(async (req) => {
    const b = req.body || {};
    if (b.vatNumber && !/^3\d{13}3$/.test(b.vatNumber)) throw bad("الرقم الضريبي غير صحيح");
    const row = await db.update("partners", { id: p(req).id, companyId: cid(req) }, {
      name: b.name, nameEn: b.nameEn, isCustomer: b.isCustomer, isSupplier: b.isSupplier, kind: b.kind, vatNumber: b.vatNumber ?? null, crNumber: b.crNumber ?? null, phone: b.phone ?? null, email: b.email ?? null,
      street: b.street ?? null, buildingNo: b.buildingNo ?? null, district: b.district ?? null, city: b.city ?? null, postalCode: b.postalCode ?? null, country: b.country, creditLimit: b.creditLimit === undefined ? undefined : num(b.creditLimit),
      paymentTerms: b.paymentTerms === undefined ? undefined : Math.round(num(b.paymentTerms)), notes: b.notes ?? null, isActive: b.isActive,
    });
    if (!row) throw notFound();
    await audit(req, "UPDATE", "partner", row.id, { name: row.name });
    return row;
  }),
);

master.delete(
  "/partners/:id",
  perm("partners.write"),
  h(async (req) => {
    const used = await db.maybe(`SELECT 1 FROM invoices WHERE partner_id=$1 UNION SELECT 1 FROM payments WHERE partner_id=$1 UNION SELECT 1 FROM journal_lines WHERE partner_id=$1 LIMIT 1`, [p(req).id]);
    if (used) {
      await db.exec(`UPDATE partners SET is_active=false WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
      return { ok: true, deactivated: true, message: "الطرف مرتبط بحركات — تم إيقافه بدلاً من حذفه" };
    }
    await db.exec(`DELETE FROM partners WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
    return { ok: true };
  }),
);

async function nextCode(companyId: string, prefix: string) {
  const r = await db.one(`INSERT INTO sequences(company_id, key, next) VALUES ($1,$2,2) ON CONFLICT (company_id, key) DO UPDATE SET next=sequences.next+1 RETURNING next-1 AS n`, [companyId, `CODE-${prefix}`]);
  return `${prefix}-${String(r.n).padStart(4, "0")}`;
}

// ─── products & categories ────────────────────────────────────────────────
master.get("/categories", perm("products.read"), h(async (req) => db.rows(`SELECT c.*, (SELECT COUNT(*)::int FROM products p WHERE p.category_id=c.id) count FROM product_categories c WHERE company_id=$1 ORDER BY name`, [cid(req)])));
master.post("/categories", perm("products.write"), h(async (req) => db.insert("product_categories", { companyId: cid(req), name: String(need(req.body, "name", "الاسم")), color: req.body.color || null })));
master.put("/categories/:id", perm("products.write"), h(async (req) => db.update("product_categories", { id: p(req).id, companyId: cid(req) }, { name: req.body.name, color: req.body.color })));
master.delete("/categories/:id", perm("products.write"), h(async (req) => { await db.exec(`UPDATE products SET category_id=NULL WHERE category_id=$1`, [p(req).id]); await db.exec(`DELETE FROM product_categories WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true }; }));

master.get(
  "/products",
  perm("products.read"),
  h(async (req) => {
    const { limit, offset } = paging(req.query);
    const params: any[] = [cid(req)];
    const where = ["p.company_id=$1"];
    if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`); }
    if (req.query.barcode) { params.push(req.query.barcode); where.push(`(p.barcode=$${params.length} OR p.sku=$${params.length})`); }
    if (req.query.categoryId) { params.push(req.query.categoryId); where.push(`p.category_id=$${params.length}`); }
    if (req.query.active !== "all") where.push("p.is_active");
    params.push(limit, offset);
    return db.rows(
      `SELECT p.*, c.name AS category, c.color AS category_color, COALESCE(s.qty,0) qty, COALESCE(s.value,0) stock_value, CASE WHEN COALESCE(s.qty,0)>0 THEN s.value/s.qty ELSE p.purchase_price END avg_cost
       FROM products p LEFT JOIN product_categories c ON c.id=p.category_id
       LEFT JOIN (SELECT product_id, SUM(qty) qty, SUM(value) value FROM stock_balances WHERE company_id=$1 GROUP BY product_id) s ON s.product_id=p.id
       WHERE ${where.join(" AND ")} ORDER BY p.sku LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
  }),
);

master.post(
  "/products",
  perm("products.write"),
  h(async (req) => {
    const b = req.body || {};
    const name = String(need(b, "name", "اسم الصنف")).trim();
    if (b.taxCode && !TAX_CODES[b.taxCode]) throw bad("رمز ضريبي غير صحيح");
    if (b.image && String(b.image).length > 400000) throw bad("الصورة كبيرة — الحد 300 كيلوبايت");
    const sku = b.sku?.trim() || (await nextCode(cid(req), "P"));
    const row = await db.insert("products", {
      companyId: cid(req), sku, barcode: b.barcode || null, name, nameEn: b.nameEn || null, type: b.type === "SERVICE" ? "SERVICE" : "STOCK", categoryId: b.categoryId || null, unit: b.unit || "حبة",
      salePrice: num(b.salePrice), purchasePrice: num(b.purchasePrice), taxCode: b.taxCode || "S", reorderLevel: num(b.reorderLevel), image: b.image || null,
    }).catch((e) => { if (e.code === "23505") throw conflict("رمز الصنف (SKU) مستخدم مسبقاً"); throw e; });
    if (b.openingQty && row.type === "STOCK") {
      const { stockAdjustment } = require("../services/misc") as typeof import("../services/misc");
      await tx((t) => stockAdjustment(t, cid(req), actor(req), { kind: "OPENING", lines: [{ productId: row.id, qty: num(b.openingQty), unitCost: num(b.purchasePrice) }] }));
    }
    await audit(req, "CREATE", "product", row.id, { name });
    return row;
  }),
);

master.put(
  "/products/:id",
  perm("products.write"),
  h(async (req) => {
    const b = req.body || {};
    if (b.taxCode && !TAX_CODES[b.taxCode]) throw bad("رمز ضريبي غير صحيح");
    const row = await db.update("products", { id: p(req).id, companyId: cid(req) }, {
      sku: b.sku, barcode: b.barcode ?? null, name: b.name, nameEn: b.nameEn ?? null, categoryId: b.categoryId ?? null, unit: b.unit, salePrice: b.salePrice === undefined ? undefined : num(b.salePrice),
      purchasePrice: b.purchasePrice === undefined ? undefined : num(b.purchasePrice), taxCode: b.taxCode, reorderLevel: b.reorderLevel === undefined ? undefined : num(b.reorderLevel), image: b.image, isActive: b.isActive, type: b.type,
    }).catch((e) => { if (e.code === "23505") throw conflict("رمز الصنف مستخدم مسبقاً"); throw e; });
    if (!row) throw notFound();
    return row;
  }),
);

master.delete(
  "/products/:id",
  perm("products.write"),
  h(async (req) => {
    const used = await db.maybe(`SELECT 1 FROM invoice_lines WHERE product_id=$1 UNION SELECT 1 FROM stock_moves WHERE product_id=$1 LIMIT 1`, [p(req).id]);
    if (used) { await db.exec(`UPDATE products SET is_active=false WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); return { ok: true, deactivated: true, message: "الصنف له حركات — تم إيقافه" }; }
    await db.exec(`DELETE FROM stock_balances WHERE product_id=$1`, [p(req).id]);
    await db.exec(`DELETE FROM products WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
    return { ok: true };
  }),
);

master.get("/warehouses", perm("inventory.read"), h(async (req) => db.rows(`SELECT * FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code`, [cid(req)])));
master.post("/warehouses", perm("inventory.write"), h(async (req) => db.insert("warehouses", { companyId: cid(req), code: String(need(req.body, "code", "الكود")), name: String(need(req.body, "name", "الاسم")) }).catch((e) => { if (e.code === "23505") throw conflict("الكود مستخدم"); throw e; })));
master.put("/warehouses/:id", perm("inventory.write"), h(async (req) => { if (req.body.isDefault) await db.exec(`UPDATE warehouses SET is_default=false WHERE company_id=$1`, [cid(req)]); return db.update("warehouses", { id: p(req).id, companyId: cid(req) }, { name: req.body.name, code: req.body.code, isDefault: req.body.isDefault, isActive: req.body.isActive }); }));

// ─── chart of accounts ─────────────────────────────────────────────────────
master.get(
  "/accounts",
  perm("accounting.read"),
  h(async (req) => {
    const rows = await db.rows(
      `SELECT a.*, COALESCE(b.bal,0) balance FROM accounts a LEFT JOIN (SELECT l.account_id, SUM(l.debit-l.credit) bal FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.company_id=$1 AND e.status='POSTED' GROUP BY l.account_id) b ON b.account_id=a.id
       WHERE a.company_id=$1 ORDER BY a.code`,
      [cid(req)],
    );
    // roll balances up to group accounts
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      let p = r.parentId ? byId.get(r.parentId) : null;
      while (p) { p.balance = Number(p.balance) + Number(r.balance) * (r.isGroup ? 0 : 1); p = p.parentId ? byId.get(p.parentId) : null; }
    }
    return { rows, subtypes: SUBTYPE_AR };
  }),
);

master.post(
  "/accounts",
  perm("accounting.write"),
  h(async (req) => {
    const b = req.body || {};
    const code = String(need(b, "code", "رقم الحساب")).trim();
    const nameAr = String(need(b, "nameAr", "اسم الحساب")).trim();
    const parent = b.parentId ? await db.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2`, [b.parentId, cid(req)], "الحساب الرئيسي غير موجود") : null;
    if (!parent && !TYPE_BY_CLASS[code[0]]) throw bad("رقم الحساب يجب أن يبدأ بـ 1-5");
    const type = parent ? parent.type : TYPE_BY_CLASS[code[0]];
    const subtype = b.subtype || parent?.subtype || type;
    if (!SUBTYPE_AR[subtype]) throw bad("تصنيف الحساب غير صحيح");
    if (parent) {
      const posted = await db.maybe(`SELECT 1 FROM journal_lines WHERE account_id=$1 LIMIT 1`, [parent.id]);
      if (posted) throw bad("لا يمكن إضافة حساب فرعي تحت حساب عليه حركات");
      if (!parent.isGroup) await db.exec(`UPDATE accounts SET is_group=true WHERE id=$1`, [parent.id]);
    }
    const row = await db.insert("accounts", { companyId: cid(req), code, nameAr, nameEn: b.nameEn || null, type, subtype, parentId: parent?.id || null, level: parent ? parent.level + 1 : 1, isGroup: !!b.isGroup, isCashBank: !!b.isCashBank || ["CASH", "BANK"].includes(subtype) && !b.isGroup })
      .catch((e) => { if (e.code === "23505") throw conflict("رقم الحساب مستخدم مسبقاً"); throw e; });
    await audit(req, "CREATE", "account", row.id, { code, nameAr });
    return row;
  }),
);

master.put(
  "/accounts/:id",
  perm("accounting.write"),
  h(async (req) => {
    const a = await db.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
    const b = req.body || {};
    if (b.subtype && !SUBTYPE_AR[b.subtype]) throw bad("تصنيف غير صحيح");
    if (b.isActive === false && a.systemKey) throw bad("لا يمكن إيقاف حساب نظامي");
    const row = await db.update("accounts", { id: a.id }, { code: b.code, nameAr: b.nameAr, nameEn: b.nameEn, subtype: b.subtype, isActive: b.isActive, isCashBank: b.isCashBank })
      .catch((e) => { if (e.code === "23505") throw conflict("رقم الحساب مستخدم مسبقاً"); throw e; });
    return row;
  }),
);

master.delete(
  "/accounts/:id",
  perm("accounting.write"),
  h(async (req) => {
    const a = await db.one(`SELECT * FROM accounts WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
    if (a.systemKey || a.isSystem) throw bad("لا يمكن حذف حساب نظامي");
    const used = await db.maybe(`SELECT 1 FROM journal_lines WHERE account_id=$1 UNION SELECT 1 FROM accounts WHERE parent_id=$1 LIMIT 1`, [a.id]);
    if (used) throw bad("الحساب عليه حركات أو له حسابات فرعية");
    await db.exec(`DELETE FROM accounts WHERE id=$1`, [a.id]);
    return { ok: true };
  }),
);

master.get("/cost-centers", perm("accounting.read"), h(async (req) => db.rows(`SELECT * FROM cost_centers WHERE company_id=$1 ORDER BY code`, [cid(req)])));
master.post("/cost-centers", perm("accounting.write"), h(async (req) => db.insert("cost_centers", { companyId: cid(req), code: String(need(req.body, "code", "الكود")), name: String(need(req.body, "name", "الاسم")) })));

// ─── company settings & users ──────────────────────────────────────────────
master.get("/settings", perm("settings.read"), h(async (req) => ({ ...(await db.one(`SELECT * FROM companies WHERE id=$1`, [cid(req)])), zatca: await db.maybe(`SELECT company_id, phase, environment, egs_serial, egs_uuid, branch_name, industry, onboarded_at, icv_counter, (compliance_cert IS NOT NULL) has_compliance, (production_cert IS NOT NULL) has_production, (csr IS NOT NULL) has_csr FROM zatca_configs WHERE company_id=$1`, [cid(req)]) })));

master.put(
  "/settings",
  perm("settings.write"),
  h(async (req) => {
    const b = req.body || {};
    if (b.vatNumber && !/^3\d{13}3$/.test(b.vatNumber)) throw bad("الرقم الضريبي يجب أن يكون 15 رقماً يبدأ وينتهي بـ 3");
    if (b.logo && String(b.logo).length > 400000) throw bad("الشعار كبير — الحد 300 كيلوبايت");
    const row = await db.update("companies", { id: cid(req) }, {
      nameAr: b.nameAr, nameEn: b.nameEn, vatNumber: b.vatNumber ?? null, crNumber: b.crNumber ?? null, phone: b.phone, email: b.email, website: b.website, logo: b.logo, street: b.street, buildingNo: b.buildingNo, additionalNo: b.additionalNo,
      district: b.district, city: b.city, postalCode: b.postalCode, fiscalYearStart: b.fiscalYearStart === undefined ? undefined : Math.min(12, Math.max(1, Math.round(num(b.fiscalYearStart)))),
      allowNegativeStock: b.allowNegativeStock, pricesIncludeVat: b.pricesIncludeVat, invoiceFooter: b.invoiceFooter, invoiceTerms: b.invoiceTerms, invoiceTemplate: b.invoiceTemplate, updatedAt: new Date(),
    });
    await audit(req, "UPDATE", "settings", cid(req));
    return row;
  }),
);

master.get("/users", perm("users.read"), h(async (req) => db.rows(`SELECT m.id, m.role, m.is_active, m.created_at, u.id AS user_id, u.email, u.full_name, u.phone, u.last_login_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=$1 ORDER BY m.created_at`, [cid(req)])));

master.post(
  "/users",
  perm("users.write"),
  h(async (req) => {
    const b = req.body || {};
    const email = String(need(b, "email", "البريد")).trim().toLowerCase();
    const role = String(b.role || "ACCOUNTANT").toUpperCase();
    if (!ROLES[role] || role === "OWNER") throw bad("الدور غير صحيح");
    const count = await db.one(`SELECT COUNT(*)::int c FROM memberships WHERE company_id=$1 AND is_active`, [cid(req)]);
    if (count.c >= req.company.maxUsers) throw new AppError(402, `وصلت للحد الأقصى للمستخدمين في خطتك (${req.company.maxUsers}) — رقِّ الاشتراك`, "SUBSCRIPTION");
    return tx(async (t) => {
      let u = await t.maybe(`SELECT * FROM users WHERE email=$1`, [email]);
      if (!u) {
        const password = String(need(b, "password", "كلمة المرور"));
        if (password.length < 8) throw bad("كلمة المرور قصيرة");
        u = await t.insert("users", { email, passwordHash: await bcrypt.hash(password, 10), fullName: String(need(b, "fullName", "الاسم")), phone: b.phone || null });
      }
      const m = await t.insert("memberships", { companyId: cid(req), userId: u.id, role }).catch((e) => { if (e.code === "23505") throw conflict("المستخدم عضو بالفعل"); throw e; });
      await audit(req, "CREATE", "user", u.id, { email, role });
      return { ...m, email, fullName: u.fullName };
    });
  }),
);

master.put(
  "/users/:id",
  perm("users.write"),
  h(async (req) => {
    const m = await db.one(`SELECT * FROM memberships WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]);
    if (m.role === "OWNER" && req.auth.role !== "OWNER") throw bad("لا يمكن تعديل المالك");
    const role = req.body.role ? String(req.body.role).toUpperCase() : undefined;
    if (role && (!ROLES[role] || (role === "OWNER" && req.auth.role !== "OWNER"))) throw bad("الدور غير صحيح");
    if (req.body.password) {
      if (String(req.body.password).length < 8) throw bad("كلمة المرور قصيرة");
      await db.exec(`UPDATE users SET password_hash=$2 WHERE id=$1`, [m.userId, await bcrypt.hash(String(req.body.password), 10)]);
    }
    if (req.body.fullName) await db.exec(`UPDATE users SET full_name=$2 WHERE id=$1`, [m.userId, req.body.fullName]);
    return db.update("memberships", { id: m.id }, { role, isActive: req.body.isActive });
  }),
);

master.delete("/users/:id", perm("users.write"), h(async (req) => { const m = await db.one(`SELECT * FROM memberships WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req)]); if (m.role === "OWNER") throw bad("لا يمكن حذف المالك"); await db.exec(`DELETE FROM memberships WHERE id=$1`, [m.id]); return { ok: true }; }));

master.get("/audit", perm("settings.read"), h(async (req) => { const { limit, offset } = paging(req.query); return db.rows(`SELECT * FROM audit_logs WHERE company_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [cid(req), limit, offset]); }));

master.get("/fiscal-years", perm("accounting.read"), h(async (req) => ({ years: await db.rows(`SELECT * FROM fiscal_years WHERE company_id=$1 ORDER BY start_date DESC`, [cid(req)]), periods: await db.rows(`SELECT * FROM periods WHERE company_id=$1 ORDER BY start_date`, [cid(req)]) })));
master.put("/periods/:id", perm("accounting.write"), h(async (req) => { const status = req.body.status === "LOCKED" ? "LOCKED" : "OPEN"; await db.exec(`UPDATE periods SET status=$3 WHERE id=$1 AND company_id=$2`, [p(req).id, cid(req), status]); await audit(req, status === "LOCKED" ? "LOCK_PERIOD" : "UNLOCK_PERIOD", "period", p(req).id); return { ok: true }; }));
