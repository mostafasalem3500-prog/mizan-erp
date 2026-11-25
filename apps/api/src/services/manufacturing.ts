/**
 * 3.49.0 — Manufacturing (التصنيع): for a workshop, a factory or an assembly centre, from a small item to a large one.
 *
 *  • Work centres: a machine, a line, a team or an outside workshop, with cost per hour (labour + overhead), per unit
 *    (outsourced), daily capacity, units in parallel and efficiency.
 *  • Bills of materials: components with waste %, the stage each one is used in, stages (operations) with set-up and
 *    run time on a work centre and an optional quality check, by-products with a share of the cost, versions and a
 *    default, and «kits» (phantom BOMs exploded into the parent's components). Multi-level: a component may itself
 *    have a BOM. Standard cost rolls up through the levels.
 *  • Manufacturing orders: draft → confirmed → in progress → done (or cancelled). Materials are issued (or back-flushed
 *    at production), returned, substituted; stages are started and finished with their time and QC result; output is
 *    received in parts or at once, with normal or abnormal scrap and by-products; an order can be closed short.
 *  • Accounting (absorption costing, IAS 2): issue Dr WIP / Cr inventory; time Dr WIP / Cr «applied production costs»
 *    (a credit in cost of sales that offsets the salaries and overheads already expensed); receipt Dr inventory / Cr WIP
 *    (part receipts at standard, the final one takes everything left, so the product carries its actual cost);
 *    abnormal scrap Dr scrap / Cr WIP; a short close sends what is left to variances. WIP of the open orders always
 *    equals the WIP account.
 *  • Disassembly (unbuild), material requirements planning (multi-level, low-level codes), finite-capacity scheduling
 *    by work centre, the shop-floor list, and the reports.
 */
import { Db } from "../db/pool";
import { AppError, bad, conflict, num, r2, r3, isDate, today, addDays } from "../lib/core";
import { nextNumber, post, assertOpenDate, warehouseBranch } from "../accounting/engine";
import { stockIn, stockOut } from "../accounting/stock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uid = (x: any) => (UUID.test(String(x || "")) ? String(x) : null);
const n = (x: any) => Number(x || 0);
const iso = (d: any) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const txt = (x: any, max = 300) => (x === undefined || x === null || String(x).trim() === "" ? null : String(x).trim().slice(0, max));
export const WC_KINDS = ["MACHINE", "LABOR", "LINE", "ASSEMBLY", "OUTSOURCE"];
export const MO_OPEN = ["DRAFT", "CONFIRMED", "IN_PROGRESS"];

// ───────────────────────── accounts ─────────────────────────
async function ensureNear(t: Db, C: string, key: string, near: string, nameAr: string, nameEn: string, from: number) {
  const a = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [C, key]);
  if (a) return a.id as string;
  const base = await t.one(`SELECT * FROM accounts WHERE company_id=$1 AND system_key=$2`, [C, near], `الحساب الافتراضي (${near}) غير موجود في دليل الحسابات`);
  const prefix = String(base.code).slice(0, -2);
  const used = new Set((await t.rows(`SELECT code FROM accounts WHERE company_id=$1 AND code LIKE $2`, [C, `${prefix}%`])).map((x: any) => x.code));
  let code = ""; for (let i = from; i < 100 && !code; i++) { const c = `${prefix}${String(i).padStart(2, "0")}`; if (!used.has(c)) code = c; }
  if (!code) throw bad(`لا يوجد رمز متاح لحساب جديد تحت ${prefix}`);
  const r = await t.insert("accounts", { companyId: C, code, nameAr, nameEn, type: base.type, subtype: base.subtype, parentId: base.parentId, level: base.level, isGroup: false, isSystem: true, systemKey: key, isActive: true });
  return r.id as string;
}
export async function mfgAccounts(t: Db, C: string) {
  return {
    wip: await ensureNear(t, C, "WIP", "INVENTORY", "إنتاج تحت التشغيل", "Work in Process", 2),
    applied: await ensureNear(t, C, "MFG_APPLIED", "COGS", "تكاليف تشغيل محمّلة على الإنتاج (دائن)", "Production Costs Absorbed (credit)", 10),
    variance: await ensureNear(t, C, "MFG_VARIANCE", "COGS", "انحرافات أوامر التصنيع", "Manufacturing Variances", 11),
    scrap: await ensureNear(t, C, "MFG_SCRAP", "COGS", "تالف التصنيع غير العادي", "Abnormal Production Scrap", 12),
  };
}

// ───────────────────────── work centres ─────────────────────────
export async function listWorkCenters(t: Db, C: string) {
  const rows = await t.rows(`SELECT w.*, cc.name cost_center_name FROM mfg_work_centers w LEFT JOIN cost_centers cc ON cc.id=w.cost_center_id WHERE w.company_id=$1 ORDER BY w.is_active DESC, w.code`, [C]);
  const open = await t.rows(`SELECT o.ops FROM mfg_orders o WHERE o.company_id=$1 AND o.status = ANY($2)`, [C, MO_OPEN]);
  const load = new Map<string, { ops: number; min: number }>();
  for (const o of open) for (const op of o.ops || []) { if (op.status === "DONE" || !op.workCenterId) continue; const g = load.get(op.workCenterId) || { ops: 0, min: 0 }; g.ops++; g.min += Math.max(0, n(op.plannedMin) - n(op.actualMin)); load.set(op.workCenterId, g); }
  return rows.map((w: any) => ({ ...shapeWc(w), openOps: load.get(w.id)?.ops || 0, openHours: r2((load.get(w.id)?.min || 0) / 60) }));
}
const shapeWc = (w: any) => ({ id: w.id, code: w.code, name: w.name, kind: w.kind, rateHour: n(w.rateHour), overheadHour: n(w.overheadHour), rateUnit: n(w.rateUnit), costHour: r2(n(w.rateHour) + n(w.overheadHour)), capacityHours: n(w.capacityHours), units: n(w.units), efficiencyPct: n(w.efficiencyPct), dailyMinutes: Math.round(n(w.capacityHours) * 60 * n(w.units) * n(w.efficiencyPct) / 100), costCenterId: w.costCenterId, costCenterName: w.costCenterName || null, isActive: w.isActive, notes: w.notes, isDemo: w.isDemo });

export async function saveWorkCenter(t: Db, C: string, b: any, id?: string, opts: { isDemo?: boolean } = {}) {
  const name = txt(b.name, 80); if (!name) throw bad("اسم مركز العمل مطلوب");
  const kind = WC_KINDS.includes(b.kind) ? b.kind : "MACHINE";
  const nums = { rateHour: num(b.rateHour), overheadHour: num(b.overheadHour), rateUnit: num(b.rateUnit) };
  if (Object.values(nums).some((x) => x < 0)) throw bad("التكاليف لا تكون سالبة");
  const capacityHours = b.capacityHours === undefined ? 8 : num(b.capacityHours); if (!(capacityHours > 0 && capacityHours <= 24)) throw bad("ساعات العمل في اليوم بين 1 و24");
  const units = b.units === undefined ? 1 : Math.round(num(b.units)); if (!(units >= 1 && units <= 999)) throw bad("عدد الآلات أو العمال بين 1 و999");
  const efficiencyPct = b.efficiencyPct === undefined ? 100 : num(b.efficiencyPct); if (!(efficiencyPct >= 10 && efficiencyPct <= 200)) throw bad("الكفاءة بين 10% و200%");
  const cc = uid(b.costCenterId) ? (await t.one(`SELECT id FROM cost_centers WHERE id=$1 AND company_id=$2`, [b.costCenterId, C], "مركز التكلفة غير موجود")).id : null;
  let code = txt(b.code, 20);
  if (!code && !id) { const c = await t.one(`SELECT COUNT(*)::int c FROM mfg_work_centers WHERE company_id=$1`, [C]); code = `WC-${String(c.c + 1).padStart(2, "0")}`; }
  if (code && await t.maybe(`SELECT 1 FROM mfg_work_centers WHERE company_id=$1 AND code=$2 AND id <> COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000')`, [C, code, uid(id)])) throw conflict(`الرمز ${code} مستخدم لمركز عمل آخر`);
  const row = { name, kind, ...nums, capacityHours, units, efficiencyPct, costCenterId: cc, notes: txt(b.notes, 500), isActive: b.isActive === undefined ? true : !!b.isActive, ...(code ? { code } : {}) };
  if (id) { const r = await t.update("mfg_work_centers", { id: uid(id), companyId: C }, row); if (!r) throw new AppError(404, "مركز العمل غير موجود"); return shapeWc(r); }
  return shapeWc(await t.insert("mfg_work_centers", { companyId: C, ...row, isDemo: !!opts.isDemo }));
}
export async function deleteWorkCenter(t: Db, C: string, id: string) {
  const w = await t.one(`SELECT * FROM mfg_work_centers WHERE id=$1 AND company_id=$2`, [uid(id), C], "مركز العمل غير موجود");
  const used = await t.one(`SELECT (SELECT COUNT(*) FROM mfg_boms b, jsonb_array_elements(b.ops) o WHERE b.company_id=$1 AND o->>'workCenterId'=$2)::int + (SELECT COUNT(*) FROM mfg_orders m, jsonb_array_elements(m.ops) o WHERE m.company_id=$1 AND o->>'workCenterId'=$2)::int c`, [C, w.id]);
  if (used.c) { await t.exec(`UPDATE mfg_work_centers SET is_active=false WHERE id=$1`, [w.id]); return { deactivated: true }; }
  await t.exec(`DELETE FROM mfg_work_centers WHERE id=$1`, [w.id]);
  return { deleted: true };
}

// ───────────────────────── costing context (all BOMs, current costs) ─────────────────────────
type Cx = { prods: Map<string, any>; boms: Map<string, any>; def: Map<string, any>; avg: Map<string, number>; onHand: Map<string, number>; wcs: Map<string, any> };
async function loadCx(t: Db, C: string): Promise<Cx> {
  const [prods, boms, bal, wcs] = await Promise.all([
    t.rows(`SELECT id, sku, name, unit, type, purchase_price, reorder_level, is_active FROM products WHERE company_id=$1`, [C]),
    t.rows(`SELECT * FROM mfg_boms WHERE company_id=$1 AND is_active ORDER BY is_default DESC, version DESC`, [C]),
    t.rows(`SELECT product_id, SUM(qty) q, SUM(value) v FROM stock_balances WHERE company_id=$1 GROUP BY product_id`, [C]),
    t.rows(`SELECT * FROM mfg_work_centers WHERE company_id=$1`, [C]),
  ]);
  const cx: Cx = { prods: new Map(prods.map((p: any) => [p.id, p])), boms: new Map(boms.map((b: any) => [b.id, b])), def: new Map(), avg: new Map(), onHand: new Map(), wcs: new Map(wcs.map((w: any) => [w.id, w])) };
  for (const b of boms) if (!cx.def.has(b.productId)) cx.def.set(b.productId, b); // default first, then the newest version
  for (const r of bal) { cx.onHand.set(r.productId, n(r.q)); if (n(r.q) > 0) cx.avg.set(r.productId, n(r.v) / n(r.q)); }
  return cx;
}
/** Current cost of one unit: average stock cost when there is stock, else the rolled-up BOM cost, else the purchase price. */
function unitCostOf(cx: Cx, pid: string, seen: Set<string>): number {
  const b = cx.def.get(pid);
  if (b?.kind === "KIT" && !seen.has(pid)) return rollup(cx, b, new Set([...seen, pid])).unitCost;
  if (cx.avg.has(pid)) return cx.avg.get(pid)!;
  if (b && !seen.has(pid)) return rollup(cx, b, new Set([...seen, pid])).unitCost;
  return n(cx.prods.get(pid)?.purchasePrice);
}
function rollup(cx: Cx, bom: any, seen = new Set<string>([bom.productId]), forQty?: number) {
  const out = n(bom.outputQty) || 1;
  const setupOver = forQty && forQty > 0 ? forQty : n(bom.lotQty) > 0 ? n(bom.lotQty) : out; // set-up time is spread over the quantity made (or the usual run)
  const lines = (bom.lines || []).map((l: any) => {
    const p = cx.prods.get(l.componentId) || {};
    const eff = n(l.qty) * (1 + n(l.wastePct) / 100);
    const uc = unitCostOf(cx, l.componentId, seen);
    const sub = cx.def.get(l.componentId);
    return { componentId: l.componentId, sku: p.sku, name: p.name || "؟", unit: p.unit, qty: n(l.qty), wastePct: n(l.wastePct), effQty: r3(eff), opSeq: l.opSeq ?? null, note: l.note || null, unitCost: Math.round(uc * 10000) / 10000, cost: r2(eff * uc), perUnit: (eff / out) * uc, hasBom: !!sub, bomKind: sub?.kind || null, onHand: cx.onHand.get(l.componentId) || 0 };
  });
  const ops = (bom.ops || []).map((o: any) => {
    const w = cx.wcs.get(o.workCenterId) || {};
    const minPerUnit = n(o.setupMin) / setupOver + n(o.runMin);
    const perUnit = (minPerUnit / 60) * (n(w.rateHour) + n(w.overheadHour)) + n(w.rateUnit);
    return { seq: n(o.seq), name: o.name, workCenterId: o.workCenterId, workCenter: w.name || "؟", setupMin: n(o.setupMin), runMin: n(o.runMin), qc: !!o.qc, instructions: o.instructions || null, costHour: r2(n(w.rateHour) + n(w.overheadHour)), rateUnit: n(w.rateUnit), minPerUnit: r2(minPerUnit), perUnit };
  });
  const material = lines.reduce((a: number, l: any) => a + l.perUnit, 0);
  const conversion = ops.reduce((a: number, o: any) => a + o.perUnit, 0);
  const share = (bom.byproducts || []).reduce((a: number, x: any) => a + n(x.sharePct), 0);
  const total = material + conversion;
  const byproducts = (bom.byproducts || []).map((x: any) => { const p = cx.prods.get(x.productId) || {}; return { productId: x.productId, sku: p.sku, name: p.name || "؟", unit: p.unit, qty: n(x.qty), sharePct: n(x.sharePct), unitCost: n(x.qty) > 0 ? Math.round(((total * out * n(x.sharePct)) / 100 / n(x.qty)) * 10000) / 10000 : 0 }; });
  const rd = (x: number) => Math.round(x * 10000) / 10000;
  return { outputQty: out, material: rd(material), conversion: rd(conversion), total: rd(total), byproductShare: share, unitCost: rd(total * (1 - share / 100)), batchCost: r2(total * out), lines: lines.map(({ perUnit, ...l }: any) => ({ ...l, perUnit: rd(perUnit) })), ops: ops.map(({ perUnit, ...o }: any) => ({ ...o, perUnit: rd(perUnit) })), byproducts };
}

