/**
 * Round 19 — charity: sponsorships (الكفالات), in-kind donations (التبرعات العينية), volunteers, alerts.
 *   • تحصيل كفالة    : سند قبض مصدره «كفالة» (Dr الصندوق/البنك  Cr 4309 إيرادات الكفالات) مرتبط بالكفالة وعدد الأقساط
 *   • استلام عيني     : Dr 110391 مخزون التبرعات العينية   Cr 4308 تبرعات عينية      (بالقيمة التقديرية)
 *   • توزيع عيني      : Dr 5506 مساعدات عينية موزعة          Cr 110391                 (بالمتوسط المرجح)
 */
import { Db } from "../db/pool";
import { bad, conflict, r2, r3, num, isDate, today, addMonths } from "../lib/core";
import { post, reverse, nextNumber } from "../accounting/engine";
import { ensureCharity, acct, project, createReceipt, saveBatch, budget } from "./charity";

const date = (v: any) => (isDate(v) ? v : today());
const pick = <T extends string>(v: any, list: T[], def: T): T => (list.includes(v) ? v : def);
export const SP_KIND: Record<string, string> = { ORPHAN: "كفالة يتيم", FAMILY: "كفالة أسرة", STUDENT: "كفالة طالب علم", PATIENT: "كفالة مريض", OTHER: "كفالة أخرى" };

// ─── sponsorships ──────────────────────────────────────────────────────────
function schedule(s: any, paid: number, asOf: string) {
  const freq = Math.max(1, Number(s.frequency) || 1);
  const start = String(s.startDate).slice(0, 10);
  const end = s.endDate ? String(s.endDate).slice(0, 10) : null;
  let due = 0;
  for (let i = 0; i < 600; i++) {
    const d = addMonths(start, i * freq);
    if (d > asOf || (end && d > end)) break;
    due++;
  }
  const total = end ? (() => { let n = 0; for (let i = 0; i < 600; i++) { if (addMonths(start, i * freq) > end) break; n++; } return n; })() : null;
  const nextIdx = paid;
  const nextDue = total !== null && nextIdx >= total ? null : addMonths(start, nextIdx * freq);
  return { due, paid, overdue: s.status === "ACTIVE" ? Math.max(0, due - paid) : 0, nextDue, total };
}
const label = (start: string, freq: number, from: number, n: number) => {
  const a = addMonths(start, from * freq).slice(0, 7), b = addMonths(start, (from + n - 1) * freq).slice(0, 7);
  return a === b ? a : `${a} … ${b}`;
};

export async function listSponsorships(t: Db, companyId: string, q: any = {}) {
  const rows = await t.rows(
    `SELECT s.*, sp.name sponsor_name, sp.phone sponsor_phone, sp.code sponsor_code, b.name beneficiary_name, b.code beneficiary_code, b.beneficiary_info, b.id_number beneficiary_id_no, pr.name project_name,
       COALESCE((SELECT SUM(periods_count) FROM charity_receipts r WHERE r.sponsorship_id=s.id AND r.status='POSTED'),0)::int paid_count,
       COALESCE((SELECT SUM(amount) FROM charity_receipts r WHERE r.sponsorship_id=s.id AND r.status='POSTED'),0) paid_amount,
       (SELECT MAX(date) FROM charity_receipts r WHERE r.sponsorship_id=s.id AND r.status='POSTED') last_paid
     FROM charity_sponsorships s JOIN partners sp ON sp.id=s.sponsor_id LEFT JOIN partners b ON b.id=s.beneficiary_id LEFT JOIN charity_projects pr ON pr.id=s.project_id
     WHERE s.company_id=$1 ${q.status ? "AND s.status=$2" : ""} ORDER BY s.status, s.number`, q.status ? [companyId, q.status] : [companyId]);
  const asOf = today();
  return rows.map((s: any) => {
    const sc = schedule(s, s.paidCount, asOf);
    return { ...s, ...sc, overdueAmount: r2(sc.overdue * Number(s.amount)), monthly: r2(Number(s.amount) / Math.max(1, s.frequency)) };
  });
}

