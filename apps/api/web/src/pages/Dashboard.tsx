import React from "react";
import { Link } from "react-router-dom";
import { useFetch, Money, money, Loading, BarChart, Badge, KIND_AR, fmtDate, ZATCA_AR, useCompanyContext } from "../lib";

const M_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const mLabel = (m: string) => M_AR[Number(m.slice(5, 7)) - 1].slice(0, 5);

export function Dashboard() {
  const { data, loading } = useFetch("/dashboard");
  const { me } = useCompanyContext();
  if (loading || !data) return <Loading />;
  const d = data;
  return (
    <div className="grid">
      {!me.company.demoLoaded && !d.recent?.length && (
        <div className="alert info">مرحباً بك في ميزان! ابدأ بإضافة الأصناف والعملاء، أو <Link to="/settings/demo">حمّل البيانات التجريبية</Link> لاستكشاف النظام بأرقام كاملة (يمكن حذفها لاحقاً بضغطة واحدة).</div>
      )}
      <div className="grid c4">
        <div className="card kpi"><div className="icon">🧾</div><div className="label">مبيعات الشهر</div><div className="value"><Money v={d.salesMonth} /></div><div className="sub">اليوم: {money(d.salesToday)} ر.س</div></div>
        <div className="card kpi info"><div className="icon">📦</div><div className="label">مشتريات الشهر</div><div className="value"><Money v={d.purchMonth} /></div><div className="sub">مصروفات الشهر: {money(d.expMonth)}</div></div>
        <div className="card kpi success"><div className="icon">💵</div><div className="label">النقدية والبنوك</div><div className="value"><Money v={d.cashTotal} /></div><div className="sub">{d.cash.map((c: any) => `${c.nameAr}: ${money(c.bal)}`).slice(0, 2).join(" · ")}</div></div>
        <div className="card kpi accent"><div className="icon">٪</div><div className="label">صافي الضريبة المستحقة</div><div className="value"><Money v={d.vatDue} /></div><div className="sub">مخرجات − مدخلات (غير مسوّاة)</div></div>
        <div className="card kpi"><div className="icon">👥</div><div className="label">ذمم العملاء</div><div className="value"><Money v={d.ar} /></div><div className="sub">{d.overdue.length} فاتورة متأخرة</div></div>
        <div className="card kpi danger"><div className="icon">🏭</div><div className="label">ذمم الموردين</div><div className="value"><Money v={d.ap} /></div></div>
        <div className="card kpi info"><div className="icon">🏬</div><div className="label">قيمة المخزون</div><div className="value"><Money v={d.inventory} /></div><div className="sub">{d.lowStock.length} صنف تحت حد الطلب</div></div>
        <div className="card kpi success"><div className="icon">🛒</div><div className="label">وردية نقطة البيع</div>
          {d.openSession ? <><div className="value">{d.openSession.ordersCount} طلب</div><div className="sub">{d.openSession.userName} · نقدي {money(d.openSession.cashSales)} · شبكة {money(d.openSession.cardSales)}</div></> : <><div className="value muted" style={{ fontSize: 16 }}>لا توجد وردية مفتوحة</div><Link className="sub" to="/pos">افتح وردية →</Link></>}
        </div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>المبيعات والمشتريات — آخر 12 شهراً</h3></div><div className="card-b">{d.trend.length ? <BarChart data={d.trend} keys={["sales", "purchases"]} labels={(x) => mLabel(x.m)} /> : <div className="empty">لا توجد حركة بعد</div>}<div className="row small muted mt"><span>■ مبيعات</span><span style={{ color: "var(--accent)" }}>■ مشتريات</span></div></div></div>
        <div className="card"><div className="card-h"><h3>الإيرادات والمصروفات والربح الشهري</h3></div><div className="card-b">{d.pnl.length ? <BarChart data={d.pnl} keys={["revenue", "expense", "profit"]} labels={(x) => mLabel(x.m)} colors={["var(--primary)", "var(--accent)", "var(--info)"]} /> : <div className="empty">لا توجد حركة بعد</div>}<div className="row small muted mt"><span>■ إيرادات</span><span style={{ color: "var(--accent)" }}>■ مصروفات</span><span style={{ color: "var(--info)" }}>■ صافي الربح</span></div></div></div>
      </div>
      <div className="grid c3">
        <div className="card"><div className="card-h"><h3>الأصناف الأكثر مبيعاً (90 يوم)</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.topProducts.map((p: any) => <tr key={p.name}><td>{p.name}</td><td className="n">{Number(p.qty).toLocaleString()}</td><td className="n"><Money v={p.net} /></td></tr>)}{!d.topProducts.length && <tr><td className="muted">—</td></tr>}</tbody></table></div></div>
        <div className="card"><div className="card-h"><h3>أفضل العملاء (90 يوم)</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.topCustomers.map((p: any) => <tr key={p.name}><td>{p.name}</td><td className="n"><Money v={p.total} /></td></tr>)}{!d.topCustomers.length && <tr><td className="muted">—</td></tr>}</tbody></table></div></div>
        <div className="card"><div className="card-h"><h3>فواتير متأخرة السداد</h3><Link className="small" to="/reports/aging">أعمار الديون →</Link></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.overdue.map((o: any) => <tr key={o.number}><td>{o.name}<div className="small muted">{o.number} · استحقاق {fmtDate(o.dueDate)}</div></td><td className="n neg-val"><Money v={o.due} /></td></tr>)}{!d.overdue.length && <tr><td className="muted">لا توجد فواتير متأخرة 🎉</td></tr>}</tbody></table></div></div>
      </div>
      <div className="grid c2">
        <div className="card"><div className="card-h"><h3>آخر المستندات</h3></div><div className="table-wrap"><table className="tbl compact"><thead><tr><th>الرقم</th><th>النوع</th><th>الطرف</th><th>التاريخ</th><th className="n">الإجمالي</th><th>السداد</th></tr></thead><tbody>{d.recent.map((r: any) => <tr key={r.id}><td><Link to={`/doc/${r.id}`}>{r.number}</Link></td><td>{KIND_AR[r.kind]} {r.direction === "SALE" ? "بيع" : "شراء"}</td><td>{r.partnerName}</td><td>{fmtDate(r.date)}</td><td className="n"><Money v={r.total} /></td><td><Badge s={r.paymentStatus} /></td></tr>)}</tbody></table></div></div>
        <div className="grid">
          <div className="card"><div className="card-h"><h3>أصناف تحت حد إعادة الطلب</h3></div><div className="table-wrap"><table className="tbl compact"><tbody>{d.lowStock.map((p: any) => <tr key={p.sku}><td>{p.name} <span className="muted small">{p.sku}</span></td><td className="n">{Number(p.qty)} / {Number(p.reorderLevel)}</td></tr>)}{!d.lowStock.length && <tr><td className="muted">المخزون بخير</td></tr>}</tbody></table></div></div>
          {!!d.zatca.length && <div className="card"><div className="card-h"><h3>حالة الفوترة الإلكترونية</h3></div><div className="card-b row">{d.zatca.map((z: any) => <span key={z.s} className="row" style={{ gap: 6 }}><Badge s={z.s} map={ZATCA_AR} /><b>{z.c}</b></span>)}</div></div>}
        </div>
      </div>
    </div>
  );
}