// ───────────────────────── bills of materials ─────────────────────────
const shapeBom = (b: any, cx: Cx) => {
  const p = cx.prods.get(b.productId) || {};
  return { id: b.id, code: b.code, version: b.version, name: b.name, kind: b.kind, productId: b.productId, sku: p.sku, productName: p.name, unit: p.unit, outputQty: n(b.outputQty), lotQty: b.lotQty === null || b.lotQty === undefined ? null : n(b.lotQty), isDefault: b.isDefault, isActive: b.isActive, notes: b.notes, lines: b.lines || [], ops: b.ops || [], byproducts: b.byproducts || [], isDemo: b.isDemo, updatedAt: b.updatedAt };
};
export async function listBoms(t: Db, C: string, q: any = {}) {
  const cx = await loadCx(t, C);
  const all = await t.rows(`SELECT * FROM mfg_boms WHERE company_id=$1 ${uid(q.productId) ? "AND product_id=$2" : ""} ORDER BY is_active DESC, code`, uid(q.productId) ? [C, q.productId] : [C]);
  const orders = await t.rows(`SELECT bom_id, COUNT(*)::int c FROM mfg_orders WHERE company_id=$1 GROUP BY bom_id`, [C]);
  const oc = new Map(orders.map((o: any) => [o.bomId, o.c]));
  return all.map((b: any) => { const r = rollup(cx, b); return { ...shapeBom(b, cx), components: (b.lines || []).length, stages: (b.ops || []).length, unitCost: r.unitCost, material: r.material, conversion: r.conversion, levels: depthOf(cx, b.productId), orders: oc.get(b.id) || 0 }; });
}
function depthOf(cx: Cx, pid: string, seen = new Set<string>()): number {
  const b = cx.def.get(pid); if (!b || seen.has(pid)) return 0;
  seen.add(pid);
  return 1 + Math.max(0, ...(b.lines || []).map((l: any) => depthOf(cx, l.componentId, new Set(seen))));
}
export async function getBom(t: Db, C: string, id: string) {
  const cx = await loadCx(t, C);
  const b = await t.one(`SELECT * FROM mfg_boms WHERE id=$1 AND company_id=$2`, [uid(id), C], "قائمة المواد غير موجودة");
  const usedIn = await t.rows(`SELECT b.id, b.code, b.product_id, p.name FROM mfg_boms b JOIN products p ON p.id=b.product_id, jsonb_array_elements(b.lines) l WHERE b.company_id=$1 AND l->>'componentId'=$2 AND b.is_active`, [C, b.productId]);
  const versions = await t.rows(`SELECT id, code, version, is_default, is_active, updated_at FROM mfg_boms WHERE company_id=$1 AND product_id=$2 ORDER BY version DESC`, [C, b.productId]);
  return { ...shapeBom(b, cx), cost: rollup(cx, b), tree: tree(cx, b, 1, n(b.outputQty)), usedIn: usedIn.map((u: any) => ({ id: u.id, code: u.code, productId: u.productId, name: u.name })), versions };
}
/** The multi-level structure for the given quantity of the product. */
function tree(cx: Cx, bom: any, factor: number, qty: number, seen = new Set<string>([bom.productId]), depth = 0): any[] {
  const out = n(bom.outputQty) || 1;
  return (bom.lines || []).map((l: any) => {
    const p = cx.prods.get(l.componentId) || {};
    const need = r3((n(l.qty) * (1 + n(l.wastePct) / 100) * qty) / out);
    const sub = cx.def.get(l.componentId);
    return { componentId: l.componentId, sku: p.sku, name: p.name, unit: p.unit, qty: need, onHand: r3(cx.onHand.get(l.componentId) || 0), unitCost: Math.round(unitCostOf(cx, l.componentId, seen) * 10000) / 10000, kind: sub?.kind || null, children: sub && !seen.has(l.componentId) && depth < 6 ? tree(cx, sub, factor, need, new Set([...seen, l.componentId]), depth + 1) : [] };
  });
}
export async function saveBom(t: Db, C: string, b: any, id?: string, opts: { isDemo?: boolean } = {}) {
  const prev = id ? await t.one(`SELECT * FROM mfg_boms WHERE id=$1 AND company_id=$2 FOR UPDATE`, [uid(id), C], "قائمة المواد غير موجودة") : null;
  const productId = prev ? prev.productId : uid(b.productId);
  const prod = await t.one(`SELECT id, sku, name, type FROM products WHERE id=$1 AND company_id=$2`, [productId, C], "الصنف المنتَج غير موجود");
  if (prod.type !== "STOCK") throw bad("المنتَج يجب أن يكون صنفاً مخزنياً: يدخل المخزون بعد التصنيع");
  const kind = b.kind === "KIT" ? "KIT" : "MANUFACTURE";
  const outputQty = b.outputQty === undefined ? 1 : num(b.outputQty);
  if (!(outputQty > 0)) throw bad("كمية الناتج (حجم الدفعة) يجب أن تكون أكبر من صفر");
  // stages
  const rawOps: any[] = Array.isArray(b.ops) ? b.ops : [];
  if (rawOps.length > 40) throw bad("حتى 40 مرحلة");
  if (kind === "KIT" && rawOps.length) throw bad("الطقم (Kit) لا مراحل له: يُفكّ إلى مكوناته داخل المنتج الذي يستخدمه");
  const wcIds = new Set((await t.rows(`SELECT id FROM mfg_work_centers WHERE company_id=$1 AND is_active`, [C])).map((r: any) => r.id));
  const seqs = new Set<number>();
  const ops = rawOps.map((o: any, i: number) => {
    const seq = o.seq ? Math.round(num(o.seq)) : (i + 1) * 10;
    if (seqs.has(seq)) throw bad(`رقم المرحلة ${seq} مكرر`); seqs.add(seq);
    const name = txt(o.name, 80); if (!name) throw bad(`اسم المرحلة ${seq} مطلوب`);
    if (!wcIds.has(String(o.workCenterId))) throw bad(`اختر مركز عمل نشطاً للمرحلة «${name}»`);
    const setupMin = num(o.setupMin), runMin = num(o.runMin);
    if (setupMin < 0 || runMin < 0) throw bad(`زمن المرحلة «${name}» لا يكون سالباً`);
    return { seq, name, workCenterId: String(o.workCenterId), setupMin, runMin, qc: !!o.qc, instructions: txt(o.instructions, 1000) };
  }).sort((a: any, z: any) => a.seq - z.seq);
  // components
  const rawLines: any[] = Array.isArray(b.lines) ? b.lines : [];
  if (!rawLines.length) throw bad("أضف مكوّناً واحداً على الأقل");
  if (rawLines.length > 200) throw bad("حتى 200 مكوّن");
  const ids = rawLines.map((l) => uid(l.componentId)).filter(Boolean) as string[];
  const comps = new Map((await t.rows(`SELECT id, name, type FROM products WHERE company_id=$1 AND id = ANY($2)`, [C, ids])).map((p: any) => [p.id, p]));
  const seenC = new Set<string>();
  const lines = rawLines.map((l: any) => {
    const p = comps.get(String(l.componentId)); if (!p) throw bad("أحد المكونات غير موجود");
    if (p.id === productId) throw bad("الصنف لا يدخل في تصنيع نفسه");
    if (p.type !== "STOCK") throw bad(`المكوّن «${p.name}» ليس صنفاً مخزنياً`);
    if (seenC.has(p.id)) throw bad(`المكوّن «${p.name}» مكرر — اجمع كميته في سطر واحد`); seenC.add(p.id);
    const qty = num(l.qty); if (!(qty > 0)) throw bad(`كمية «${p.name}» يجب أن تكون أكبر من صفر`);
    const wastePct = num(l.wastePct); if (wastePct < 0 || wastePct > 90) throw bad(`نسبة هالك «${p.name}» بين 0 و90%`);
    const opSeq = l.opSeq === undefined || l.opSeq === null || l.opSeq === "" ? null : Math.round(num(l.opSeq));
    if (opSeq !== null && !seqs.has(opSeq)) throw bad(`المرحلة ${opSeq} المحددة لـ«${p.name}» غير موجودة`);
    return { componentId: p.id, qty, wastePct, opSeq, note: txt(l.note, 200) };
  });
  // by-products
  const rawBy: any[] = Array.isArray(b.byproducts) ? b.byproducts : [];
  const byIds = rawBy.map((x) => uid(x.productId)).filter(Boolean) as string[];
  const byP = new Map((await t.rows(`SELECT id, name, type FROM products WHERE company_id=$1 AND id = ANY($2)`, [C, byIds])).map((p: any) => [p.id, p]));
  const byproducts = rawBy.map((x: any) => {
    const p = byP.get(String(x.productId)); if (!p) throw bad("أحد المنتجات الثانوية غير موجود");
    if (p.id === productId || seenC.has(p.id)) throw bad(`«${p.name}» لا يكون منتجاً ثانوياً ومكوّناً أو منتجاً رئيسياً معاً`);
    if (p.type !== "STOCK") throw bad(`المنتج الثانوي «${p.name}» يجب أن يكون صنفاً مخزنياً`);
    const qty = num(x.qty), sharePct = num(x.sharePct);
    if (!(qty > 0)) throw bad(`كمية «${p.name}» يجب أن تكون أكبر من صفر`);
    if (sharePct < 0 || sharePct > 90) throw bad(`نصيب «${p.name}» من التكلفة بين 0 و90%`);
    return { productId: p.id, qty, sharePct };
  });
  if (byproducts.reduce((a, x) => a + x.sharePct, 0) >= 100) throw bad("مجموع أنصبة المنتجات الثانوية يجب أن يقل عن 100%");
  if (kind === "KIT" && byproducts.length) throw bad("الطقم لا منتجات ثانوية له");
  // no cycle through the default BOMs (with this one in place)
  const cx = await loadCx(t, C);
  const willDefault = prev ? (b.isDefault === undefined ? prev.isDefault : !!b.isDefault) : b.isDefault === undefined ? !cx.def.has(productId!) : !!b.isDefault;
  const graph = (pid: string): string[] => (pid === productId ? lines.map((l) => l.componentId) : (cx.def.get(pid)?.lines || []).map((l: any) => l.componentId));
  const walk = (pid: string, path: string[]): void => {
    if (path.length > 12) throw bad("قائمة المواد أعمق من 12 مستوى");
    for (const c of graph(pid)) { if (c === productId) throw bad(`دوران: «${cx.prods.get(pid)?.name || ""}» يحتاج «${prod.name}» الذي يحتاجه`); if (!path.includes(c)) walk(c, [...path, c]); }
  };
  walk(productId!, [productId!]);
  const lotQty = num(b.lotQty) > 0 ? num(b.lotQty) : null;
  const row: any = { name: txt(b.name, 120), kind, outputQty, lotQty, lines, ops, byproducts, notes: txt(b.notes, 1000), isActive: b.isActive === undefined ? true : !!b.isActive, isDefault: willDefault, updatedAt: new Date() };
  let saved: any;
  if (prev) saved = await t.update("mfg_boms", { id: prev.id }, row);
  else {
    const v = await t.one(`SELECT COALESCE(MAX(version),0)+1 v FROM mfg_boms WHERE company_id=$1 AND product_id=$2`, [C, productId]);
    let code = `BOM-${prod.sku || "P"}-V${v.v}`; for (let i = 2; await t.maybe(`SELECT 1 FROM mfg_boms WHERE company_id=$1 AND code=$2`, [C, code]); i++) code = `BOM-${prod.sku || "P"}-V${v.v}-${i}`;
    saved = await t.insert("mfg_boms", { companyId: C, productId, code, version: v.v, ...row, isDemo: !!opts.isDemo });
  }
  if (saved.isDefault) await t.exec(`UPDATE mfg_boms SET is_default=false WHERE company_id=$1 AND product_id=$2 AND id<>$3`, [C, productId, saved.id]);
  return getBom(t, C, saved.id);
}
export async function deleteBom(t: Db, C: string, id: string) {
  const b = await t.one(`SELECT * FROM mfg_boms WHERE id=$1 AND company_id=$2`, [uid(id), C], "قائمة المواد غير موجودة");
  const used = await t.one(`SELECT COUNT(*)::int c FROM mfg_orders WHERE company_id=$1 AND bom_id=$2`, [C, b.id]);
  if (used.c) { await t.exec(`UPDATE mfg_boms SET is_active=false, is_default=false WHERE id=$1`, [b.id]); return { deactivated: true }; }
  await t.exec(`DELETE FROM mfg_boms WHERE id=$1`, [b.id]);
  return { deleted: true };
}
/** Standard cost of a product for a quantity (or of a BOM) — for quotes and pricing. */
export async function costFor(t: Db, C: string, q: any) {
  const cx = await loadCx(t, C);
  const bom = uid(q.bomId) ? cx.boms.get(q.bomId) : cx.def.get(String(q.productId));
  if (!bom) throw new AppError(404, "لا قائمة مواد لهذا الصنف");
  const asked = num(q.qty) > 0 ? num(q.qty) : 0;
  const qty = asked || n(bom.outputQty);
  const r = rollup(cx, bom, undefined, asked || undefined); // no quantity given: set-up spread over the usual run
  return { ...r, qty, totalForQty: r2(r.unitCost * qty), tree: tree(cx, bom, 1, qty) };
}