export async function saveSponsorship(t: Db, companyId: string, user: string, b: any, id?: string) {
  await ensureCharity(t, companyId);
  const amount = r2(num(b.amount));
  if (!(amount > 0)) throw bad("مبلغ الكفالة يجب أن يكون أكبر من صفر");
  if (!b.sponsorId) throw bad("اختر الكافل من سجل المتبرعين");
  const sp = await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [b.sponsorId, companyId], "الكافل غير موجود");
  if (b.beneficiaryId) await t.one(`SELECT id FROM partners WHERE id=$1 AND company_id=$2`, [b.beneficiaryId, companyId], "المستفيد غير موجود");
  const pr = await project(t, companyId, b.projectId);
  if (!isDate(b.startDate)) throw bad("تاريخ بداية الكفالة مطلوب");
  if (b.endDate && isDate(b.endDate) && b.endDate < b.startDate) throw bad("تاريخ النهاية قبل البداية");
  const data: any = {
    sponsorId: sp.id, beneficiaryId: b.beneficiaryId || null, kind: pick(b.kind, Object.keys(SP_KIND), "ORPHAN"), amount, frequency: [1, 3, 6, 12].includes(Number(b.frequency)) ? Number(b.frequency) : 1,
    startDate: b.startDate, endDate: isDate(b.endDate) ? b.endDate : null, status: pick(b.status, ["ACTIVE", "PAUSED", "ENDED"], "ACTIVE"), projectId: pr?.id || null, notes: b.notes || null,
  };
  if (id) { await t.one(`SELECT id FROM charity_sponsorships WHERE id=$1 AND company_id=$2`, [id, companyId], "الكفالة غير موجودة"); return t.update("charity_sponsorships", { id, companyId }, data); }
  const number = await nextNumber(t, companyId, "SPN", b.startDate);
  return t.insert("charity_sponsorships", { companyId, number, ...data, isDemo: !!b.isDemo, createdBy: user });
}

export async function collectSponsorship(t: Db, companyId: string, user: string, id: string, b: any) {
  const s = (await listSponsorships(t, companyId)).find((x: any) => x.id === id);
  if (!s) throw bad("الكفالة غير موجودة");
  if (s.status === "ENDED") throw bad("الكفالة منتهية");
  const n = Math.max(1, Math.min(60, Math.round(num(b.count) || 1)));
  if (s.total !== null && s.paidCount + n > s.total) throw bad(`عدد الأقساط يتجاوز مدة الكفالة (المتبقي ${s.total - s.paidCount})`);
  const lbl = label(String(s.startDate).slice(0, 10), s.frequency, s.paidCount, n);
  return createReceipt(t, companyId, user, {
    date: b.date, partnerId: s.sponsorId, payerName: s.sponsorName, source: "SPONSORSHIP", amount: r2(Number(s.amount) * n),
    purpose: `${SP_KIND[s.kind]}${s.beneficiaryName ? " — " + s.beneficiaryName : ""} — ${lbl}`, projectId: s.projectId, method: b.method || "CASH",
    cashAccountId: b.cashAccountId, refNo: b.refNo, bankName: b.bankName, sponsorshipId: s.id, periodsCount: n, periodLabel: lbl, isDemo: s.isDemo,
  });
}

/** Draft expense run paying each active sponsorship's monthly share to its beneficiary. */
export async function sponsorshipPayoutRun(t: Db, companyId: string, user: string, b: any) {
  await ensureCharity(t, companyId);
  const month = /^\d{4}-\d{2}$/.test(String(b.month || "")) ? b.month : today().slice(0, 7);
  const list = (await listSponsorships(t, companyId, { status: "ACTIVE" })).filter((s: any) => s.beneficiaryId && String(s.startDate).slice(0, 7) <= month && (!s.endDate || String(s.endDate).slice(0, 7) >= month));
  if (!list.length) throw bad("لا توجد كفالات نشطة مرتبطة بمستفيدين لهذا الشهر");
  const exp = await acct(t, companyId, null, "CH_SPONSOR_PAID", "حساب الكفالات المصروفة");
  const byBenef = new Map<string, any>();
  for (const s of list) {
    const x = byBenef.get(s.beneficiaryId) || { partnerId: s.beneficiaryId, name: s.beneficiaryName, idNo: s.beneficiaryIdNo, iban: s.beneficiaryInfo?.iban, bankName: s.beneficiaryInfo?.bankName, capacity: "BENEFICIARY", amount: 0, reason: `صرف كفالة شهر ${month}` };
    x.amount = r2(x.amount + Number(s.monthly));
    byBenef.set(s.beneficiaryId, x);
  }
  return saveBatch(t, companyId, user, { title: `صرف الكفالات — ${month}`, date: b.date || today(), kind: b.kind || "TRANSFER", payAccountId: b.payAccountId || null, expenseAccountId: exp.id, lines: [...byBenef.values()], notes: `أُنشئ من ${list.length} كفالة نشطة` });
}

