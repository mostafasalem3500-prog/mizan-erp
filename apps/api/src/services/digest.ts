/** Management reports by e-mail: each recipient gets only the sections chosen for them, at the end of the day / week / month. */
import { pool, db } from "../db/pool";
import { bad, today, addDays } from "../lib/core";
import { executive } from "./insights";
import { sendMail, emailLayout, mailStatus } from "./mail";
import { CFG } from "../lib/country";

export const SECTIONS: Record<string, string> = {
  summary: "الملخص التنفيذي والمؤشرات", sales: "تحليل المبيعات والأكثر مبيعاً", purchases: "المشتريات والموردون", expenses: "المصروفات",
  inventory: "تنبيهات المخزون والأصناف", receivables: "ذمم العملاء والتحصيل", payables: "مستحقات الموردين", cash: "النقدية والسيولة المتوقعة", alerts: "التنبيهات والملاحظات",
};
const FREQ = ["DAILY", "WEEKLY", "MONTHLY"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_RECIPIENTS = 50;
const pgArr = (xs: string[]) => `{${xs.join(",")}}`;
const riyadh = () => new Date(Date.now() + 3 * 3600 * 1000);

export function digestSettings(company: any) { return { enabled: false, hour: 21, weekday: 4, ...(company?.digest || {}) }; }
export async function saveDigestSettings(companyId: string, b: any) {
  const cur = (await db.one(`SELECT digest FROM companies WHERE id=$1`, [companyId])).digest || {};
  const s = { ...cur, enabled: !!b.enabled, hour: Math.max(0, Math.min(23, Math.round(Number(b.hour ?? 21)))), weekday: Math.max(0, Math.min(6, Math.round(Number(b.weekday ?? 4)))) };
  await db.exec(`UPDATE companies SET digest=$2::jsonb WHERE id=$1`, [companyId, JSON.stringify(s)]);
  return s;
}
export async function saveRecipient(companyId: string, b: any, id?: string) {
  const name = String(b.name || "").trim(), email = String(b.email || "").trim().toLowerCase();
  if (!name) throw bad("الاسم مطلوب");
  if (!EMAIL.test(email)) throw bad("البريد الإلكتروني غير صحيح");
  const sections = (Array.isArray(b.sections) ? b.sections : []).filter((s: string) => SECTIONS[s]);
  if (!sections.length) throw bad("اختر قسماً واحداً على الأقل ليُرسل لهذا المستلم");
  const data = { name, email, title: b.title || null, sections: pgArr(sections), frequency: FREQ.includes(b.frequency) ? b.frequency : "DAILY", branchId: /^[0-9a-f-]{36}$/i.test(String(b.branchId || "")) ? b.branchId : null, isActive: b.isActive !== false };
  const dup = await db.maybe(`SELECT id FROM report_recipients WHERE company_id=$1 AND email=$2 AND id<>$3`, [companyId, email, id || "00000000-0000-0000-0000-000000000000"]);
  if (dup) throw bad("هذا البريد مضاف مسبقاً");
  if (id) { const r = await db.update("report_recipients", { id, companyId }, data); if (!r) throw bad("المستلم غير موجود"); return r; }
  const n = await db.one(`SELECT COUNT(*)::int c FROM report_recipients WHERE company_id=$1`, [companyId]);
  if (n.c >= MAX_RECIPIENTS) throw bad(`الحد الأقصى ${MAX_RECIPIENTS} مستلماً`);
  return db.insert("report_recipients", { companyId, ...data });
}

// ─── the e-mail ────────────────────────────────────────────────────────────
const f0 = (v: any) => Number(v || 0).toLocaleString("en", { maximumFractionDigits: 0 });
const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
const delta = (v: number | null, goodUp = true) => (v === null || v === undefined ? "" : `<span style="color:${v === 0 ? "#667" : (v > 0) === goodUp ? "#15803d" : "#b91c1c"};font-size:12px">${v > 0 ? "▲" : v < 0 ? "▼" : "•"} ${Math.abs(v)}%</span>`);
const h3 = (t: string) => `<h3 style="margin:22px 0 8px;font-size:15px;color:#0f4c47;border-bottom:2px solid #e6f4f2;padding-bottom:4px">${t}</h3>`;
const table = (head: string[], rows: any[][]) => !rows.length ? `<div style="color:#778;font-size:13px">لا توجد بيانات في الفترة</div>` :
  `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr>${head.map((x, i) => `<th style="text-align:${i ? "left" : "right"};padding:6px 8px;background:#f3f6f5;border-bottom:1px solid #dde5e4">${x}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td style="padding:6px 8px;border-bottom:1px solid #eef2f1;text-align:${i ? "left" : "right"}${i ? ";direction:ltr" : ""}">${c}</td>`).join("")}</tr>`).join("")}</table>`;
const kpi = (label: string, value: string, extra = "") => `<td style="padding:10px;border:1px solid #e2e8e7;border-radius:8px;text-align:center;width:25%"><div style="font-size:12px;color:#667">${label}</div><div style="font-size:18px;font-weight:700;direction:ltr">${value}</div>${extra}</td>`;

export function digestHtml(company: any, d: any, sections: string[], label: string) {
  const k = d.kpis, ch = d.change, cur = CFG.currencySymbol;
  const has = (s: string) => sections.includes(s);
  let b = `<div style="color:#556;font-size:13px">${label}: <b style="direction:ltr;display:inline-block">${d.period.from === d.period.to ? d.period.to : `${d.period.from} → ${d.period.to}`}</b> — المقارنة مع الفترة السابقة المماثلة. المبالغ بـ${cur} قبل الضريبة.</div>`;
  if (has("summary")) {
    b += `<table style="width:100%;border-collapse:separate;border-spacing:6px;margin-top:12px"><tr>${kpi("المبيعات", f0(k.sales), delta(ch.sales))}${kpi("مجمل الربح", f0(k.grossProfit), `<span style="font-size:12px;color:#667">${k.margin}%</span>`)}${kpi("المصروفات", f0(k.expenses), delta(ch.expenses, false))}${kpi("صافي الربح التشغيلي", f0(k.netProfit), delta(ch.netProfit))}</tr>
      <tr>${kpi("عدد الفواتير", f0(k.invoices), delta(ch.invoices))}${kpi("متوسط الفاتورة", f0(k.avgTicket), delta(ch.avgTicket))}${kpi("المحصّل", f0(k.collected))}${kpi("المشتريات", f0(k.purchases), delta(ch.purchases, false))}</tr></table>`;
    if (d.insights.length) b += `<ul style="margin:12px 0 0;padding-inline-start:18px;font-size:13.5px;line-height:1.9">${d.insights.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  }
  if (has("alerts")) b += h3(`التنبيهات (${d.alerts.length})`) + (d.alerts.length ? d.alerts.map((a: any) => `<div style="padding:7px 10px;margin-bottom:5px;border-radius:7px;font-size:13px;background:${a.level === "danger" ? "#fee2e2" : a.level === "warn" ? "#fff3e0" : "#e8f1fd"}"><b>${esc(a.area)}:</b> ${esc(a.text)}</div>`).join("") : `<div style="color:#15803d;font-size:13px">لا توجد تنبيهات ✓</div>`);
  if (has("sales")) {
    b += h3("الأصناف الأكثر مبيعاً") + table(["الصنف", "الكمية", "المبيعات", "الربح", "الهامش"], d.topProducts.slice(0, 10).map((p: any) => [esc(p.name), f0(p.qty), f0(p.net), f0(p.profit), `${p.margin}%`]));
    b += h3("أكبر العملاء") + table(["العميل", "الفواتير", "المبيعات"], d.topCustomers.slice(0, 7).map((c: any) => [esc(c.name), c.n, f0(c.v)]));
    if (d.categories.length > 1) b += h3("المبيعات حسب التصنيف") + table(["التصنيف", "المبيعات", "الربح"], d.categories.slice(0, 8).map((c: any) => [esc(c.k), f0(c.v), f0(c.profit)]));
    if (d.byChannel.length > 1) b += h3("قنوات البيع") + table(["القناة", "الفواتير", "المبيعات"], d.byChannel.map((c: any) => [({ POS: "نقطة البيع", SALES: "الفواتير", SALLA: "سلة", ZID: "زد", API: "الربط" } as any)[c.k] || c.k, c.n, f0(c.v)]));
  }
  if (has("purchases")) {
    b += h3("أكبر الموردين في الفترة") + table(["المورد", "الفواتير", "المشتريات"], d.topSuppliers.slice(0, 7).map((s: any) => [esc(s.name), s.n, f0(s.v)]));
    b += h3("الأصناف الأكثر شراءً") + table(["الصنف", "الكمية", "القيمة"], d.topPurchased.slice(0, 7).map((p: any) => [esc(p.name), f0(p.qty), f0(p.v)]));
  }
  if (has("expenses")) b += h3(`المصروفات (${f0(k.expenses)})`) + table(["البند", "المبلغ"], d.expByAccount.map((e: any) => [esc(e.k), f0(e.v)]));
  if (has("inventory")) {
    const i = d.inventory;
    b += h3(`المخزون — القيمة ${f0(i.value)}`) + `<div style="font-size:13px;margin-bottom:8px">نافد: <b>${i.counts.outOfStock}</b> · عند حد الطلب: <b>${i.counts.belowReorder}</b> · يكفي أقل من أسبوع: <b>${i.counts.runningOut}</b> · راكد: <b>${i.counts.dead}</b> (${f0(i.deadValue)}) · دفعات تنتهي قريباً: <b>${i.counts.expiring}</b></div>`;
    const need = [...i.outOfStock, ...i.belowReorder, ...i.runningOut].slice(0, 12);
    if (need.length) b += table(["أصناف تحتاج طلباً", "الرصيد", "البيع اليومي", "يكفي (يوم)"], need.map((x: any) => [esc(x.name), f0(x.qty), x.daily, x.cover ?? "—"]));
    if (i.expiring.length) b += h3("دفعات قاربت الانتهاء") + table(["الصنف", "الكمية", "تاريخ الانتهاء", "متبقٍ (يوم)"], i.expiring.slice(0, 8).map((x: any) => [esc(x.name), f0(x.qty), x.expiry, x.days]));
  }
  const ag = (a: any) => table(["جارية", "1–30", "31–60", "61–90", "+90", "الإجمالي"], [[f0(a.current), f0(a.d30), f0(a.d60), f0(a.d90), f0(a.d90p), `<b>${f0(a.total)}</b>`]]);
  if (has("receivables")) b += h3("ذمم العملاء") + ag(d.receivables) + `<div style="height:8px"></div>` + table(["العميل", "المتأخر", "الرصيد"], d.receivables.top.slice(0, 6).map((x: any) => [esc(x.name), f0(x.overdue), f0(x.open)]));
  if (has("payables")) b += h3("مستحقات الموردين") + ag(d.payables) + `<div style="height:8px"></div>` + table(["المورد", "المتأخر", "الرصيد"], d.payables.top.slice(0, 6).map((x: any) => [esc(x.name), f0(x.overdue), f0(x.open)]));
  if (has("cash")) b += h3(`النقدية والبنوك — ${f0(d.cash.total)}`) + table(["الحساب", "الرصيد"], d.cash.accounts.map((a: any) => [esc(a.name), f0(a.balance)])) + `<div style="font-size:13px;margin-top:8px">المتوقع خلال 30 يوماً: تحصيل <b>${f0(d.forecast.inflow30)}</b> − سداد <b>${f0(d.forecast.outflow30)}</b> = سيولة متوقعة <b style="color:${d.forecast.projected < 0 ? "#b91c1c" : "#15803d"}">${f0(d.forecast.projected)}</b></div>`;
  const url = process.env.PUBLIC_URL;
  if (url) b += `<div style="margin-top:22px;text-align:center"><a href="${url.replace(/\/+$/, "")}/insights" style="background:#0f766e;color:#fff;padding:9px 22px;border-radius:8px;text-decoration:none;font-size:14px">فتح لوحة الإدارة</a></div>`;
  b += `<div style="margin-top:18px;font-size:11.5px;color:#889">تقرير آلي من ${CFG.appName}. يصلك ما حدّدته الإدارة لك من أقسام فقط.</div>`;
  return emailLayout(company, `${label} — ${company.nameAr}`, b);
}