// ───────────────────────── manufacturing orders ─────────────────────────
/** Components for qty, with kits exploded into their own components (merged by component). */
function explode(cx: Cx, bom: any, qty: number, seen = new Set<string>([bom.productId])) {
  const out = n(bom.outputQty) || 1;
  const acc = new Map<string, any>();
  const add = (pid: string, q: number, opSeq: number | null) => {
    const p = cx.prods.get(pid) || {};
    const g = acc.get(pid) || { componentId: pid, sku: p.sku, name: p.name, unit: p.unit, opSeq, planned: 0, issued: 0, returned: 0, value: 0, stdUnitCost: Math.round(unitCostOf(cx, pid, seen) * 10000) / 10000 };
    g.planned = r3(g.planned + q); acc.set(pid, g);
  };
  for (const l of bom.lines || []) {
    const need = (n(l.qty) * (1 + n(l.wastePct) / 100) * qty) / out;
    const sub = cx.def.get(l.componentId);
    if (sub?.kind === "KIT" && !seen.has(l.componentId)) for (const k of explode(cx, sub, need, new Set([...seen, l.componentId]))) add(k.componentId, k.planned, l.opSeq ?? null);
    else add(l.componentId, need, l.opSeq ?? null);
  }
  return [...acc.values()];
}
async function defaultWarehouse(t: Db, C: string, id?: any) {
  if (uid(id)) return (await t.one(`SELECT id FROM warehouses WHERE id=$1 AND company_id=$2`, [id, C], "المستودع غير موجود")).id;
  return (await t.one(`SELECT id FROM warehouses WHERE company_id=$1 ORDER BY is_default DESC, code LIMIT 1`, [C], "لا يوجد مستودع")).id;
}

export async function createOrder(t: Db, company: any, user: string, b: any, opts: { isDemo?: boolean; parentId?: string; depth?: number } = {}): Promise<any> {
  const C = company.id;
  const prod = await t.one(`SELECT id, sku, name, unit, type FROM products WHERE id=$1 AND company_id=$2`, [uid(b.productId), C], "الصنف غير موجود");
  const cx = await loadCx(t, C);
  const bom = uid(b.bomId) ? cx.boms.get(b.bomId) : cx.def.get(prod.id);
  if (!bom || bom.productId !== prod.id) throw bad(`لا توجد قائمة مواد نشطة لـ«${prod.name}» — عرّفها من «قوائم المواد»`);
  const qty = num(b.qty); if (!(qty > 0)) throw bad("كمية الأمر يجب أن تكون أكبر من صفر");
  const date = isDate(b.date) ? String(b.date) : today();
  const plannedStart = isDate(b.plannedStart) ? String(b.plannedStart) : date;
  const dueDate = isDate(b.dueDate) ? String(b.dueDate) : null;
  if (dueDate && dueDate < plannedStart) throw bad("تاريخ التسليم قبل تاريخ البدء");
  const warehouseId = await defaultWarehouse(t, C, b.warehouseId);
  const outputWarehouseId = await defaultWarehouse(t, C, b.outputWarehouseId || warehouseId);
  const partnerId = uid(b.partnerId) ? (await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [b.partnerId, C], "العميل غير موجود")).id : null;
  const costCenterId = uid(b.costCenterId) ? (await t.one(`SELECT id FROM cost_centers WHERE id=$1 AND company_id=$2`, [b.costCenterId, C], "مركز التكلفة غير موجود")).id : null;
  const priority = [1, 2, 3].includes(Number(b.priority)) ? Number(b.priority) : 2;
  const roll = rollup(cx, bom, undefined, qty);
  const out = n(bom.outputQty) || 1;
  const materials = explode(cx, bom, qty);
  const ops = (bom.ops || []).map((o: any) => {
    const w = cx.wcs.get(o.workCenterId) || {};
    return { seq: n(o.seq), name: o.name, workCenterId: o.workCenterId, workCenter: w.name || "؟", costCenterId: w.costCenterId || null, rateHour: n(w.rateHour), overheadHour: n(w.overheadHour), rateUnit: n(w.rateUnit), plannedMin: r2(n(o.setupMin) + n(o.runMin) * qty), actualMin: 0, cost: 0, unitsCharged: 0, status: "PENDING", qc: !!o.qc, qcResult: null, startedAt: null, doneAt: null, operator: null, instructions: o.instructions || null };
  });
  const byproducts = (bom.byproducts || []).map((x: any) => { const p = cx.prods.get(x.productId) || {}; return { productId: x.productId, sku: p.sku, name: p.name, unit: p.unit, planned: r3((n(x.qty) * qty) / out), sharePct: n(x.sharePct), received: 0, value: 0 }; });
  const number = await nextNumber(t, C, "MO", date);
  const row = await t.insert("mfg_orders", {
    companyId: C, number, date, productId: prod.id, bomId: bom.id, qty, status: b.confirm ? "CONFIRMED" : "DRAFT", priority, plannedStart, dueDate, warehouseId, outputWarehouseId, partnerId, salesRef: txt(b.salesRef, 60), parentId: opts.parentId || null,
    costCenterId, lotNo: txt(b.lotNo, 40), expiryDate: isDate(b.expiryDate) ? b.expiryDate : null, notes: txt(b.notes, 1000), materials, ops, byproducts, stdUnitCost: roll.unitCost, createdBy: user, isDemo: !!opts.isDemo,
  });
  // sub-assemblies: an order for each component that has its own BOM and is short in stock (multi-level, up to 5 deep)
  if (b.subAssemblies && (opts.depth || 0) < 5) {
    for (const m of materials) {
      const sub = cx.def.get(m.componentId);
      if (!sub || sub.kind === "KIT") continue;
      const short = r3(m.planned - Math.max(0, cx.onHand.get(m.componentId) || 0));
      if (short <= 0) continue;
      await createOrder(t, company, user, { productId: m.componentId, bomId: sub.id, qty: short, date, plannedStart: date, dueDate: plannedStart, warehouseId, outputWarehouseId: warehouseId, priority, subAssemblies: true, confirm: b.confirm, costCenterId, notes: `لأمر التصنيع ${number}` }, { isDemo: opts.isDemo, parentId: row.id, depth: (opts.depth || 0) + 1 });
    }
  }
  return row;
}

async function lockOrder(t: Db, C: string, id: string) {
  return t.one(`SELECT * FROM mfg_orders WHERE id=$1 AND company_id=$2 FOR UPDATE`, [uid(id), C], "أمر التصنيع غير موجود");
}
const mustOpen = (o: any) => { if (!MO_OPEN.includes(o.status)) throw conflict(o.status === "DONE" ? `أمر التصنيع ${o.number} منتهٍ` : `أمر التصنيع ${o.number} ملغى`); };
async function jv(t: Db, C: string, o: any, date: string, memo: string, lines: any[], user: string) {
  return post(t, C, { date, type: "MANUFACTURING", sourceType: "MFG_ORDER", sourceId: o.id, reference: o.number, memo, isDemo: !!o.isDemo, createdBy: user, branchId: await warehouseBranch(t, C, o.warehouseId), lines });
}
async function save(t: Db, o: any, extra: any = {}) {
  await t.update("mfg_orders", { id: o.id }, { materials: o.materials, ops: o.ops, byproducts: o.byproducts, wip: r2(o.wip), materialCost: r2(o.materialCost), conversionCost: r2(o.conversionCost), receivedValue: r2(o.receivedValue), scrapValue: r2(o.scrapValue), variance: r2(o.variance), producedQty: r3(o.producedQty), scrapQty: r3(o.scrapQty), status: o.status, updatedAt: new Date(), ...extra });
}
const num0 = (o: any) => { for (const k of ["qty", "producedQty", "scrapQty", "wip", "materialCost", "conversionCost", "receivedValue", "scrapValue", "variance", "stdUnitCost"]) o[k] = n(o[k]); return o; };

export async function confirmOrder(t: Db, C: string, id: string) {
  const o = await lockOrder(t, C, id);
  if (o.status !== "DRAFT") throw conflict("الأمر ليس مسودة");
  await t.exec(`UPDATE mfg_orders SET status='CONFIRMED', updated_at=now() WHERE id=$1`, [o.id]);
  return { ok: true };
}
export async function updateDraft(t: Db, C: string, id: string, b: any) {
  const o = await lockOrder(t, C, id);
  if (!["DRAFT", "CONFIRMED"].includes(o.status)) throw conflict("لا يُعدَّل إلا أمر لم يبدأ تنفيذه");
  const moves = await t.one(`SELECT COUNT(*)::int c FROM mfg_moves WHERE order_id=$1`, [o.id]);
  const set: any = { updatedAt: new Date() };
  if (b.priority !== undefined && [1, 2, 3].includes(Number(b.priority))) set.priority = Number(b.priority);
  if (b.plannedStart !== undefined) set.plannedStart = isDate(b.plannedStart) ? b.plannedStart : null;
  if (b.dueDate !== undefined) set.dueDate = isDate(b.dueDate) ? b.dueDate : null;
  if (b.notes !== undefined) set.notes = txt(b.notes, 1000);
  if (b.lotNo !== undefined) set.lotNo = txt(b.lotNo, 40);
  if (b.qty !== undefined && num(b.qty) !== n(o.qty)) {
    if (moves.c) throw conflict("الكمية لا تتغير بعد بدء التنفيذ");
    const q = num(b.qty); if (!(q > 0)) throw bad("كمية الأمر يجب أن تكون أكبر من صفر");
    const f = q / n(o.qty);
    set.qty = q;
    set.materials = (o.materials || []).map((m: any) => ({ ...m, planned: r3(n(m.planned) * f) }));
    const cx = await loadCx(t, C); const bom = cx.boms.get(o.bomId);
    set.ops = (o.ops || []).map((op: any) => { const bo = (bom?.ops || []).find((x: any) => n(x.seq) === n(op.seq)); return { ...op, plannedMin: bo ? r2(n(bo.setupMin) + n(bo.runMin) * q) : r2(n(op.plannedMin) * f) }; });
    set.byproducts = (o.byproducts || []).map((x: any) => ({ ...x, planned: r3(n(x.planned) * f) }));
    if (bom) set.stdUnitCost = rollup(cx, bom, undefined, q).unitCost;
  }
  await t.update("mfg_orders", { id: o.id }, set);
  return { ok: true };
}