// ─── in-kind donations ─────────────────────────────────────────────────────
export async function listItems(t: Db, companyId: string) {
  return t.rows(`SELECT i.*, CASE WHEN qty > 0 THEN ROUND(value/qty, 4) ELSE 0 END avg_value,
    COALESCE((SELECT SUM((l->>'qty')::numeric) FROM charity_inkind_docs d, jsonb_array_elements(d.lines) l WHERE d.company_id=i.company_id AND d.kind='IN' AND d.status='POSTED' AND l->>'itemId'=i.id::text),0) received,
    COALESCE((SELECT SUM((l->>'qty')::numeric) FROM charity_inkind_docs d, jsonb_array_elements(d.lines) l WHERE d.company_id=i.company_id AND d.kind='OUT' AND d.status='POSTED' AND l->>'itemId'=i.id::text),0) distributed
    FROM charity_inkind_items i WHERE i.company_id=$1 ORDER BY i.category NULLS LAST, i.name`, [companyId]);
}

export async function saveItem(t: Db, companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim();
  if (!name) throw bad("اسم الصنف مطلوب");
  const data = { name, unit: String(b.unit || "حبة").trim(), category: b.category || null, minQty: r3(num(b.minQty)) };
  if (id) return t.update("charity_inkind_items", { id, companyId }, data);
  const n = await t.one(`SELECT COUNT(*)::int + 1 n FROM charity_inkind_items WHERE company_id=$1`, [companyId]);
  let code = String(b.code || "").trim() || `IK-${String(n.n).padStart(4, "0")}`;
  while (!b.code && (await t.maybe(`SELECT 1 FROM charity_inkind_items WHERE company_id=$1 AND code=$2`, [companyId, code]))) code = `IK-${String(Number(code.slice(3)) + 1).padStart(4, "0")}`;
  return t.insert("charity_inkind_items", { companyId, code, ...data }).catch((e) => { if (e.code === "23505") throw conflict("رمز الصنف مستخدم"); throw e; });
}

export async function listInkindDocs(t: Db, companyId: string, q: any) {
  const params: any[] = [companyId];
  const w = ["d.company_id=$1"];
  if (q.kind) { params.push(q.kind); w.push(`d.kind=$${params.length}`); }
  if (isDate(q.from)) { params.push(q.from); w.push(`d.date >= $${params.length}`); }
  if (isDate(q.to)) { params.push(q.to); w.push(`d.date <= $${params.length}`); }
  return t.rows(`SELECT d.*, pr.name project_name, je.number journal_number FROM charity_inkind_docs d LEFT JOIN charity_projects pr ON pr.id=d.project_id LEFT JOIN journal_entries je ON je.id=d.journal_id WHERE ${w.join(" AND ")} ORDER BY d.date DESC, d.number DESC LIMIT 5000`, params);
}