function periodFor(freq: string, day: string) {
  if (freq === "WEEKLY") return { from: addDays(day, -6), to: day, label: "التقرير الأسبوعي" };
  if (freq === "MONTHLY") return { from: day.slice(0, 8) + "01", to: day, label: "التقرير الشهري" };
  return { from: day, to: day, label: "التقرير اليومي" };
}
export async function buildFor(company: any, r: any, day = today()) {
  const p = periodFor(r.frequency, day);
  const d = await executive(db, company.id, { from: p.from, to: p.to, branchId: r.branchId });
  return { html: digestHtml(company, d, r.sections, p.label), subject: `${p.label} ${p.to} — ${company.nameAr}`, period: `${p.from}..${p.to}` };
}
export async function sendTo(company: any, r: any, day = today()) {
  const m = await buildFor(company, r, day);
  try {
    await sendMail({ to: r.email, subject: m.subject, html: m.html, fromName: company.nameAr });
    await db.exec(`UPDATE report_recipients SET last_sent_at=now(), last_error=NULL WHERE id=$1`, [r.id]);
    await db.insert("report_send_log", { companyId: company.id, email: r.email, period: m.period, ok: true });
    return { email: r.email, ok: true };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await db.exec(`UPDATE report_recipients SET last_error=$2 WHERE id=$1`, [r.id, msg]);
    await db.insert("report_send_log", { companyId: company.id, email: r.email, period: m.period, ok: false, error: msg });
    return { email: r.email, ok: false, error: msg };
  }
}
/** Who is due on this day: daily always, weekly on the chosen weekday, monthly on the last day of the month. */
const due = (r: any, s: any, now: Date) => r.frequency === "DAILY" || (r.frequency === "WEEKLY" && now.getUTCDay() === s.weekday) || (r.frequency === "MONTHLY" && new Date(now.getTime() + 86400000).getUTCDate() === 1);