/** Issues components to the order (Dr WIP / Cr inventory). Mutates o; returns the value issued. */
async function issueLines(t: Db, C: string, user: string, o: any, list: { componentId: string; qty: number }[], date: string, note?: string) {
  const co = await t.one(`SELECT allow_negative_stock FROM companies WHERE id=$1`, [C]);
  let total = 0; const moves: any[] = [];
  for (const it of list) {
    const qty = r3(num(it.qty)); if (!(qty > 0)) continue;
    let m = (o.materials as any[]).find((x) => x.componentId === it.componentId);
    if (!m) {
      const p = await t.one(`SELECT id, sku, name, unit, type, purchase_price FROM products WHERE id=$1 AND company_id=$2`, [uid(it.componentId), C], "المكوّن غير موجود");
      if (p.type !== "STOCK") throw bad(`«${p.name}» ليس صنفاً مخزنياً`);
      if (p.id === o.productId) throw bad("لا يُصرف المنتج نفسه لأمر تصنيعه");
      m = { componentId: p.id, sku: p.sku, name: p.name, unit: p.unit, opSeq: null, planned: 0, issued: 0, returned: 0, value: 0, stdUnitCost: n(p.purchasePrice), extra: true };
      o.materials.push(m);
    }
    const v = await stockOut(t, C, { productId: m.componentId, warehouseId: o.warehouseId, qty, date, sourceType: "MFG_ISSUE", sourceId: o.id, reference: o.number, isDemo: !!o.isDemo, allowNegative: !!co.allowNegativeStock, fallbackCost: n(m.stdUnitCost), productName: m.name });
    m.issued = r3(n(m.issued) + qty); m.value = r2(n(m.value) + v);
    total = r2(total + v);
    moves.push({ companyId: C, orderId: o.id, kind: "ISSUE", date, productId: m.componentId, qty, value: v, notes: note || null, createdBy: user, isDemo: !!o.isDemo });
  }
  if (!moves.length) return 0;
  const A = await mfgAccounts(t, C);
  const e = total ? await jv(t, C, o, date, `صرف مواد لأمر التصنيع ${o.number}`, [{ account: A.wip, debit: total, costCenterId: o.costCenterId }, { key: "INVENTORY", credit: total }], user) : null;
  await t.insertMany("mfg_moves", moves.map((m) => ({ ...m, entryId: e?.id || null })));
  o.wip = r2(n(o.wip) + total); o.materialCost = r2(n(o.materialCost) + total);
  if (o.status !== "IN_PROGRESS") o.status = "IN_PROGRESS";
  return total;
}
export async function issue(t: Db, C: string, user: string, id: string, b: any) {
  const o = num0(await lockOrder(t, C, id)); mustOpen(o);
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const list = b.all ? (o.materials as any[]).filter((m) => !m.extra).map((m) => ({ componentId: m.componentId, qty: r3(n(m.planned) - (n(m.issued) - n(m.returned))) })).filter((x) => x.qty > 0)
    : (Array.isArray(b.lines) ? b.lines : []).map((l: any) => ({ componentId: String(l.componentId), qty: num(l.qty) }));
  if (!list.some((x: any) => x.qty > 0)) throw bad(b.all ? "كل المواد مصروفة" : "حدد مكوّناً وكمية");
  await issueLines(t, C, user, o, list, date, txt(b.notes, 200) || undefined);
  await save(t, o);
  return getOrder(t, C, o.id);
}
export async function returnMaterials(t: Db, C: string, user: string, id: string, b: any) {
  const o = num0(await lockOrder(t, C, id)); mustOpen(o);
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const list = (Array.isArray(b.lines) ? b.lines : []).filter((l: any) => num(l.qty) > 0);
  if (!list.length) throw bad("حدد المكوّن والكمية المرتجعة");
  let total = 0; const moves: any[] = [];
  for (const l of list) {
    const m = (o.materials as any[]).find((x) => x.componentId === l.componentId);
    if (!m) throw bad("المكوّن لم يُصرف لهذا الأمر");
    const net = r3(n(m.issued) - n(m.returned)), qty = r3(num(l.qty));
    if (qty > net + 1e-9) throw bad(`المرتجع من «${m.name}» أكبر من المصروف (${net})`);
    const v = Math.abs(qty - net) < 1e-9 ? r2(n(m.value)) : r2((n(m.value) / net) * qty);
    await stockIn(t, C, { productId: m.componentId, warehouseId: o.warehouseId, qty, date, sourceType: "MFG_RETURN", sourceId: o.id, reference: o.number, isDemo: !!o.isDemo, value: v, lotNo: "RETURN" });
    m.returned = r3(n(m.returned) + qty); m.value = r2(n(m.value) - v); total = r2(total + v);
    moves.push({ companyId: C, orderId: o.id, kind: "RETURN", date, productId: m.componentId, qty, value: v, createdBy: user, isDemo: !!o.isDemo });
  }
  const A = await mfgAccounts(t, C);
  const e = total ? await jv(t, C, o, date, `إرجاع مواد من أمر التصنيع ${o.number}`, [{ key: "INVENTORY", debit: total }, { account: A.wip, credit: total, costCenterId: o.costCenterId }], user) : null;
  await t.insertMany("mfg_moves", moves.map((m) => ({ ...m, entryId: e?.id || null })));
  o.wip = r2(o.wip - total); o.materialCost = r2(o.materialCost - total);
  await save(t, o);
  return getOrder(t, C, o.id);
}

/** Books time on a stage (Dr WIP / Cr applied production costs). Mutates o. */
async function bookTime(t: Db, C: string, user: string, o: any, op: any, minutes: number, units: number, date: string, note?: string) {
  const cost = r2((minutes / 60) * (n(op.rateHour) + n(op.overheadHour)) + units * n(op.rateUnit));
  op.actualMin = r2(n(op.actualMin) + minutes); op.cost = r2(n(op.cost) + cost); op.unitsCharged = r3(n(op.unitsCharged) + units);
  let e: any = null;
  if (cost > 0) {
    const A = await mfgAccounts(t, C);
    e = await jv(t, C, o, date, `تكلفة مرحلة «${op.name}» — أمر التصنيع ${o.number} (${r2(minutes)} دقيقة)`, [{ account: A.wip, debit: cost, costCenterId: o.costCenterId }, { account: A.applied, credit: cost, costCenterId: op.costCenterId || null }], user);
  }
  await t.insert("mfg_moves", { companyId: C, orderId: o.id, kind: "LABOR", date, qty: units, value: cost, opSeq: op.seq, minutes, workCenterId: op.workCenterId, entryId: e?.id || null, notes: note || null, createdBy: user, isDemo: !!o.isDemo });
  o.wip = r2(n(o.wip) + cost); o.conversionCost = r2(n(o.conversionCost) + cost);
  return cost;
}
export async function opAction(t: Db, C: string, user: string, id: string, seq: number, b: any) {
  const o = num0(await lockOrder(t, C, id)); mustOpen(o);
  const op = (o.ops as any[]).find((x) => n(x.seq) === Number(seq)); if (!op) throw new AppError(404, "المرحلة غير موجودة");
  const action = String(b.action || "");
  const date = isDate(b.date) ? String(b.date) : today();
  if (op.status === "DONE" && action !== "reopen") throw conflict(`المرحلة «${op.name}» منتهية`);
  if (action === "start") {
    op.status = "RUNNING"; op.startedAt = new Date().toISOString(); op.operator = txt(b.operator, 60) || op.operator || user;
  } else if (action === "finish" || action === "time") {
    await assertOpenDate(t, C, date);
    let minutes: number;
    if (b.minutes !== undefined && b.minutes !== null && b.minutes !== "") minutes = num(b.minutes);
    else if (op.status === "RUNNING" && op.startedAt) minutes = Math.round(((Date.now() - Date.parse(op.startedAt)) / 60000) * 10) / 10;
    else minutes = Math.max(0, r2(n(op.plannedMin) - n(op.actualMin)));
    if (minutes < 0 || minutes > 60 * 24 * 31) throw bad("الدقائق غير صحيحة");
    let qc: string | null = null;
    if (action === "finish" && op.qc) { qc = ["PASS", "FAIL"].includes(b.qcResult) ? b.qcResult : null; if (!qc) throw bad(`المرحلة «${op.name}» فيها فحص جودة: اختر «ناجح» أو «غير مطابق»`); }
    const units = action === "finish" && n(op.rateUnit) > 0 ? Math.max(0, r3((b.units !== undefined ? num(b.units) : n(o.qty)) - n(op.unitsCharged))) : 0;
    await bookTime(t, C, user, o, op, minutes, units, date, txt(b.notes, 200) || undefined);
    if (b.operator) op.operator = txt(b.operator, 60);
    if (action === "finish") { op.status = qc === "FAIL" ? "FAILED" : "DONE"; op.qcResult = qc; op.doneAt = new Date().toISOString(); op.qcNote = txt(b.qcNote, 300); }
    else op.status = "PAUSED";
    op.startedAt = null;
  } else if (action === "reopen") {
    if (o.status === "DONE") throw conflict("الأمر منتهٍ"); op.status = "PENDING"; op.doneAt = null; op.qcResult = null;
  } else throw bad("إجراء غير معروف");
  if (o.status !== "IN_PROGRESS") o.status = "IN_PROGRESS";
  await save(t, o);
  return getOrder(t, C, o.id);
}