export async function createInkindDoc(t: Db, companyId: string, user: string, b: any) {
  await ensureCharity(t, companyId);
  const kind = pick(b.kind, ["IN", "OUT"], "IN");
  const party = String(b.partyName || "").trim();
  if (!party) throw bad(kind === "IN" ? "اسم المتبرع مطلوب" : "اسم المستفيد / الجهة المستلمة مطلوب");
  const pr = await project(t, companyId, b.projectId);
  const raw: any[] = Array.isArray(b.lines) ? b.lines.filter((l: any) => num(l.qty) > 0 && (l.itemId || String(l.name || "").trim())) : [];
  if (!raw.length) throw bad("أضف صنفاً واحداً على الأقل بكمية");
  const lines: any[] = [];
  for (const l of raw) {
    let it: any = l.itemId ? await t.one(`SELECT * FROM charity_inkind_items WHERE id=$1 AND company_id=$2 FOR UPDATE`, [l.itemId, companyId], "الصنف غير موجود") : null;
    if (!it) {
      if (kind === "OUT") throw bad(`الصنف «${l.name}» غير موجود في المخزون`);
      it = await t.maybe(`SELECT * FROM charity_inkind_items WHERE company_id=$1 AND name=$2 FOR UPDATE`, [companyId, String(l.name).trim()]);
      if (!it) it = await saveItem(t, companyId, { name: l.name, unit: l.unit, category: l.category });
    }
    const qty = r3(num(l.qty));
    if (kind === "IN") {
      const uv = r2(num(l.unitValue));
      if (uv < 0) throw bad("القيمة التقديرية لا تكون سالبة");
      const value = r2(qty * uv);
      await t.exec(`UPDATE charity_inkind_items SET qty=qty+$1, value=value+$2 WHERE id=$3`, [qty, value, it.id]);
      lines.push({ itemId: it.id, name: it.name, unit: it.unit, qty, unitValue: uv, value, notes: l.notes || null });
    } else {
      const cur = await t.one(`SELECT qty, value FROM charity_inkind_items WHERE id=$1`, [it.id]);
      if (Number(cur.qty) + 1e-9 < qty) throw bad(`الكمية المتاحة من «${it.name}» ${Number(cur.qty)} ${it.unit} فقط`);
      const value = Number(cur.qty) === qty ? r2(cur.value) : r2((Number(cur.value) / Number(cur.qty)) * qty);
      await t.exec(`UPDATE charity_inkind_items SET qty=qty-$1, value=CASE WHEN qty-$1 <= 0 THEN 0 ELSE value-$2 END WHERE id=$3`, [qty, value, it.id]);
      lines.push({ itemId: it.id, name: it.name, unit: it.unit, qty, unitValue: qty ? r2(value / qty) : 0, value, notes: l.notes || null });
    }
  }
  const total = r2(lines.reduce((a, l) => a + l.value, 0));
  const d = date(b.date);
  const number = await nextNumber(t, companyId, kind === "IN" ? "INK" : "IKD", d);
  const doc = await t.insert("charity_inkind_docs", { companyId, number, date: d, kind, partnerId: b.partnerId || null, partyName: party, projectId: pr?.id || null, lines: JSON.stringify(lines), total, notes: b.notes || null, isDemo: !!b.isDemo, createdBy: user });
  if (total > 0) {
    const stock = await acct(t, companyId, null, "CH_INKIND_STOCK", "مخزون التبرعات العينية");
    const other = await acct(t, companyId, null, kind === "IN" ? "DON_INKIND" : "CH_INKIND_DIST", kind === "IN" ? "تبرعات عينية" : "مساعدات عينية موزعة");
    const memo = `${kind === "IN" ? "استلام تبرع عيني من" : "توزيع مساعدات عينية على"} ${party} — ${lines.map((l) => `${l.name} ${l.qty}`).join("، ")}`.slice(0, 480);
    const je = await post(t, companyId, {
      date: d, type: kind === "IN" ? "DONATION" : "CHARITY_DISB", sourceType: "CHARITY_INKIND", sourceId: doc.id, reference: number, memo, createdBy: user, isDemo: !!b.isDemo,
      lines: kind === "IN"
        ? [{ account: stock.id, debit: total, description: memo }, { account: other.id, credit: total, partnerId: b.partnerId || null, costCenterId: pr?.costCenterId || null, description: memo }]
        : [{ account: other.id, debit: total, partnerId: b.partnerId || null, costCenterId: pr?.costCenterId || null, description: memo }, { account: stock.id, credit: total, description: memo }],
    });
    await t.exec(`UPDATE charity_inkind_docs SET journal_id=$1 WHERE id=$2`, [je!.id, doc.id]);
    doc.journalId = je!.id;
  }
  return doc;
}