export function startDigestScheduler() {
  const tick = async () => {
    try {
      if (!mailStatus().configured) return;
      const now = riyadh(); const day = now.toISOString().slice(0, 10);
      const cos = (await pool.query(`SELECT * FROM companies c WHERE (c.digest->>'enabled')::boolean IS TRUE AND COALESCE(c.digest->>'lastRun','') <> $1 AND c.status='ACTIVE' AND (c.subscription_ends_at IS NULL OR c.subscription_ends_at > now())`, [day])).rows;
      for (const row of cos) {
        const s = digestSettings({ digest: row.digest });
        if (now.getUTCHours() < s.hour) continue;
        const company = await db.one(`SELECT * FROM companies WHERE id=$1`, [row.id]);
        await db.exec(`UPDATE companies SET digest = jsonb_set(digest, '{lastRun}', to_jsonb($2::text)) WHERE id=$1`, [row.id, day]); // mark first: never send twice
        const rs = await db.rows(`SELECT * FROM report_recipients WHERE company_id=$1 AND is_active`, [row.id]);
        let n = 0; for (const r of rs) if (due(r, s, now)) { await sendTo(company, r, day); n++; }
        if (n) console.log(`[digest] ${company.nameAr}: ${n} report(s) for ${day}`);
      }
    } catch (e) { console.error("[digest]", e); }
  };
  setTimeout(tick, 60000).unref();
  setInterval(tick, 15 * 60 * 1000).unref();
}