export async function produce(t: Db, C: string, user: string, id: string, b: any) {
  const o = num0(await lockOrder(t, C, id)); mustOpen(o);
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const qty = r3(num(b.qty)), scrap = r3(num(b.scrapQty));
  if (qty < 0 || scrap < 0 || !(qty + scrap > 0)) throw bad("أدخل الكمية المنتجة أو التالفة");
  const abnormal = b.scrapKind === "ABNORMAL";
  const failed = (o.ops as any[]).find((x) => x.status === "FAILED");
  if (failed) throw conflict(`مرحلة «${failed.name}» لم تنجح في فحص الجودة: أعد العمل عليها وسجّل نتيجة ناجحة قبل الاستلام`);
  const doneAfter = r3(o.producedQty + o.scrapQty + qty + scrap);
  const final = b.final === true || doneAfter >= o.qty - 1e-9;
  if (final) { const qcOpen = (o.ops as any[]).find((x) => x.qc && x.status !== "DONE"); if (qcOpen) throw conflict(`سجّل نتيجة فحص الجودة لمرحلة «${qcOpen.name}» قبل إنهاء الأمر`); }
  const backflush = b.backflush !== false;
  // back-flush: issue what the produced quantity should have used and has not been issued yet
  if (backflush) {
    const ratio = final ? 1 : Math.min(1, doneAfter / o.qty);
    const list = (o.materials as any[]).filter((m) => !m.extra).map((m) => ({ componentId: m.componentId, qty: r3(n(m.planned) * ratio - (n(m.issued) - n(m.returned))) })).filter((x) => x.qty > 0.0005);
    if (list.length) await issueLines(t, C, user, o, list, date, "صرف تلقائي عند الإنتاج");
    if (final) for (const op of o.ops as any[]) if (op.status !== "DONE" && !op.qc) { await bookTime(t, C, user, o, op, Math.max(0, r2(n(op.plannedMin) - n(op.actualMin))), n(op.rateUnit) > 0 ? Math.max(0, r3(o.qty - n(op.unitsCharged))) : 0, date, "حسب الزمن المعياري عند الإنتاج"); op.status = "DONE"; op.doneAt = new Date().toISOString(); op.startedAt = null; }
  }
  const A = await mfgAccounts(t, C);
  // scrap: normal loss stays in WIP and is carried by the good units; abnormal loss is expensed at standard cost
  if (scrap > 0) {
    const sv = abnormal ? Math.min(o.wip, r2(scrap * o.stdUnitCost)) : 0;
    const e = sv > 0 ? await jv(t, C, o, date, `تالف غير عادي — أمر التصنيع ${o.number} (${scrap})`, [{ account: A.scrap, debit: sv, costCenterId: o.costCenterId }, { account: A.wip, credit: sv, costCenterId: o.costCenterId }], user) : null;
    await t.insert("mfg_moves", { companyId: C, orderId: o.id, kind: "SCRAP", date, productId: o.productId, qty: scrap, value: sv, entryId: e?.id || null, notes: abnormal ? "غير عادي" : "عادي (محمَّل على الإنتاج السليم)", createdBy: user, isDemo: !!o.isDemo });
    o.wip = r2(o.wip - sv); o.scrapValue = r2(o.scrapValue + sv); o.scrapQty = r3(o.scrapQty + scrap);
  }
  const producedAfter = r3(o.producedQty + qty);
  let mainValue = 0; const bys: any[] = [];
  if (final) {
    const pool = Math.max(0, o.wip);
    if (producedAfter > 0) {
      for (const x of o.byproducts as any[]) {
        const given = Array.isArray(b.byproducts) ? b.byproducts.find((y: any) => y.productId === x.productId) : null;
        const q = given ? r3(num(given.qty)) : r3((n(x.planned) * producedAfter) / o.qty - n(x.received));
        if (!(q > 0)) continue;
        bys.push({ x, qty: q, value: r2((pool * n(x.sharePct)) / 100) });
      }
      mainValue = r2(pool - bys.reduce((a, y) => a + y.value, 0));
    }
  } else mainValue = Math.min(Math.max(0, o.wip), r2(qty * o.stdUnitCost * (1 - (o.byproducts as any[]).reduce((a, x) => a + n(x.sharePct), 0) / 100)));
  const lot = txt(b.lotNo, 40) || o.lotNo || o.number;
  const expiry = isDate(b.expiryDate) ? b.expiryDate : o.expiryDate ? iso(o.expiryDate) : null;
  const moves: any[] = [];
  if (qty > 0) {
    await stockIn(t, C, { productId: o.productId, warehouseId: o.outputWarehouseId, qty, date, sourceType: "MFG_RECEIPT", sourceId: o.id, reference: o.number, isDemo: !!o.isDemo, value: mainValue, lotNo: lot, expiryDate: expiry });
    moves.push({ companyId: C, orderId: o.id, kind: "RECEIPT", date, productId: o.productId, qty, value: mainValue, notes: final ? "استلام نهائي" : "استلام جزئي بالتكلفة المعيارية", createdBy: user, isDemo: !!o.isDemo });
  }
  for (const y of bys) {
    await stockIn(t, C, { productId: y.x.productId, warehouseId: o.outputWarehouseId, qty: y.qty, date, sourceType: "MFG_BYPRODUCT", sourceId: o.id, reference: o.number, isDemo: !!o.isDemo, value: y.value, lotNo: lot });
    y.x.received = r3(n(y.x.received) + y.qty); y.x.value = r2(n(y.x.value) + y.value);
    moves.push({ companyId: C, orderId: o.id, kind: "BYPRODUCT", date, productId: y.x.productId, qty: y.qty, value: y.value, createdBy: user, isDemo: !!o.isDemo });
  }
  const inValue = r2(mainValue + bys.reduce((a, y) => a + y.value, 0));
  const e = inValue > 0 ? await jv(t, C, o, date, `استلام إنتاج أمر التصنيع ${o.number}${qty ? ` (${qty})` : ""}`, [{ key: "INVENTORY", debit: inValue }, { account: A.wip, credit: inValue, costCenterId: o.costCenterId }], user) : null;
  if (moves.length) await t.insertMany("mfg_moves", moves.map((m) => ({ ...m, entryId: e?.id || null })));
  o.wip = r2(o.wip - inValue); o.receivedValue = r2(o.receivedValue + inValue); o.producedQty = producedAfter;
  if (final) {
    // nothing good came out: whatever is left in WIP is a loss
    if (Math.abs(o.wip) >= 0.01) {
      const acc = producedAfter > 0 ? A.variance : A.scrap;
      const v = o.wip;
      const ce = await jv(t, C, o, date, `إقفال أمر التصنيع ${o.number}`, v > 0 ? [{ account: acc, debit: v, costCenterId: o.costCenterId }, { account: A.wip, credit: v, costCenterId: o.costCenterId }] : [{ account: A.wip, debit: -v, costCenterId: o.costCenterId }, { account: acc, credit: -v, costCenterId: o.costCenterId }], user);
      await t.insert("mfg_moves", { companyId: C, orderId: o.id, kind: "CLOSE", date, value: v, entryId: ce?.id || null, createdBy: user, isDemo: !!o.isDemo });
      if (producedAfter > 0) o.variance = r2(o.variance + v); else o.scrapValue = r2(o.scrapValue + v);
      o.wip = 0;
    }
    o.status = "DONE";
    await save(t, o, { closedAt: new Date() });
  } else await save(t, o);
  return getOrder(t, C, o.id);
}

/** Short close: stops the order; what is left in WIP goes to variances (or back to stock if returned first). */
export async function closeOrder(t: Db, C: string, user: string, id: string, b: any = {}) {
  const o = num0(await lockOrder(t, C, id)); mustOpen(o);
  if (o.status !== "IN_PROGRESS") throw conflict("الأمر لم يبدأ — ألغِه بدل إقفاله");
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const failed = (o.ops as any[]).find((x) => x.status === "FAILED");
  if (b.returnUnused) {
    const lines = (o.materials as any[]).map((m) => ({ componentId: m.componentId, qty: r3(n(m.issued) - n(m.returned) - (n(m.planned) * (o.producedQty + o.scrapQty)) / o.qty) })).filter((x) => x.qty > 0.0005);
    if (lines.length) { await save(t, o); await returnMaterials(t, C, user, o.id, { date, lines }); Object.assign(o, num0(await lockOrder(t, C, id))); }
  }
  const A = await mfgAccounts(t, C);
  if (Math.abs(o.wip) >= 0.01) {
    const v = o.wip;
    const e = await jv(t, C, o, date, `إقفال أمر التصنيع ${o.number} قبل اكتماله${failed ? " (فشل فحص الجودة)" : ""}`, v > 0 ? [{ account: A.variance, debit: v, costCenterId: o.costCenterId }, { account: A.wip, credit: v, costCenterId: o.costCenterId }] : [{ account: A.wip, debit: -v, costCenterId: o.costCenterId }, { account: A.variance, credit: -v, costCenterId: o.costCenterId }], user);
    await t.insert("mfg_moves", { companyId: C, orderId: o.id, kind: "CLOSE", date, value: v, entryId: e?.id || null, notes: txt(b.reason, 200), createdBy: user, isDemo: !!o.isDemo });
    o.variance = r2(o.variance + v); o.wip = 0;
  }
  o.status = "DONE";
  await save(t, o, { closedAt: new Date(), notes: b.reason ? [o.notes, `أُقفل قبل اكتماله: ${txt(b.reason, 200)}`].filter(Boolean).join(" — ") : o.notes });
  return getOrder(t, C, o.id);
}

/** Cancels an order with no output: issued materials go back at their value and booked time is reversed. */
export async function cancelOrder(t: Db, C: string, user: string, id: string, b: any = {}) {
  const o = num0(await lockOrder(t, C, id)); mustOpen(o);
  const out = await t.one(`SELECT COUNT(*)::int c FROM mfg_moves WHERE order_id=$1 AND kind IN ('RECEIPT','BYPRODUCT','SCRAP')`, [o.id]);
  if (out.c) throw conflict("للأمر إنتاج أو تالف مسجّل: أقفله بدل إلغائه");
  const date = isDate(b.date) ? String(b.date) : today();
  const hasMoves = (await t.one(`SELECT COUNT(*)::int c FROM mfg_moves WHERE order_id=$1`, [o.id])).c > 0;
  if (hasMoves) {
    await assertOpenDate(t, C, date);
    const lines = (o.materials as any[]).map((m) => ({ componentId: m.componentId, qty: r3(n(m.issued) - n(m.returned)) })).filter((x) => x.qty > 0);
    if (lines.length) { await save(t, o); await returnMaterials(t, C, user, o.id, { date, lines }); Object.assign(o, num0(await lockOrder(t, C, id))); }
    const A = await mfgAccounts(t, C);
    // booked time back, per work centre (cost centre) as it was booked
    const byWc = new Map<string, { cc: string | null; v: number; min: number }>();
    for (const op of o.ops as any[]) if (n(op.cost) > 0) { const g = byWc.get(op.workCenterId) || { cc: op.costCenterId || null, v: 0, min: 0 }; g.v = r2(g.v + n(op.cost)); g.min = r2(g.min + n(op.actualMin)); byWc.set(op.workCenterId, g); }
    const conv = r2([...byWc.values()].reduce((a, g) => a + g.v, 0));
    if (conv > 0) {
      const e = await jv(t, C, o, date, `إلغاء أمر التصنيع ${o.number}: عكس تكلفة المراحل`, [...[...byWc.values()].map((g) => ({ account: A.applied, debit: g.v, costCenterId: g.cc })), { account: A.wip, credit: conv, costCenterId: o.costCenterId }], user);
      // negative time per work centre, so hours and absorbed cost by centre stay net of the cancelled order
      for (const [wc, g] of byWc) await t.insert("mfg_moves", { companyId: C, orderId: o.id, kind: "LABOR", date, value: -g.v, minutes: -g.min, workCenterId: wc, entryId: e?.id || null, notes: "عكس عند إلغاء الأمر", createdBy: user, isDemo: !!o.isDemo });
      o.wip = r2(o.wip - conv); o.conversionCost = r2(o.conversionCost - conv);
    }
    if (Math.abs(o.wip) >= 0.01) { // rounding left in WIP
      const v = o.wip;
      await jv(t, C, o, date, `فرق تقريب — إلغاء أمر التصنيع ${o.number}`, v > 0 ? [{ account: A.variance, debit: v }, { account: A.wip, credit: v }] : [{ account: A.wip, debit: -v }, { account: A.variance, credit: -v }], user);
      o.variance = r2(o.variance + v); o.wip = 0;
    }
  }
  o.status = "CANCELLED";
  await save(t, o, { closedAt: new Date(), notes: b.reason ? [o.notes, `أُلغي: ${txt(b.reason, 200)}`].filter(Boolean).join(" — ") : o.notes });
  // draft sub-assembly orders made for it go too
  await t.exec(`UPDATE mfg_orders SET status='CANCELLED', updated_at=now() WHERE parent_id=$1 AND company_id=$2 AND status IN ('DRAFT','CONFIRMED') AND NOT EXISTS (SELECT 1 FROM mfg_moves mv WHERE mv.order_id=mfg_orders.id)`, [o.id, C]);
  return getOrder(t, C, o.id);
}