export async function cancelInkindDoc(t: Db, companyId: string, user: string, id: string) {
  const d = await t.one(`SELECT * FROM charity_inkind_docs WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "المستند غير موجود");
  if (d.status === "CANCELLED") throw bad("المستند ملغى مسبقاً");
  for (const l of d.lines || []) {
    const it = await t.one(`SELECT * FROM charity_inkind_items WHERE id=$1 FOR UPDATE`, [l.itemId]);
    if (d.kind === "IN") {
      if (Number(it.qty) + 1e-9 < Number(l.qty)) throw bad(`لا يمكن الإلغاء: تم توزيع جزء من «${it.name}» — ألغِ مستندات التوزيع أولاً`);
      await t.exec(`UPDATE charity_inkind_items SET qty=qty-$1, value=GREATEST(0, value-$2) WHERE id=$3`, [l.qty, l.value, it.id]);
    } else await t.exec(`UPDATE charity_inkind_items SET qty=qty+$1, value=value+$2 WHERE id=$3`, [l.qty, l.value, it.id]);
  }
  if (d.journalId) await reverse(t, companyId, d.journalId, today() < String(d.date).slice(0, 10) ? d.date : today(), `إلغاء ${d.number}`, user);
  await t.exec(`UPDATE charity_inkind_docs SET status='CANCELLED' WHERE id=$1`, [id]);
  return { ok: true };
}

// ─── volunteers ────────────────────────────────────────────────────────────
export async function listVolunteers(t: Db, companyId: string) {
  return t.rows(`SELECT v.*, COALESCE(SUM(h.hours),0) hours, COUNT(h.id)::int sessions, MAX(h.date) last_date,
      COALESCE(SUM(h.hours) FILTER (WHERE h.date >= date_trunc('year', now())),0) hours_ytd,
      COALESCE((SELECT SUM(d.amount) FROM charity_disbursements d WHERE d.company_id=v.company_id AND d.capacity='VOLUNTEER' AND d.status='POSTED' AND (d.beneficiary_id_no=v.id_no OR d.beneficiary_name=v.name)),0) paid
    FROM charity_volunteers v LEFT JOIN charity_volunteer_hours h ON h.volunteer_id=v.id WHERE v.company_id=$1 GROUP BY v.id ORDER BY v.status, v.name`, [companyId]);
}
export async function saveVolunteer(t: Db, companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim();
  if (!name) throw bad("اسم المتطوع مطلوب");
  const data = { name, idNo: b.idNo || null, phone: b.phone || null, email: b.email || null, city: b.city || null, skills: b.skills || null, status: pick(b.status, ["ACTIVE", "INACTIVE"], "ACTIVE"), joinedAt: isDate(b.joinedAt) ? b.joinedAt : today(), notes: b.notes || null };
  if (id) return t.update("charity_volunteers", { id, companyId }, data);
  const n = await t.one(`SELECT COUNT(*)::int + 1 n FROM charity_volunteers WHERE company_id=$1`, [companyId]);
  let code = `VL-${String(n.n).padStart(4, "0")}`;
  while (await t.maybe(`SELECT 1 FROM charity_volunteers WHERE company_id=$1 AND code=$2`, [companyId, code])) code = `VL-${String(Number(code.slice(3)) + 1).padStart(4, "0")}`;
  return t.insert("charity_volunteers", { companyId, code, ...data });
}
export async function volunteerHours(t: Db, companyId: string, volunteerId: string) {
  return t.rows(`SELECT h.*, pr.name project_name FROM charity_volunteer_hours h LEFT JOIN charity_projects pr ON pr.id=h.project_id WHERE h.company_id=$1 AND h.volunteer_id=$2 ORDER BY h.date DESC`, [companyId, volunteerId]);
}
export async function addHours(t: Db, companyId: string, user: string, b: any) {
  const v = await t.one(`SELECT id FROM charity_volunteers WHERE id=$1 AND company_id=$2`, [b.volunteerId, companyId], "المتطوع غير موجود");
  const hours = r2(num(b.hours));
  if (!(hours > 0) || hours > 24) throw bad("عدد الساعات يجب أن يكون بين 0 و 24 لليوم الواحد");
  const pr = await project(t, companyId, b.projectId);
  return t.insert("charity_volunteer_hours", { companyId, volunteerId: v.id, date: date(b.date), hours, program: b.program || pr?.name || null, projectId: pr?.id || null, task: b.task || null, approvedBy: user });
}

// ─── alerts center ─────────────────────────────────────────────────────────
export async function alerts(t: Db, companyId: string) {
  await ensureCharity(t, companyId);
  const out: { level: "danger" | "warn" | "info"; title: string; detail: string; link: string }[] = [];
  const c = await t.one(`SELECT COUNT(*)::int n, COALESCE(SUM(disbursed_amount),0) a FROM charity_custody WHERE company_id=$1 AND status='DISBURSED' AND settle_due < CURRENT_DATE`, [companyId]);
  if (c.n) out.push({ level: "danger", title: `${c.n} عهدة متأخرة عن موعد التسوية`, detail: `بإجمالي ${r2(c.a)} ريال — طالب أصحابها بالتسوية وإعادة المتبقي`, link: "/charity/custody?q=" });
  const sp = (await listSponsorships(t, companyId, { status: "ACTIVE" })).filter((s: any) => s.overdue > 0);
  if (sp.length) out.push({ level: "warn", title: `${sp.length} كفالة عليها أقساط متأخرة`, detail: `إجمالي المتأخر ${r2(sp.reduce((a: number, s: any) => a + s.overdueAmount, 0))} ريال`, link: "/charity/sponsorships" });
  const days = await t.rows(
    `SELECT g::date d FROM generate_series(CURRENT_DATE - 7, CURRENT_DATE - 1, '1 day') g
     WHERE EXISTS (SELECT 1 FROM charity_receipts r WHERE r.company_id=$1 AND r.date=g::date AND r.status='POSTED' AND r.method='CASH')
       AND NOT EXISTS (SELECT 1 FROM charity_day_closings x WHERE x.company_id=$1 AND x.date=g::date)`, [companyId]);
  if (days.length) out.push({ level: "warn", title: `${days.length} يوم فيه تحصيل نقدي لم يُقفل`, detail: days.map((x: any) => String(x.d).slice(0, 10)).join("، "), link: "/charity/daily" });
  const rq = await t.one(`SELECT COUNT(*)::int n FROM charity_requests WHERE company_id=$1 AND status IN ('SUBMITTED','REVIEWED') AND date < CURRENT_DATE - 3`, [companyId]);
  if (rq.n) out.push({ level: "info", title: `${rq.n} طلب صرف ينتظر القرار أكثر من 3 أيام`, detail: "راجع الطلبات واعتمدها أو ارفضها", link: "/charity/requests" });
  const fm = await t.one(`SELECT COUNT(*) FILTER (WHERE kind='PURCHASE')::int p, COUNT(*) FILTER (WHERE kind='REFUND')::int r FROM charity_forms WHERE company_id=$1 AND status IN ('SUBMITTED','REVIEWED') AND date < CURRENT_DATE - 3`, [companyId]);
  if (fm.p) out.push({ level: "info", title: `${fm.p} طلب شراء ينتظر القرار`, detail: "أكثر من 3 أيام منذ التقديم", link: "/charity/purchases" });
  if (fm.r) out.push({ level: "info", title: `${fm.r} طلب استرداد ينتظر القرار`, detail: "أكثر من 3 أيام منذ التقديم", link: "/charity/refunds" });
  const bt = await t.one(`SELECT COUNT(*)::int n FROM charity_batches WHERE company_id=$1 AND status='DRAFT' AND created_at < now() - interval '2 days'`, [companyId]);
  if (bt.n) out.push({ level: "info", title: `${bt.n} مسير مصروفات مسودة لم يُعتمد`, detail: "أكثر من يومين على إنشائه", link: "/charity/batches" });
  const bg = (await budget(t, companyId, Number(today().slice(0, 4)))).lines.filter((l: any) => l.kind === "EXPENSE" && l.amount > 0 && l.actual / l.amount >= 0.9);
  if (bg.length) out.push({ level: bg.some((l: any) => l.actual > l.amount) ? "danger" : "warn", title: `${bg.length} بند موازنة تجاوز 90% من المقدّر`, detail: bg.slice(0, 3).map((l: any) => `${l.name} ${l.pct}%`).join("، "), link: "/charity/budget" });
  const lo = await t.rows(`SELECT name, qty, unit FROM charity_inkind_items WHERE company_id=$1 AND min_qty > 0 AND qty <= min_qty`, [companyId]);
  if (lo.length) out.push({ level: "warn", title: `${lo.length} صنف عيني وصل لحد إعادة الطلب`, detail: lo.slice(0, 4).map((x: any) => `${x.name} (${Number(x.qty)} ${x.unit})`).join("، "), link: "/charity/inkind" });
  const nb = await t.one(`SELECT COUNT(*)::int n FROM partners WHERE company_id=$1 AND is_beneficiary AND COALESCE(beneficiary_info->>'status','ACTIVE')='ACTIVE' AND COALESCE(beneficiary_info->>'iban','')=''`, [companyId]);
  if (nb.n) out.push({ level: "info", title: `${nb.n} مستفيد نشط بدون آيبان`, detail: "أكمل بياناتهم البنكية لتسهيل الصرف بالتحويل", link: "/charity/beneficiaries" });
  return out;
}
