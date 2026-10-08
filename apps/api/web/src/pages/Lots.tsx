import React, { useState } from "react";
import { api, q, useFetch, Money, Loading, Empty, Badge, Select, NumInput, useAction, useCompanyContext, ExportBtn, PrintBtn, fmtDate, confirmDlg, SearchBox, FilterInfo, matches, useSorted, Th } from "../lib";

const ST: Record<string, string> = { EXPIRED: "منتهية", SOON: "قريبة الانتهاء", OK: "صالحة", NONE: "بدون تاريخ" };
const color = (s: string) => ({ EXPIRED: "red", SOON: "amber", OK: "green", NONE: "gray" } as any)[s];

export function LotsPage() {
  const { can } = useCompanyContext();
  const { run, busy } = useAction();
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(60);
  const { data, reload } = useFetch(`/lots${q({ status, days })}`, [status, days]);
  const [text, setText] = useState("");
  const [wh, setWh] = useState("");
  const rows = (data?.rows || []).filter((r: any) => matches(r, text, ["name", "sku", "lotNo", "warehouse"]) && (!wh || r.warehouse === wh));
  const srt = useSorted(rows);
  if (!data) return <Loading />;
  const whs = [...new Set(data.rows.map((r: any) => r.warehouse))] as string[];
  const S = data.summary;
  return (
    <div className="grid">
      <div className="grid c4">
        <div className="card kpi danger" style={{ cursor: "pointer" }} onClick={() => setStatus("expired")}><div className="label">دفعات منتهية الصلاحية</div><div className="value">{S.expired.count}</div><div className="sub">الكمية {S.expired.qty} · القيمة {Number(S.expired.value).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div></div>
        <div className="card kpi accent" style={{ cursor: "pointer" }} onClick={() => setStatus("soon")}><div className="label">تنتهي خلال {data.days} يوماً</div><div className="value">{S.soon.count}</div><div className="sub">الكمية {S.soon.qty} · القيمة {Number(S.soon.value).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div></div>
        <div className="card kpi success" style={{ cursor: "pointer" }} onClick={() => setStatus("")}><div className="label">دفعات صالحة</div><div className="value">{S.ok.count}</div><div className="sub">القيمة {Number(S.ok.value).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div></div>
        <div className="card kpi"><div className="label">بدون تاريخ انتهاء</div><div className="value">{S.none.count}</div><div className="sub">أرصدة افتتاحية / مرتجعات</div></div>
      </div>
      <div className="card">
        <div className="card-h"><div><h3>الدفعات وتواريخ الصلاحية</h3><div className="small muted">الصرف في المبيعات ونقطة البيع يتم تلقائياً من الأقرب انتهاءً (FEFO)، ويُمنع بيع المنتهي إن كان الخيار مفعّلاً في الإعدادات</div></div>
          <div className="row no-print"><Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 170 }}><option value="">كل الدفعات</option><option value="expired">المنتهية فقط</option><option value="soon">القريبة من الانتهاء</option></Select><span className="small muted">قريبة خلال</span><NumInput value={days} onChange={(e) => setDays(Number(e.target.value) || 60)} style={{ width: 80 }} /><span className="small muted">يوم</span><PrintBtn /><ExportBtn name="الدفعات والصلاحية" rows={() => rows.map((r: any) => ({ الرمز: r.sku, الصنف: r.name, المستودع: r.warehouse, الدفعة: r.lotNo, "تاريخ الانتهاء": r.expiryDate, "الأيام المتبقية": r.daysLeft, الكمية: r.qty, القيمة: r.value, الحالة: ST[r.status] }))} /></div></div>
        <div className="card-b no-print" style={{ paddingBottom: 0 }}><div className="toolbar"><SearchBox value={text} onChange={setText} placeholder="بحث بالصنف / الرمز / رقم الدفعة" />{whs.length > 1 && <Select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">كل المستودعات</option>{whs.map((w) => <option key={w} value={w}>{w}</option>)}</Select>}<FilterInfo shown={rows.length} total={data.rows.length} active={!!(text || wh)} onClear={() => { setText(""); setWh(""); }} /></div></div>
        {!data.rows.length ? <Empty text="لا توجد دفعات — فعّل «تتبع الدفعات» في بطاقة الصنف ثم أدخل رقم الدفعة وتاريخ الانتهاء في فواتير الشراء" /> : <div className="table-wrap"><table className="tbl compact"><thead><tr><Th k="name" s={srt}>الصنف</Th><Th k="warehouse" s={srt}>المستودع</Th><Th k="lotNo" s={srt}>الدفعة</Th><Th k="receivedAt" s={srt}>الاستلام</Th><Th k="expiryDate" s={srt}>الانتهاء</Th><Th k="daysLeft" s={srt} n>متبقٍ (يوم)</Th><Th k="qty" s={srt} n>الكمية</Th><Th k="value" s={srt} n>القيمة بالتكلفة</Th><th>الحالة</th><th /></tr></thead>
          <tbody>{srt.sorted.map((r: any) => <tr key={r.id} className={r.status === "EXPIRED" ? "bold" : ""}><td>{r.name}<span className="small muted"> {r.sku}</span></td><td>{r.warehouse}</td><td className="num">{r.lotNo}</td><td className="dt">{fmtDate(r.receivedAt)}</td><td className={r.status === "EXPIRED" ? "neg-val" : ""}>{r.expiryDate || "—"}</td><td className={"n " + (r.daysLeft !== null && r.daysLeft < 0 ? "neg-val" : "")}>{r.daysLeft ?? ""}</td><td className="n">{Number(r.qty)} {r.unit}</td><td className="n"><Money v={r.value} /></td><td><Badge s={r.status} map={ST} /></td>
            <td>{can("inventory.write") && Number(r.qty) > 0 && r.status !== "OK" && r.status !== "NONE" && <button className="btn sm ghost no-print" disabled={busy} onClick={() => run(async () => { if (!confirmDlg(`إتلاف الدفعة ${r.lotNo} (${Number(r.qty)} ${r.unit}) وتحميل قيمتها على عجز وتالف المخزون؟`)) return; await api(`/lots/${r.id}/write-off`, { body: { reason: r.status === "EXPIRED" ? "منتهية الصلاحية" : "إتلاف" } }); reload(); }, "تم الإتلاف وترحيل قيد العجز")}>إتلاف</button>}</td></tr>)}</tbody></table></div>}
      </div>
    </div>
  );
}