// ───────────────────────── reading orders ─────────────────────────
export async function listOrders(t: Db, C: string, q: any = {}) {
  const where = ["o.company_id=$1"]; const p: any[] = [C];
  if (q.status === "OPEN") where.push(`o.status IN ('DRAFT','CONFIRMED','IN_PROGRESS')`);
  else if (["DRAFT", "CONFIRMED", "IN_PROGRESS", "DONE", "CANCELLED"].includes(q.status)) { p.push(q.status); where.push(`o.status=$${p.length}`); }
  if (uid(q.productId)) { p.push(q.productId); where.push(`o.product_id=$${p.length}`); }
  if (isDate(q.from)) { p.push(q.from); where.push(`o.date >= $${p.length}`); }
  if (isDate(q.to)) { p.push(q.to); where.push(`o.date <= $${p.length}`); }
  const rows = await t.rows(`SELECT o.*, p.name product_name, p.sku, p.unit, pa.name partner_name, w.name warehouse_name FROM mfg_orders o JOIN products p ON p.id=o.product_id LEFT JOIN partners pa ON pa.id=o.partner_id LEFT JOIN warehouses w ON w.id=o.warehouse_id
     WHERE ${where.join(" AND ")} ORDER BY CASE o.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'CONFIRMED' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, o.priority, o.due_date NULLS LAST, o.number DESC LIMIT 500`, p);
  const bal = await stockMap(t, C);
  const td = today();
  return rows.map((o: any) => shapeOrder(o, bal, td));
}
async function stockMap(t: Db, C: string) {
  const r = await t.rows(`SELECT product_id, warehouse_id, qty FROM stock_balances WHERE company_id=$1`, [C]);
  const m = new Map<string, number>(); for (const x of r) m.set(`${x.productId}|${x.warehouseId}`, n(x.qty));
  return m;
}
function availability(o: any, bal: Map<string, number>) {
  let short = 0, partial = 0;
  const mats = (o.materials || []).map((m: any) => {
    const need = Math.max(0, r3(n(m.planned) - (n(m.issued) - n(m.returned))));
    const have = bal.get(`${m.componentId}|${o.warehouseId}`) || 0;
    const st = need <= 0 ? "ISSUED" : have >= need - 1e-9 ? "OK" : have > 0 ? "PARTIAL" : "SHORT";
    if (st === "SHORT") short++; if (st === "PARTIAL") partial++;
    return { ...m, need, onHand: r3(have), avail: st };
  });
  return { mats, state: short ? "SHORT" : partial ? "PARTIAL" : "OK" };
}
function shapeOrder(o: any, bal: Map<string, number>, td: string) {
  const av = availability(o, bal);
  const ops = o.ops || [];
  const pmin = ops.reduce((a: number, x: any) => a + n(x.plannedMin), 0), amin = ops.reduce((a: number, x: any) => a + n(x.actualMin), 0);
  const done = ops.filter((x: any) => x.status === "DONE").length;
  const qty = n(o.qty), produced = n(o.producedQty);
  return {
    id: o.id, number: o.number, date: iso(o.date), status: o.status, priority: o.priority, productId: o.productId, productName: o.productName, sku: o.sku, unit: o.unit, bomId: o.bomId,
    qty, producedQty: produced, scrapQty: n(o.scrapQty), progressPct: qty ? Math.min(100, r2(((produced + n(o.scrapQty)) / qty) * 100)) : 0,
    plannedStart: iso(o.plannedStart), dueDate: iso(o.dueDate), late: !!o.dueDate && iso(o.dueDate)! < td && MO_OPEN.includes(o.status),
    partnerId: o.partnerId, partnerName: o.partnerName || null, salesRef: o.salesRef, parentId: o.parentId, warehouseName: o.warehouseName,
    stages: ops.length, stagesDone: done, currentStage: ops.find((x: any) => x.status !== "DONE")?.name || null, plannedHours: r2(pmin / 60), actualHours: r2(amin / 60),
    availability: MO_OPEN.includes(o.status) ? av.state : null, wip: n(o.wip), materialCost: n(o.materialCost), conversionCost: n(o.conversionCost), receivedValue: n(o.receivedValue), stdUnitCost: n(o.stdUnitCost),
    actualUnitCost: produced > 0 && o.status === "DONE" ? Math.round((mainValue(o) / produced) * 10000) / 10000 : null, variance: n(o.variance), isDemo: o.isDemo,
  };
}
const mainValue = (o: any) => r2(n(o.receivedValue) - (o.byproducts || []).reduce((a: number, x: any) => a + n(x.value), 0));

export async function getOrder(t: Db, C: string, id: string) {
  const o = await t.one(`SELECT o.*, p.name product_name, p.sku, p.unit, pa.name partner_name, w.name warehouse_name, w2.name output_warehouse_name, cc.name cost_center_name, b.code bom_code, b.version bom_version, par.number parent_number
     FROM mfg_orders o JOIN products p ON p.id=o.product_id LEFT JOIN partners pa ON pa.id=o.partner_id LEFT JOIN warehouses w ON w.id=o.warehouse_id LEFT JOIN warehouses w2 ON w2.id=o.output_warehouse_id
     LEFT JOIN cost_centers cc ON cc.id=o.cost_center_id LEFT JOIN mfg_boms b ON b.id=o.bom_id LEFT JOIN mfg_orders par ON par.id=o.parent_id WHERE o.id=$1 AND o.company_id=$2`, [uid(id), C], "أمر التصنيع غير موجود");
  const bal = await stockMap(t, C);
  const base = shapeOrder(o, bal, today());
  const av = availability(o, bal);
  const moves = await t.rows(`SELECT m.*, p.name product_name, p.unit, e.number entry_number FROM mfg_moves m LEFT JOIN products p ON p.id=m.product_id LEFT JOIN journal_entries e ON e.id=m.entry_id WHERE m.order_id=$1 ORDER BY m.created_at, m.id`, [o.id]);
  const children = await t.rows(`SELECT o.id, o.number, o.status, o.qty, o.produced_qty, p.name FROM mfg_orders o JOIN products p ON p.id=o.product_id WHERE o.parent_id=$1 ORDER BY o.number`, [o.id]);
  const qty = n(o.qty), produced = n(o.producedQty), scrap = n(o.scrapQty);
  const basis = o.status === "DONE" ? produced + scrap : Math.max(produced + scrap, 0);
  const ratio = qty ? basis / qty : 0;
  const materials = av.mats.map((m: any) => {
    const net = r3(n(m.issued) - n(m.returned));
    const std = r3(n(m.planned) * ratio);
    return { ...m, net, stdForOutput: std, qtyVariance: r3(net - std), stdValue: r2(std * n(m.stdUnitCost)), valueVariance: r2(n(m.value) - std * n(m.stdUnitCost)) };
  });
  const ops = (o.ops || []).map((x: any, i: number, all: any[]) => ({ ...x, plannedCost: r2((n(x.plannedMin) / 60) * (n(x.rateHour) + n(x.overheadHour)) + n(x.rateUnit) * qty), ready: all.slice(0, i).every((y: any) => y.status === "DONE") }));
  const main = mainValue(o);
  const sheet = {
    material: n(o.materialCost), conversion: n(o.conversionCost), total: r2(n(o.materialCost) + n(o.conversionCost)), wip: n(o.wip), received: n(o.receivedValue), receivedMain: main, byproducts: r2(n(o.receivedValue) - main),
    scrap: n(o.scrapValue), variance: n(o.variance), stdUnitCost: n(o.stdUnitCost), stdForOutput: r2(n(o.stdUnitCost) * produced),
    actualUnitCost: produced > 0 ? Math.round((main / produced) * 10000) / 10000 : null, costVariance: produced > 0 && o.status === "DONE" ? r2(main - n(o.stdUnitCost) * produced) : null,
    yieldPct: produced + scrap > 0 ? r2((produced / (produced + scrap)) * 100) : null,
  };
  return { ...base, warehouseId: o.warehouseId, outputWarehouseId: o.outputWarehouseId, outputWarehouseName: o.outputWarehouseName, costCenterId: o.costCenterId, costCenterName: o.costCenterName, bomCode: o.bomCode, bomVersion: o.bomVersion, parentNumber: o.parentNumber,
    lotNo: o.lotNo, expiryDate: iso(o.expiryDate), notes: o.notes, createdBy: o.createdBy, closedAt: o.closedAt, materials, ops, byproducts: o.byproducts || [], sheet,
    moves: moves.map((m: any) => ({ id: m.id, kind: m.kind, date: iso(m.date), productId: m.productId, productName: m.productName, unit: m.unit, qty: n(m.qty), value: n(m.value), opSeq: m.opSeq, minutes: m.minutes === null ? null : n(m.minutes), entryId: m.entryId, entryNumber: m.entryNumber, notes: m.notes, createdBy: m.createdBy })),
    children: children.map((c: any) => ({ id: c.id, number: c.number, status: c.status, qty: n(c.qty), producedQty: n(c.producedQty), name: c.name })) };
}

// ───────────────────────── disassembly ─────────────────────────
export async function unbuild(t: Db, C: string, user: string, b: any, opts: { isDemo?: boolean } = {}) {
  const prod = await t.one(`SELECT id, name, type FROM products WHERE id=$1 AND company_id=$2`, [uid(b.productId), C], "الصنف غير موجود");
  const cx = await loadCx(t, C);
  const bom = uid(b.bomId) ? cx.boms.get(b.bomId) : cx.def.get(prod.id);
  if (!bom || bom.productId !== prod.id) throw bad(`لا قائمة مواد لـ«${prod.name}» تبيّن ما يخرج منه عند الفك`);
  const qty = r3(num(b.qty)); if (!(qty > 0)) throw bad("الكمية يجب أن تكون أكبر من صفر");
  const date = isDate(b.date) ? String(b.date) : today(); await assertOpenDate(t, C, date);
  const wh = await defaultWarehouse(t, C, b.warehouseId);
  const number = await nextNumber(t, C, "UB", date);
  const row = await t.insert("mfg_unbuilds", { companyId: C, number, date, productId: prod.id, bomId: bom.id, warehouseId: wh, qty, notes: txt(b.notes, 300), createdBy: user, isDemo: !!opts.isDemo });
  const value = await stockOut(t, C, { productId: prod.id, warehouseId: wh, qty, date, sourceType: "MFG_UNBUILD", sourceId: row.id, reference: number, isDemo: !!opts.isDemo, allowNegative: false, productName: prod.name });
  const out = n(bom.outputQty) || 1;
  const comps = (bom.lines || []).map((l: any) => { const q = r3((n(l.qty) * qty) / out); return { componentId: l.componentId, name: cx.prods.get(l.componentId)?.name, unit: cx.prods.get(l.componentId)?.unit, qty: q, w: q * unitCostOf(cx, l.componentId, new Set([prod.id])) }; }).filter((c: any) => c.qty > 0);
  const W = comps.reduce((a: number, c: any) => a + c.w, 0), Q = comps.reduce((a: number, c: any) => a + c.qty, 0);
  let rest = value;
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const v = i === comps.length - 1 ? rest : r2(value * (W > 0 ? c.w / W : c.qty / Q)); rest = r2(rest - v); c.value = v;
    await stockIn(t, C, { productId: c.componentId, warehouseId: wh, qty: c.qty, date, sourceType: "MFG_UNBUILD", sourceId: row.id, reference: number, isDemo: !!opts.isDemo, value: v, lotNo: number });
  }
  // value moves from the product to its parts inside the same inventory account: no journal entry is needed
  const lines = comps.map(({ w, ...c }: any) => c);
  await t.update("mfg_unbuilds", { id: row.id }, { value, lines });
  return { ...row, value, lines, productName: prod.name };
}
export async function listUnbuilds(t: Db, C: string) {
  const rows = await t.rows(`SELECT u.*, p.name product_name, p.unit, w.name warehouse_name FROM mfg_unbuilds u JOIN products p ON p.id=u.product_id LEFT JOIN warehouses w ON w.id=u.warehouse_id WHERE u.company_id=$1 ORDER BY u.date DESC, u.created_at DESC LIMIT 300`, [C]);
  return rows.map((u: any) => ({ id: u.id, number: u.number, date: iso(u.date), productId: u.productId, productName: u.productName, unit: u.unit, qty: n(u.qty), value: n(u.value), lines: u.lines || [], warehouseName: u.warehouseName, notes: u.notes, createdBy: u.createdBy }));
}

