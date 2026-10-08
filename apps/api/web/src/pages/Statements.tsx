/** Account statements used across the app: partner (customer/supplier) statement and general-ledger account statement. */
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { q, useFetch, Money, money, Loading, Modal, Select, Picker, partnerFetcher, ExportBtn, PrintBtn, DateRange, today, fmtDate, JTYPE_AR, useCompanyContext, matches, SearchBox, sourceLink } from "../lib";
import { PortalLinkBtn } from "./Integrations";

const KIND_SHORT: Record<string, string> = { INVOICE: "فاتورة", CREDIT_NOTE: "إشعار دائن", DEBIT_NOTE: "إشعار مدين" };

function Ref({ r, onNav }: { r: any; onNav: () => void }) {
  const to = sourceLink(r);
  const label = r.srcNumber || r.docNumber || r.reference || r.number;
  return to ? <Link className="ref-link" to={to} onClick={onNav}>{label}</Link> : <span>{label}</span>;
}

function useBranches() {
  const br = useFetch<any[]>("/branches");
  return (br.data || []).filter((b: any) => b.isActive !== false);
}

function PrintHead({ title, sub, lines }: { title: string; sub: string; lines?: React.ReactNode }) {
  const { me } = useCompanyContext();
  return (
    <div className="print-only" style={{ marginBottom: 10 }}>
      <div className="row between"><div><h2 style={{ margin: 0 }}>{me.company.nameAr}</h2>{me.company.vatNumber && <div className="small">الرقم الضريبي: {me.company.vatNumber}</div>}</div><div style={{ textAlign: "end" }}><h2 style={{ margin: 0 }}>{title}</h2><div className="small">{sub}</div></div></div>
      {lines}
      <hr />
    </div>
  );
}