// ───────────────────────── material requirements planning ─────────────────────────
export async function mrp(t: Db, C: string, q: any = {}) {
  const cx = await loadCx(t, C);
  const safetyOn = q.safety !== "0";
  const [sales, pos, open, last] = await Promise.all([
    t.rows(`SELECT l.product_id, SUM(l.qty*COALESCE(l.factor,1)) q FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='SALE' AND i.kind='ORDER' AND i.status NOT IN ('CONVERTED','CANCELLED','VOID') AND l.product_id IS NOT NULL GROUP BY l.product_id`, [C]),
    t.rows(`SELECT l.product_id, SUM(l.qty*COALESCE(l.factor,1)) q FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='ORDER' AND i.status='DRAFT' GROUP BY l.product_id`, [C]),
    t.rows(`SELECT * FROM mfg_orders WHERE company_id=$1 AND status IN ('DRAFT','CONFIRMED','IN_PROGRESS')`, [C]),
    t.rows(`SELECT DISTINCT ON (l.product_id) l.product_id, i.partner_id, i.partner_name, l.unit_price/NULLIF(l.factor,0) price FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1 AND i.direction='PURCHASE' AND i.kind='INVOICE' AND i.status='POSTED' ORDER BY l.product_id, i.date DESC`, [C]),
  ]);
  const S = new Map(sales.map((r: any) => [r.productId, n(r.q)])), PO = new Map(pos.map((r: any) => [r.productId, n(r.q)])), LB = new Map(last.map((r: any) => [r.productId, r]));
  const dep = new Map<string, number>(), inProd = new Map<string, number>();
  for (const o of open) {
    inProd.set(o.productId, (inProd.get(o.productId) || 0) + Math.max(0, n(o.qty) - n(o.producedQty) - n(o.scrapQty)));
    for (const m of o.materials || []) { const left = n(m.planned) - (n(m.issued) - n(m.returned)); if (left > 0) dep.set(m.componentId, (dep.get(m.componentId) || 0) + left); }
  }
  // low-level codes: a product is planned after everything that uses it
  const lvl = new Map<string, number>();
  for (let it = 0; it < 14; it++) { let ch = false; for (const b of cx.def.values()) { const pl = lvl.get(b.productId) || 0; for (const l of b.lines || []) if ((lvl.get(l.componentId) || 0) < pl + 1) { lvl.set(l.componentId, pl + 1); ch = true; } } if (!ch) break; }
  const planned = new Map<string, number>();
  const ids = new Set<string>([...S.keys(), ...dep.keys(), ...inProd.keys()].filter((x) => cx.prods.has(x)));
  if (safetyOn) for (const p of cx.prods.values()) if (p.type === "STOCK" && p.isActive && n(p.reorderLevel) > 0 && ((cx.onHand.get(p.id) || 0) < n(p.reorderLevel) || cx.def.has(p.id))) ids.add(p.id);
  const order = [...ids];
  const rows: any[] = [];
  const done = new Set<string>();
  const queue = () => [...new Set([...order, ...planned.keys()])].filter((x) => !done.has(x)).sort((a, z) => (lvl.get(a) || 0) - (lvl.get(z) || 0));
  for (let guard = 0; guard < 5000; guard++) {
    const next = queue()[0]; if (!next) break; done.add(next);
    const p = cx.prods.get(next); if (!p || p.type !== "STOCK") continue;
    const bom = cx.def.get(next);
    const kit = bom?.kind === "KIT";
    const sales_ = S.get(next) || 0, mo = dep.get(next) || 0, plan = planned.get(next) || 0;
    const safety = safetyOn ? n(p.reorderLevel) : 0;
    const onHand = cx.onHand.get(next) || 0, onPO = PO.get(next) || 0, prod_ = inProd.get(next) || 0;
    const gross = sales_ + mo + plan;
    const net = r3(gross + safety - onHand - onPO - prod_);
    const make = !!bom && !kit;
    let suggested = 0;
    if (net > 0.0005) {
      suggested = p.unit && /حب|قطع|طاول|كرسي|علب|كرتون|جهاز|pc|unit/i.test(p.unit) ? Math.ceil(net - 1e-9) : Math.ceil(net * 1000 - 1e-6) / 1000;
      if (bom) for (const l of bom.lines || []) { const need = (n(l.qty) * (1 + n(l.wastePct) / 100) * suggested) / (n(bom.outputQty) || 1); planned.set(l.componentId, (planned.get(l.componentId) || 0) + need); }
    }
    if (kit) continue; // a kit is never stocked or bought: its demand passed to its components
    if (!(gross > 0 || suggested > 0 || onPO > 0 || prod_ > 0)) continue;
    const lb: any = LB.get(next);
    const price = make ? rollup(cx, bom).unitCost : n(lb?.price ?? p.purchasePrice);
    rows.push({ productId: next, sku: p.sku, name: p.name, unit: p.unit, level: lvl.get(next) || 0, make, bomId: make ? bom.id : null, sales: r3(sales_), moDemand: r3(mo), planDemand: r3(plan), safety: r3(safety), onHand: r3(onHand), onPO: r3(onPO), inProduction: r3(prod_), net: Math.max(0, net), suggested,
      supplierId: make ? null : lb?.partnerId || null, supplierName: make ? null : lb?.partnerName || null, price: Math.round(price * 10000) / 10000, value: r2(suggested * price) });
  }
  rows.sort((a, z) => a.level - z.level || Number(z.suggested > 0) - Number(a.suggested > 0) || a.name.localeCompare(z.name, "ar"));
  const toMake = rows.filter((r) => r.make && r.suggested > 0), toBuy = rows.filter((r) => !r.make && r.suggested > 0);
  return { rows, totals: { make: toMake.length, buy: toBuy.length, buyValue: r2(toBuy.reduce((a, r) => a + r.value, 0)), makeValue: r2(toMake.reduce((a, r) => a + r.value, 0)) } };
}
export async function ordersFromPlan(t: Db, company: any, user: string, b: any) {
  const items = (Array.isArray(b.items) ? b.items : []).filter((x: any) => uid(x.productId) && num(x.qty) > 0);
  if (!items.length) throw bad("اختر الأصناف المطلوب تصنيعها");
  const out: any[] = [];
  for (const it of items) out.push(await createOrder(t, company, user, { productId: it.productId, qty: num(it.qty), dueDate: b.dueDate, plannedStart: b.plannedStart, warehouseId: b.warehouseId, notes: "من تخطيط الاحتياجات" }));
  return out.map((o) => ({ id: o.id, number: o.number }));
}

// ───────────────────────── capacity and scheduling ─────────────────────────
/**
 * Finite-capacity schedule: open orders in priority / due-date order; each stage starts after the previous one and
 * fills its work centre's free minutes day by day. Gives the load per centre and day, and when each order should finish.
 */
export async function schedule(t: Db, C: string, q: any = {}) {
  const from = isDate(q.from) ? String(q.from) : today();
  const days = Math.max(7, Math.min(62, Math.round(num(q.days) || 14)));
  const wcs = (await t.rows(`SELECT * FROM mfg_work_centers WHERE company_id=$1 AND is_active ORDER BY code`, [C])).map(shapeWc);
  const offDay = q.offDay === undefined ? 5 : Number(q.offDay); // Friday off by default (0 Sunday … 6 Saturday); -1 none
  const cap = (w: any, d: string) => (new Date(d + "T00:00:00Z").getUTCDay() === offDay ? 0 : w.dailyMinutes);
  const used = new Map<string, number>(); // wc|day → minutes
  const open = await t.rows(`SELECT o.*, p.name product_name FROM mfg_orders o JOIN products p ON p.id=o.product_id WHERE o.company_id=$1 AND o.status IN ('CONFIRMED','IN_PROGRESS','DRAFT') ORDER BY CASE o.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'CONFIRMED' THEN 1 ELSE 2 END, o.priority, o.due_date NULLS LAST, o.number`, [C]);
  const byWc = new Map(wcs.map((w: any) => [w.id, w]));
  const orders: any[] = [];
  const horizon = 366;
  for (const o of open) {
    let day = [iso(o.plannedStart) || iso(o.date)!, from].sort().pop()!;
    let start: string | null = null;
    const opsOut: any[] = [];
    for (const op of o.ops || []) {
      const left = op.status === "DONE" ? 0 : Math.max(0, n(op.plannedMin) - n(op.actualMin));
      const w: any = byWc.get(op.workCenterId);
      if (!left || !w) { opsOut.push({ seq: op.seq, name: op.name, workCenter: op.workCenter, minutes: 0, start: null, end: null }); continue; }
      let rest = left, d = day, s: string | null = null, guard = 0;
      while (rest > 0.01 && guard++ < horizon) {
        const k = `${w.id}|${d}`; const free = cap(w, d) - (used.get(k) || 0);
        if (free > 0.01) { const take = Math.min(free, rest); used.set(k, (used.get(k) || 0) + take); rest -= take; s = s || d; }
        if (rest > 0.01) d = addDays(d, 1);
      }
      if (!s) s = d;
      opsOut.push({ seq: op.seq, name: op.name, workCenter: w.name, minutes: r2(left), start: s, end: d });
      start = start || s; day = d;
    }
    const end = opsOut.filter((x) => x.end).map((x) => x.end).sort().pop() || null;
    orders.push({ id: o.id, number: o.number, productName: o.productName, qty: n(o.qty), status: o.status, priority: o.priority, dueDate: iso(o.dueDate), start, end, late: !!(o.dueDate && end && end > iso(o.dueDate)!), ops: opsOut });
  }
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const centers = wcs.map((w: any) => {
    const load = dayList.map((d) => ({ day: d, minutes: r2(used.get(`${w.id}|${d}`) || 0), capacity: cap(w, d) }));
    const L = load.reduce((a, x) => a + x.minutes, 0), K = load.reduce((a, x) => a + x.capacity, 0);
    const backlog = [...used.entries()].filter(([k]) => k.startsWith(w.id + "|")).reduce((a, [, v]) => a + v, 0);
    return { id: w.id, code: w.code, name: w.name, kind: w.kind, dailyMinutes: w.dailyMinutes, load, loadHours: r2(L / 60), capacityHours: r2(K / 60), utilizationPct: K ? r2((L / K) * 100) : 0, backlogHours: r2(backlog / 60) };
  });
  return { from, days: dayList, centers, orders, late: orders.filter((o) => o.late).length };
}

/** The shop-floor list: stages to work on, for one work centre or all. */
export async function floor(t: Db, C: string, q: any = {}) {
  const rows = await t.rows(`SELECT o.*, p.name product_name, p.unit FROM mfg_orders o JOIN products p ON p.id=o.product_id WHERE o.company_id=$1 AND o.status IN ('CONFIRMED','IN_PROGRESS') ORDER BY o.priority, o.due_date NULLS LAST, o.number`, [C]);
  const bal = await stockMap(t, C);
  const wc = uid(q.workCenterId);
  const out: any[] = [];
  for (const o of rows) {
    const ops = o.ops || [];
    const av = availability(o, bal).state;
    ops.forEach((op: any, i: number) => {
      if (op.status === "DONE" || (wc && op.workCenterId !== wc)) return;
      out.push({ orderId: o.id, number: o.number, productName: o.productName, unit: o.unit, qty: n(o.qty), producedQty: n(o.producedQty), priority: o.priority, dueDate: iso(o.dueDate), late: !!o.dueDate && iso(o.dueDate)! < today(), availability: av,
        seq: op.seq, name: op.name, workCenterId: op.workCenterId, workCenter: op.workCenter, status: op.status, plannedMin: n(op.plannedMin), actualMin: n(op.actualMin), qc: !!op.qc, startedAt: op.startedAt, operator: op.operator, instructions: op.instructions,
        ready: ops.slice(0, i).every((y: any) => y.status === "DONE") });
    });
  }
  return out;
}

// ───────────────────────── dashboard and reports ─────────────────────────
export async function dashboard(t: Db, C: string) {
  const td = today(), m0 = td.slice(0, 8) + "01";
  const [st, wipGl, month, late, running] = await Promise.all([
    t.rows(`SELECT status, COUNT(*)::int c, COALESCE(SUM(wip),0) wip FROM mfg_orders WHERE company_id=$1 GROUP BY status`, [C]),
    t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='WIP' AND e.status='POSTED'`, [C]),
    t.one(`SELECT COALESCE(SUM(qty) FILTER (WHERE kind='RECEIPT'),0) produced, COALESCE(SUM(value) FILTER (WHERE kind IN ('RECEIPT','BYPRODUCT')),0) received, COALESCE(SUM(value) FILTER (WHERE kind='LABOR'),0) conversion,
             COALESCE(SUM(value) FILTER (WHERE kind='ISSUE'),0) - COALESCE(SUM(value) FILTER (WHERE kind='RETURN'),0) material, COALESCE(SUM(minutes) FILTER (WHERE kind='LABOR'),0) minutes, COALESCE(SUM(qty) FILTER (WHERE kind='SCRAP'),0) scrap,
             COALESCE(SUM(value) FILTER (WHERE kind='CLOSE'),0) variance FROM mfg_moves WHERE company_id=$1 AND date >= $2`, [C, m0]),
    t.rows(`SELECT o.id, o.number, o.due_date, o.qty, o.produced_qty, o.status, p.name FROM mfg_orders o JOIN products p ON p.id=o.product_id WHERE o.company_id=$1 AND o.status IN ('DRAFT','CONFIRMED','IN_PROGRESS') AND o.due_date < $2 ORDER BY o.due_date LIMIT 10`, [C, td]),
    t.rows(`SELECT o.id, o.number, p.name, op FROM mfg_orders o JOIN products p ON p.id=o.product_id, jsonb_array_elements(o.ops) op WHERE o.company_id=$1 AND o.status='IN_PROGRESS' AND op->>'status'='RUNNING'`, [C]),
  ]);
  const by = Object.fromEntries(st.map((r: any) => [r.status, r.c]));
  const openWip = r2(st.filter((r: any) => MO_OPEN.includes(r.status)).reduce((a: number, r: any) => a + n(r.wip), 0));
  const open = await t.rows(`SELECT * FROM mfg_orders WHERE company_id=$1 AND status IN ('CONFIRMED','IN_PROGRESS')`, [C]);
  const bal = await stockMap(t, C);
  const short = open.map((o: any) => ({ o, a: availability(o, bal) })).filter((x: any) => x.a.state !== "OK").slice(0, 10).map((x: any) => ({ id: x.o.id, number: x.o.number, state: x.a.state, missing: x.a.mats.filter((m: any) => m.avail === "SHORT" || m.avail === "PARTIAL").map((m: any) => ({ name: m.name, need: m.need, onHand: m.onHand, unit: m.unit })) }));
  const upcoming = await t.rows(`SELECT o.id, o.number, o.due_date, o.qty, o.produced_qty, o.status, o.priority, p.name FROM mfg_orders o JOIN products p ON p.id=o.product_id WHERE o.company_id=$1 AND o.status IN ('DRAFT','CONFIRMED','IN_PROGRESS') ORDER BY o.priority, o.due_date NULLS LAST LIMIT 8`, [C]);
  const counts = await t.one(`SELECT (SELECT COUNT(*) FROM mfg_boms WHERE company_id=$1 AND is_active)::int boms, (SELECT COUNT(*) FROM mfg_work_centers WHERE company_id=$1 AND is_active)::int centers`, [C]);
  const mo = (r: any) => ({ id: r.id, number: r.number, name: r.name, dueDate: iso(r.dueDate), qty: n(r.qty), producedQty: n(r.producedQty), status: r.status, priority: r.priority });
  return {
    counts: { draft: by.DRAFT || 0, confirmed: by.CONFIRMED || 0, inProgress: by.IN_PROGRESS || 0, done: by.DONE || 0, cancelled: by.CANCELLED || 0, boms: counts.boms, centers: counts.centers },
    wip: { orders: openWip, ledger: r2(wipGl.b), match: Math.abs(openWip - n(wipGl.b)) < 0.01 },
    month: { from: m0, producedQty: r3(month.produced), received: r2(month.received), material: r2(month.material), conversion: r2(month.conversion), hours: r2(n(month.minutes) / 60), scrapQty: r3(month.scrap), variance: r2(month.variance) },
    late: late.map(mo), running: running.map((r: any) => ({ id: r.id, number: r.number, name: r.name, stage: r.op.name, workCenter: r.op.workCenter, startedAt: r.op.startedAt, operator: r.op.operator })), shortages: short, upcoming: upcoming.map(mo),
  };
}

export async function reports(t: Db, C: string, q: any = {}) {
  const to = isDate(q.to) ? String(q.to) : today(), from = isDate(q.from) ? String(q.from) : to.slice(0, 8) + "01";
  const [production, orders, materials, centers, scrap, wipOrders, wipGl] = await Promise.all([
    t.rows(`SELECT m.product_id, p.sku, p.name, p.unit, SUM(m.qty) qty, SUM(m.value) value FROM mfg_moves m JOIN products p ON p.id=m.product_id WHERE m.company_id=$1 AND m.kind IN ('RECEIPT','BYPRODUCT') AND m.date BETWEEN $2 AND $3 GROUP BY 1,2,3,4 ORDER BY value DESC`, [C, from, to]),
    t.rows(`SELECT o.*, p.name product_name, p.unit FROM mfg_orders o JOIN products p ON p.id=o.product_id WHERE o.company_id=$1 AND o.status='DONE' AND (o.closed_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $2 AND $3 ORDER BY o.closed_at DESC`, [C, from, to]),
    t.rows(`SELECT m.product_id, p.sku, p.name, p.unit, SUM(CASE WHEN m.kind='ISSUE' THEN m.qty ELSE -m.qty END) qty, SUM(CASE WHEN m.kind='ISSUE' THEN m.value ELSE -m.value END) value FROM mfg_moves m JOIN products p ON p.id=m.product_id WHERE m.company_id=$1 AND m.kind IN ('ISSUE','RETURN') AND m.date BETWEEN $2 AND $3 GROUP BY 1,2,3,4 ORDER BY value DESC`, [C, from, to]),
    t.rows(`SELECT w.id, w.code, w.name, w.capacity_hours, w.units, w.efficiency_pct, COALESCE(SUM(m.minutes),0) minutes, COALESCE(SUM(m.value),0) value, COUNT(m.id)::int entries FROM mfg_work_centers w LEFT JOIN mfg_moves m ON m.work_center_id=w.id AND m.kind='LABOR' AND m.date BETWEEN $2 AND $3 WHERE w.company_id=$1 GROUP BY w.id ORDER BY value DESC`, [C, from, to]),
    t.rows(`SELECT m.date, o.number, p.name, m.qty, m.value, m.notes FROM mfg_moves m JOIN mfg_orders o ON o.id=m.order_id JOIN products p ON p.id=m.product_id WHERE m.company_id=$1 AND m.kind='SCRAP' AND m.date BETWEEN $2 AND $3 ORDER BY m.date DESC`, [C, from, to]),
    t.rows(`SELECT o.id, o.number, o.status, o.wip, o.material_cost, o.conversion_cost, o.received_value, p.name FROM mfg_orders o JOIN products p ON p.id=o.product_id WHERE o.company_id=$1 AND o.status IN ('DRAFT','CONFIRMED','IN_PROGRESS') AND o.wip <> 0 ORDER BY o.wip DESC`, [C]),
    t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journal_entries e ON e.id=l.entry_id WHERE a.company_id=$1 AND a.system_key='WIP' AND e.status='POSTED'`, [C]),
  ]);
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1);
  const ord = orders.map((o: any) => {
    const produced = n(o.producedQty), main = mainValue(o), std = r2(n(o.stdUnitCost) * produced);
    return { id: o.id, number: o.number, productName: o.productName, unit: o.unit, qty: n(o.qty), producedQty: produced, scrapQty: n(o.scrapQty), material: n(o.materialCost), conversion: n(o.conversionCost), received: main, std, costVariance: produced > 0 ? r2(main - std) : null, closeVariance: n(o.variance), scrapValue: n(o.scrapValue),
      unitCost: produced > 0 ? Math.round((main / produced) * 10000) / 10000 : null, stdUnitCost: n(o.stdUnitCost), yieldPct: produced + n(o.scrapQty) > 0 ? r2((produced / (produced + n(o.scrapQty))) * 100) : null, completionPct: n(o.qty) ? r2((produced / n(o.qty)) * 100) : 0 };
  });
  const wipSum = r2(wipOrders.reduce((a: number, o: any) => a + n(o.wip), 0));
  return {
    from, to,
    production: production.map((r: any) => ({ productId: r.productId, sku: r.sku, name: r.name, unit: r.unit, qty: r3(r.qty), value: r2(r.value), unitCost: n(r.qty) ? Math.round((n(r.value) / n(r.qty)) * 10000) / 10000 : 0 })),
    orders: ord,
    totals: { orders: ord.length, produced: r2(ord.reduce((a, o) => a + o.received, 0)), std: r2(ord.reduce((a, o) => a + o.std, 0)), costVariance: r2(ord.reduce((a, o) => a + (o.costVariance || 0), 0)), closeVariance: r2(ord.reduce((a, o) => a + o.closeVariance, 0)), scrap: r2(scrap.reduce((a: number, s: any) => a + n(s.value), 0)) },
    materials: materials.map((r: any) => ({ productId: r.productId, sku: r.sku, name: r.name, unit: r.unit, qty: r3(r.qty), value: r2(r.value) })),
    centers: centers.map((w: any) => { const capH = n(w.capacityHours) * n(w.units) * (n(w.efficiencyPct) / 100) * days; const h = n(w.minutes) / 60; return { id: w.id, code: w.code, name: w.name, hours: r2(h), value: r2(w.value), entries: w.entries, capacityHours: r2(capH), utilizationPct: capH ? r2((h / capH) * 100) : 0 }; }),
    scrap: scrap.map((s: any) => ({ date: iso(s.date), number: s.number, name: s.name, qty: r3(s.qty), value: r2(s.value), notes: s.notes })),
    wip: { orders: wipOrders.map((o: any) => ({ id: o.id, number: o.number, name: o.name, status: o.status, wip: n(o.wip), material: n(o.materialCost), conversion: n(o.conversionCost), received: n(o.receivedValue) })), total: wipSum, ledger: r2(wipGl.b), match: Math.abs(wipSum - n(wipGl.b)) < 0.01 },
  };
}

/** For the integrity checks: WIP of open orders against the WIP account (null when manufacturing is not in use). */
export async function wipCheck(t: Db, C: string) {
  const acc = await t.maybe(`SELECT id FROM accounts WHERE company_id=$1 AND system_key='WIP'`, [C]);
  if (!acc) return null;
  const [o, g] = await Promise.all([
    t.one(`SELECT COALESCE(SUM(wip),0) w FROM mfg_orders WHERE company_id=$1 AND status IN ('DRAFT','CONFIRMED','IN_PROGRESS')`, [C]),
    t.one(`SELECT COALESCE(SUM(l.debit-l.credit),0) b FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_id=$1 AND e.status='POSTED'`, [acc.id]),
  ]);
  return { orders: r2(o.w), ledger: r2(g.b) };
}
/** Journal entries of an order are managed from the order, not reversed from the journal. */
export async function mfgGuardOnReverse(t: Db, C: string, entryId: string) {
  const e = await t.maybe(`SELECT e.reference FROM journal_entries e WHERE e.id=$1 AND e.company_id=$2 AND e.source_type='MFG_ORDER'`, [uid(entryId), C]);
  if (e) throw conflict(`هذا قيد أمر التصنيع ${e.reference}: صحّحه من شاشة الأمر (إرجاع مواد، إلغاء أو إقفال) حتى يبقى رصيد «إنتاج تحت التشغيل» مطابقاً`);
}

/** For the assistant: a product's manufacturing cost by name (BOM rollup for a quantity). */
export async function costByName(t: Db, C: string, q: any) {
  const norm = (x: string) => String(x || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, " ").trim();
  const AR = (col: string) => `replace(replace(replace(replace(replace(lower(${col}),'أ','ا'),'إ','ا'),'آ','ا'),'ة','ه'),'ى','ي')`;
  const nq = norm(q.query); if (nq.length < 2) return { found: 0 };
  const words = nq.split(" ").filter((w) => w.length > 1);
  const rows = await t.rows(`SELECT DISTINCT p.id, p.name, length(p.name) l FROM products p JOIN mfg_boms b ON b.product_id=p.id AND b.is_active WHERE p.company_id=$1 AND ${words.map((_, i) => `${AR("p.name")} LIKE $${i + 2}`).join(" AND ")} ORDER BY l LIMIT 6`, [C, ...words.map((w) => `%${w}%`)]);
  if (!rows.length) return { found: 0 };
  const p = rows.find((r: any) => norm(r.name) === nq) || rows[0];
  if (rows.length > 1 && norm(p.name) !== nq && rows.length > 3) return { found: rows.length, candidates: rows.map((r: any) => r.name) };
  const r = await costFor(t, C, { productId: p.id, qty: q.qty });
  return { found: 1, name: p.name, qty: r.qty, unitCost: r.unitCost, material: r.material, conversion: r.conversion, byproductShare: r.byproductShare, total: r.totalForQty, lines: r.lines.slice(0, 12).map((l: any) => ({ name: l.name, qty: l.effQty, unit: l.unit, cost: l.cost })), ops: r.ops.map((o: any) => ({ name: o.name, workCenter: o.workCenter, minPerUnit: o.minPerUnit, perUnit: o.perUnit })), outputQty: r.outputQty };
}