// ─── customer / supplier statement ─────────────────────────────────────────
export function PartnerStatement({ partner, role, onClose, from: f0, to: t0 }: { partner: any; role: string; onClose: () => void; from?: string; to?: string }) {
  const [from, setFrom] = useState(f0 || today().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(t0 || today());
  const [branchId, setBranchId] = useState("");
  const [detail, setDetail] = useState(false);
  const [tab, setTab] = useState<"moves" | "open">("moves");
  const [text, setText] = useState("");
  const branches = useBranches();
  const { data } = useFetch(`/reports/statement/${partner.id}${q({ role, from, to, branchId, detail: detail ? 1 : undefined })}`);
  const isCust = role === "CUSTOMER";
  const rows = useMemo(() => (data?.rows || []).filter((r: any) => matches(r, text, ["number", "srcNumber", "memo", "reference", "branchName", (x) => JTYPE_AR[x.type]])), [data, text]);
  const p = data?.partner || partner;
  const credit = Number(p.creditLimit || 0);
  return (
    <Modal wide title={`كشف حساب ${isCust ? "عميل" : "مورد"}: ${partner.name}`} onClose={onClose} footer={<>
      {isCust && <PortalLinkBtn partner={partner} />}<div className="grow" /><PrintBtn />
      {data && <ExportBtn name={`كشف حساب ${partner.name}`} rows={() => [{ التاريخ: "", المرجع: "", البيان: "رصيد أول المدة", مدين: "", دائن: "", الرصيد: data.opening }, ...data.rows.map((r: any) => ({ التاريخ: r.date, المرجع: r.srcNumber || r.reference || r.number, "رقم القيد": r.number, النوع: JTYPE_AR[r.type], البيان: r.memo, الفرع: r.branchName || "", مدين: r.debit, دائن: r.credit, الرصيد: r.balance })), { التاريخ: "", المرجع: "", البيان: "رصيد آخر المدة", مدين: data.totalDebit, دائن: data.totalCredit, الرصيد: data.closing }]} />}
      <button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="no-print mb grid" style={{ gap: 8 }}>
        <div className="toolbar" style={{ margin: 0 }}>
          <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          {branches.length > 1 && <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">كل الفروع</option>{branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
        </div>
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="chip-toggle"><button className={tab === "moves" ? "on" : ""} onClick={() => setTab("moves")}>الحركات</button><button className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>المستندات المفتوحة {data?.open?.length ? `(${data.open.length})` : ""}</button></div>
          {tab === "moves" && <><SearchBox value={text} onChange={setText} placeholder="بحث في الحركات" /><label className="check"><input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} /> كشف تفصيلي (أصناف الفواتير)</label></>}
        </div>
      </div>
      {!data ? <Loading /> : (
        <div className="print-doc stmt" style={{ padding: 0 }}>
          <PrintHead title={`كشف حساب ${isCust ? "عميل" : "مورد"}`} sub={`من ${from} إلى ${to}`} lines={<div className="small" style={{ marginTop: 6 }}><b>{p.name}</b>{p.code && <> · {p.code}</>}{p.vatNumber && <> · الرقم الضريبي {p.vatNumber}</>}{p.phone && <> · {p.phone}</>}</div>} />
          <div className="stmt-summary">
            <div className="box"><span>رصيد أول المدة</span><b className="num"><Money v={data.opening} /></b></div>
            <div className="box"><span>{isCust ? "مدين (فواتير)" : "مدين (سداد/مرتجع)"}</span><b className="num"><Money v={data.totalDebit} /></b></div>
            <div className="box"><span>{isCust ? "دائن (تحصيل/مرتجع)" : "دائن (فواتير)"}</span><b className="num"><Money v={data.totalCredit} /></b></div>
            <div className="box"><span>رصيد آخر المدة {isCust ? "(على العميل)" : "(للمورد)"}</span><b className="num"><Money v={data.closing} /></b></div>
            <div className={"box" + (data.overdue > 0 ? " warn" : "")}><span>متأخر السداد</span><b className="num"><Money v={data.overdue} /></b></div>
            {isCust && credit > 0 && <div className={"box" + (data.closing > credit ? " warn" : "")}><span>حد الائتمان / المتاح</span><b className="num">{money(credit)} / {money(credit - data.closing)}</b></div>}
          </div>
          {tab === "moves" ? (
            <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>المرجع</th><th>النوع</th><th>البيان</th>{branches.length > 1 && <th>الفرع</th>}<th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
              <tbody>
                <tr className="group"><td colSpan={branches.length > 1 ? 7 : 6}>رصيد أول المدة</td><td className="n"><Money v={data.opening} /></td></tr>
                {rows.map((r: any, i: number) => <React.Fragment key={i}>
                  <tr><td className="dt">{fmtDate(r.date)}</td><td><Ref r={r} onNav={onClose} /><div className="small muted">{r.number}</div></td><td className="small">{r.docKind ? KIND_SHORT[r.docKind] : JTYPE_AR[r.type]}</td><td>{r.memo}{r.dueDate && Number(r.debit) > 0 && <div className="small muted">الاستحقاق {fmtDate(r.dueDate)}</div>}</td>{branches.length > 1 && <td className="small">{r.branchName}</td>}<td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td className="n"><Money v={r.balance} /></td></tr>
                  {detail && r.items?.length > 0 && <tr className="items-row"><td /><td colSpan={branches.length > 1 ? 7 : 6}>{r.items.map((it: any, j: number) => <div key={j} className="row between"><span>{it.description}</span><span className="num">{Number(it.qty)} × {money(it.unitPrice)}{Number(it.discountPct) ? ` − ${Number(it.discountPct)}%` : ""} = {money(it.total)}</span></div>)}</td></tr>}
                </React.Fragment>)}
                {!rows.length && <tr><td colSpan={8} className="muted">لا توجد حركات في الفترة{text ? " مطابقة للبحث" : ""}</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={branches.length > 1 ? 5 : 4}>الإجمالي ورصيد آخر المدة {isCust ? "(مستحق على العميل)" : "(مستحق للمورد)"}</td><td className="n"><Money v={data.totalDebit} /></td><td className="n"><Money v={data.totalCredit} /></td><td className="n"><Money v={data.closing} /></td></tr></tfoot>
            </table></div>
          ) : (
            <>
              <div className="stmt-summary">{[["current", "غير مستحق"], ["d30", "1–30 يوم"], ["d60", "31–60"], ["d90", "61–90"], ["d120", "أكثر من 90"]].map(([k, l]) => <div key={k} className={"box" + (k !== "current" && data.ageing[k] > 0 ? " warn" : "")}><span>{l}</span><b className="num"><Money v={data.ageing[k]} /></b></div>)}</div>
              <div className="table-wrap"><table className="tbl compact"><thead><tr><th>المستند</th><th>التاريخ</th><th>الاستحقاق</th><th className="n">أيام التأخير</th><th className="n">الإجمالي</th><th className="n">المسدد</th><th className="n">المتبقي</th></tr></thead>
                <tbody>{data.open.map((o: any) => <tr key={o.id}><td><Link className="ref-link" to={`/doc/${o.id}`} onClick={onClose}>{o.number}</Link></td><td className="dt">{fmtDate(o.date)}</td><td className="dt">{fmtDate(o.dueDate)}</td><td className={"n " + (Number(o.days) > 0 ? "neg-val" : "")}>{Number(o.days) > 0 ? Number(o.days) : "—"}</td><td className="n"><Money v={o.total} /></td><td className="n"><Money v={o.amountPaid} /></td><td className="n"><b><Money v={o.due} /></b></td></tr>)}
                  {!data.open.length && <tr><td colSpan={7} className="muted">لا توجد مستندات مفتوحة ✓</td></tr>}</tbody>
                <tfoot><tr><td colSpan={6}>إجمالي المفتوح</td><td className="n"><Money v={data.open.reduce((a: number, o: any) => a + Number(o.due), 0)} /></td></tr></tfoot></table></div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── account statement (general ledger) ────────────────────────────────────
export function AccountLedger({ account, onClose, partner: initialPartner, branchId: initialBranch, from: f0, to: t0 }: { account: any; onClose: () => void; partner?: any; branchId?: string; from?: string; to?: string }) {
  const [from, setFrom] = useState(f0 || today().slice(0, 4) + "-01-01");
  const [to, setTo] = useState(t0 || today());
  const [branchId, setBranchId] = useState(initialBranch || "");
  const [partner, setPartner] = useState<any>(initialPartner || null);
  const [cc, setCc] = useState("");
  const [text, setText] = useState("");
  const branches = useBranches();
  const ccs = useFetch<any[]>("/cost-centers");
  const sub = account.systemKey === "AR" || account.systemKey === "AP";
  const { data } = useFetch(`/reports/ledger${q({ accountId: account.id, from, to, branchId, partnerId: partner?.id, costCenterId: cc })}`);
  const rows = useMemo(() => (data?.rows || []).filter((r: any) => matches(r, text, ["number", "srcNumber", "memo", "description", "partnerName", "reference", "branchName", (x) => JTYPE_AR[x.type]])), [data, text]);
  const multi = branches.length > 1;
  return (
    <Modal wide title={`كشف حساب: ${account.code} ${account.nameAr}`} onClose={onClose} footer={<><div className="grow" /><PrintBtn />{data && <ExportBtn name={`كشف حساب ${account.code}`} rows={() => [{ التاريخ: "", القيد: "", البيان: "رصيد أول المدة", مدين: "", دائن: "", الرصيد: data.opening }, ...data.rows.map((r: any) => ({ التاريخ: r.date, القيد: r.number, المرجع: r.srcNumber || r.reference || "", النوع: JTYPE_AR[r.type], البيان: r.description || r.memo, الطرف: r.partnerName || "", الفرع: r.branchName || "", "مركز التكلفة": r.costCenterName || "", مدين: r.debit, دائن: r.credit, الرصيد: r.balance })), { التاريخ: "", القيد: "", البيان: "الإجمالي / رصيد آخر المدة", مدين: data.totalDebit, دائن: data.totalCredit, الرصيد: data.closing }]} />}<button className="btn" onClick={onClose}>إغلاق</button></>}>
      <div className="no-print mb grid" style={{ gap: 8 }}>
        <div className="toolbar" style={{ margin: 0 }}><DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} /></div>
        <div className="toolbar" style={{ margin: 0 }}>
          <SearchBox value={text} onChange={setText} placeholder="بحث في الحركات" />
          {multi && <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">كل الفروع</option>{branches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
          {(ccs.data?.length || 0) > 0 && <Select value={cc} onChange={(e) => setCc(e.target.value)}><option value="">كل مراكز التكلفة</option>{ccs.data!.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          {sub && <div style={{ minWidth: 240 }}><Picker value={partner} onChange={setPartner} fetcher={partnerFetcher(account.systemKey === "AR" ? "CUSTOMER" : "SUPPLIER")} label={(p: any) => p.name} placeholder={account.systemKey === "AR" ? "كل العملاء" : "كل الموردين"} /></div>}
        </div>
      </div>
      {!data ? <Loading /> : (
        <div className="print-doc stmt" style={{ padding: 0 }}>
          <PrintHead title="كشف حساب" sub={`${account.code} ${account.nameAr} — من ${from} إلى ${to}`} lines={partner ? <div className="small">الطرف: {partner.name}</div> : undefined} />
          <div className="stmt-summary">
            <div className="box"><span>رصيد أول المدة</span><b className="num"><Money v={data.opening} sign /></b></div>
            <div className="box"><span>إجمالي المدين</span><b className="num"><Money v={data.totalDebit} /></b></div>
            <div className="box"><span>إجمالي الدائن</span><b className="num"><Money v={data.totalCredit} /></b></div>
            <div className="box"><span>رصيد آخر المدة</span><b className="num"><Money v={data.closing} sign /></b></div>
            <div className="box"><span>عدد الحركات</span><b className="num">{data.rows.length}</b></div>
          </div>
          <div className="table-wrap"><table className="tbl compact"><thead><tr><th>التاريخ</th><th>القيد / المرجع</th><th>النوع</th><th>البيان</th><th>الطرف</th>{multi && <th>الفرع</th>}<th className="n">مدين</th><th className="n">دائن</th><th className="n">الرصيد</th></tr></thead>
            <tbody><tr className="group"><td colSpan={multi ? 8 : 7}>رصيد أول المدة</td><td className="n"><Money v={data.opening} sign /></td></tr>
              {rows.map((r: any, i: number) => <tr key={i}><td className="dt">{fmtDate(r.date)}</td><td><b>{r.number}</b>{(r.srcNumber || r.sourceType === "INVOICE") && <div className="small"><Ref r={r} onNav={onClose} /></div>}</td><td className="small">{JTYPE_AR[r.type]}</td><td>{r.description || r.memo}{r.costCenterName && <div className="small muted">م.ت: {r.costCenterName}</div>}</td><td>{r.partnerName}</td>{multi && <td className="small">{r.branchName}</td>}<td className="n"><Money v={r.debit} blankZero /></td><td className="n"><Money v={r.credit} blankZero /></td><td className="n"><Money v={r.balance} sign /></td></tr>)}
              {!rows.length && <tr><td colSpan={9} className="muted">لا توجد حركات{text ? " مطابقة للبحث" : " في الفترة"}</td></tr>}
            </tbody>
            <tfoot><tr><td colSpan={multi ? 6 : 5}>الإجمالي / رصيد آخر المدة</td><td className="n"><Money v={data.totalDebit} /></td><td className="n"><Money v={data.totalCredit} /></td><td className="n"><Money v={data.closing} sign /></td></tr></tfoot></table></div>
        </div>
      )}
    </Modal>
  );
}

/** Button + account picker that opens the statement of a cash/bank (or any filtered) account. */
export function AccountStatementButton({ label = "📄 كشف حساب", filter, title }: { label?: string; filter: (a: any) => boolean; title?: string }) {
  const [open, setOpen] = useState(false);
  const [acc, setAcc] = useState<any>(null);
  const { data } = useFetch(open ? "/accounts" : null);
  const list = (data?.rows || []).filter((a: any) => !a.isGroup && a.isActive && filter(a));
  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>{label}</button>
      {open && !acc && (
        <Modal narrow title={title || "اختر الحساب"} onClose={() => setOpen(false)}>
          {!data ? <Loading /> : !list.length ? <div className="muted">لا توجد حسابات</div> : <div className="grid" style={{ gap: 6 }}>{list.map((a: any) => <button key={a.id} className="btn" style={{ justifyContent: "space-between" }} onClick={() => setAcc(a)}><span><span className="num muted">{a.code}</span> {a.nameAr}</span><Money v={a.balance} sign /></button>)}</div>}
        </Modal>
      )}
      {acc && <AccountLedger account={acc} onClose={() => { setAcc(null); setOpen(false); }} />}
    </>
  );
}
