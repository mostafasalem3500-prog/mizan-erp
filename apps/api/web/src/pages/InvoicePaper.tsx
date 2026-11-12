/** One invoice drawn with a print template: a sheet (A4 / A5) or a roll receipt (80mm / 58mm). */
import React from "react";
import { CUR, CFG } from "../shared/country";
import { amountToArabicWords } from "../shared/tafqeet";
import { money, fmtDate, fmtDT, METHOD_AR } from "../lib";
import { Tpl, TplOpts, lbl, enOf, isRoll } from "../shared/printTemplates";

const ID_AR: Record<string, string> = { CRN: "السجل التجاري", NAT: "الهوية الوطنية", IQA: "الإقامة", "700": "الرقم الموحد", PAS: "جواز السفر", GCC: "هوية خليجية" };
const FS: Record<string, number> = { S: 11.5, M: 13, L: 14.5 };
const pageCss = (o: TplOpts) => (o.size === "A5" ? "@page{size:A5;margin:8mm}" : o.size === "A4" ? "@page{size:A4;margin:12mm}" : `@page{size:${o.size === "T58" ? "58mm" : "80mm"} auto;margin:0}`);

export function InvoicePaper({ d, qr, tpl, docTitle }: { d: any; qr: string; tpl: Tpl; docTitle: string }) {
  const o = tpl.opts;
  if (isRoll(o.size)) return <RollPaper d={d} qr={qr} tpl={tpl} docTitle={docTitle} />;
  const isSale = d.direction === "SALE", c = d.company || {};
  const remaining = Number(d.total) - Number(d.amountPaid);
  const showVat = o.colTax && d.lines.some((l: any) => Number(l.vatAmount) > 0);
  const hasDisc = o.colDiscount && d.lines.some((l: any) => Number(l.discountPct));
  const fc = d.currency && d.currency !== CFG.currency;
  const fx = (v: any) => money(Number(v) / Number(d.exchangeRate || 1));
  const L = (ar: string) => lbl(o, ar);
  const title = o.title || docTitle, titleEn = o.english ? enOf(docTitle) : "";
  const meta: [string, React.ReactNode][] = [[L("الرقم"), <b className="num">{d.number}</b>], [L("التاريخ"), <span className="num">{fmtDate(d.date)} {d.issuedAt ? new Date(d.issuedAt).toTimeString().slice(0, 5) : ""}</span>]];
  if (d.dueDate && d.kind === "INVOICE") meta.push([L("الاستحقاق"), <span className="num">{fmtDate(d.dueDate)}</span>]);
  if (d.origin) meta.push(["مرجع الفاتورة", <span className="num">{d.origin.number}</span>]);
  if (d.supplierRef) meta.push(["فاتورة المورد", <span className="num">{d.supplierRef}</span>]);
  if (d.branchName && !d.branchIsMain) meta.push(["الفرع", <>{d.branchName}{d.branchPhone ? <span className="num"> · {d.branchPhone}</span> : ""}</>]);
  if ((d.channel === "SALLA" || d.channel === "ZID") && d.externalRef) meta.push([d.channel === "ZID" ? "طلب زد" : "طلب سلة", <span className="num">{d.externalRef.replace(/^(salla|zid):/, "#")}</span>]);
  if (fc) meta.push(["العملة", <span className="num">{d.currency} — سعر الصرف {Number(d.exchangeRate)}</span>]);
  const p = d.partner;
  const company = o.style !== "letterhead" && (
    <div className={"tp-co pos-" + o.logoPos}>
      {o.logo && c.logo && <img src={c.logo} style={{ height: o.logoSize }} alt="" />}
      <h2>{c.nameAr}</h2>{c.nameEn && <div className="muted">{c.nameEn}</div>}
      {o.companyAddress && <div className="small">{[c.buildingNo, c.street, c.district, c.city, c.postalCode].filter(Boolean).join("، ")}</div>}
      <div className="small">{c.vatNumber && <>{CFG.taxIdLabel}: <span className="num">{c.vatNumber}</span></>}{o.companyCr && c.crNumber && <> · س.ت: <span className="num">{c.crNumber}</span></>}</div>
      {o.companyContact && <div className="small">{c.phone && <>هاتف: <span className="num">{c.phone}</span></>}{c.email && <> · {c.email}</>}</div>}
    </div>);
  return (
    <div className={`card print-doc tp tp-${o.style} tp-${o.size} tp-b-${o.borders}${o.striped ? " tp-striped" : ""}`} style={{ ["--tp" as any]: o.accent, fontSize: FS[o.font] * (o.size === "A5" ? 0.92 : 1), paddingTop: o.topMargin ? `${o.topMargin}mm` : undefined }} data-tpl={tpl.id}>
      <style>{pageCss(o)}</style>
      {o.watermark && d.status === "DRAFT" && <div className="tp-wm" aria-hidden>مسودة</div>}
      <div className="head">
        {company}
        <div className="tp-title" style={{ textAlign: "start" }}>
          <h2 style={{ color: "var(--tp)" }}>{title}</h2>{titleEn && !o.title && <div className="tp-en">{titleEn}</div>}
          <table style={{ border: "none", marginTop: 6 }}><tbody>{meta.map(([k, v], i) => <tr key={i}><td style={{ border: "none" }} className="muted">{k}</td><td style={{ border: "none" }}>{v}</td></tr>)}</tbody></table>
        </div>
        {qr && <div style={{ textAlign: "center" }}><img src={qr} alt="QR" style={{ width: o.size === "A5" ? 92 : 120, height: o.size === "A5" ? 92 : 120 }} />{d.etaUuid && <div className="small num" dir="ltr" style={{ fontSize: 9, maxWidth: 140, wordBreak: "break-all" }}>{d.etaUuid}</div>}</div>}
      </div>
      {o.headerNote && <div className="tp-note">{o.headerNote}</div>}
      <div className="grid c2 mb tp-party">
        <div><div className="muted small">{L(isSale ? "العميل" : "المورد")}</div><b>{d.partnerName}</b>{p && <div className="small">
          {o.customerAddress && [p.buildingNo && `مبنى ${p.buildingNo}`, p.street, p.district, p.city, p.postalCode, p.additionalNo && `إضافي ${p.additionalNo}`].filter(Boolean).join("، ")}
          {p.vatNumber ? <div>{L("الرقم الضريبي")}: <span className="num">{p.vatNumber}</span></div> : (p.idType && p.idType !== "CRN" ? p.idNumber : p.crNumber) ? <div>{ID_AR[p.idType || "CRN"] || "رقم الهوية"}: <span className="num">{p.idType && p.idType !== "CRN" ? p.idNumber : p.crNumber}</span></div> : null}
          {p.vatNumber && p.crNumber && <div>{L("السجل التجاري")}: <span className="num">{p.crNumber}</span></div>}
          {o.customerContact && (p.phone || p.email) && <div>{p.phone && <span className="num">{p.phone}</span>}{p.phone && p.email && " · "}{p.email && <span dir="ltr">{p.email}</span>}</div>}
        </div>}</div>
        {d.reason && <div><div className="muted small">سبب الإشعار</div>{d.reason}</div>}
      </div>
      <table className="tp-lines"><thead><tr><th>#</th><th>{L("البيان")}</th><th>{L("الكمية")}</th><th>{L("سعر الوحدة")}</th>{hasDisc && <th>{L("خصم")}</th>}<th>{L("المبلغ قبل الضريبة")}</th>{showVat && <><th>{L("الضريبة")}</th><th>{L("الإجمالي")}</th></>}</tr></thead>
        <tbody>{d.lines.map((l: any, i: number) => <tr key={l.id}><td className="num">{i + 1}</td><td>{l.description}{o.colSku && l.sku && <span className="muted small num" style={{ marginInlineStart: 4 }}>{l.sku}</span>}</td>
          <td className="num">{Number(l.qty)}{o.colUnit ? ` ${l.uom || l.unit || ""}` : ""}{o.colUnit && l.uom && Number(l.factor) > 1 ? <span className="small muted"> (= {Number(l.qty) * Number(l.factor)} {l.unit})</span> : null}</td>
          <td className="num">{fc ? <>{money(l.fcUnitPrice ?? Number(l.unitPrice) / Number(d.exchangeRate))} {d.currency}<div className="small muted">{money(l.unitPrice)} {CUR()}</div></> : money(l.unitPrice)}</td>
          {hasDisc && <td className="num">{Number(l.discountPct) ? `${Number(l.discountPct)}%` : ""}</td>}
          <td className="num">{money(l.netAmount)}</td>{showVat && <><td className="num">{money(l.vatAmount)}</td><td className="num">{money(l.total)}</td></>}</tr>)}</tbody>
      </table>
      <div className="row mt tp-foot" style={{ alignItems: "flex-start", justifyContent: "space-between" }}>
        <div className="small muted" style={{ maxWidth: 380 }}>
          {o.notes && d.notes && <div>{L("ملاحظات")}: {d.notes}</div>}
          {o.terms && (o.termsText || c.invoiceTerms) && <div style={{ whiteSpace: "pre-wrap" }}>{o.termsText || c.invoiceTerms}</div>}
          {d.tenders?.length > 0 && <div>طريقة الدفع: {d.tenders.map((t: any) => `${METHOD_AR[t.method] || t.method} ${money(t.amount)}`).join(" + ")}</div>}
          {o.bank && o.bankText && <div className="tp-bank"><b>{L("بيانات التحويل البنكي")}</b><div style={{ whiteSpace: "pre-wrap" }} dir="auto">{o.bankText}</div></div>}
        </div>
        <table className="tp-totals" style={{ width: o.size === "A5" ? 230 : 300 }}><tbody>
          <tr><td>{L("الإجمالي قبل الخصم")}</td><td className="num">{money(d.subtotal)}</td></tr>
          {Number(d.discountTotal) > 0 && <tr><td>{L("الخصم")}</td><td className="num">{money(d.discountTotal)}</td></tr>}
          <tr><td>{L("الإجمالي الخاضع للضريبة")}</td><td className="num">{money(d.taxable)}</td></tr>
          <tr><td>{L("ضريبة القيمة المضافة")} {CFG.vatRate}%</td><td className="num">{money(d.vatTotal)}</td></tr>
          {Number(d.customsVat) > 0 && <tr><td className="small">منها ضريبة استيراد تُسدد للجمارك (لا تُدفع للمورد)</td><td className="num">−{money(d.customsVat)}</td></tr>}
          <tr className="tp-grand" style={{ fontWeight: 700, fontSize: "1.15em" }}><td>{Number(d.customsVat) > 0 ? "المستحق للمورد" : L("الإجمالي شامل الضريبة")}</td><td className="num">{money(d.total)} {CUR()}</td></tr>
          {fc && <tr style={{ fontWeight: 700 }}><td>الإجمالي بعملة المستند</td><td className="num">{money(d.fcTotal ?? fx(d.total))} {d.currency}</td></tr>}
          {o.words && <tr><td colSpan={2} className="small" style={{ background: "#f8fafa" }}>{amountToArabicWords(Number(d.total))}</td></tr>}
          {o.paid && d.kind === "INVOICE" && d.status === "POSTED" && Number(d.amountPaid) > 0 && <><tr><td>{L("المسدد")}</td><td className="num">{money(d.amountPaid)}</td></tr><tr><td>{L("المتبقي")}</td><td className="num">{money(remaining)}</td></tr></>}
        </tbody></table>
      </div>
      {o.signatures && <div className="tp-sign"><div><span>{o.sign1 || "المستلم"}</span></div><div><span>{o.sign2 || "المحاسب"}</span></div></div>}
      {o.footer && (o.footerText || c.invoiceFooter) && <div className="small muted mt tp-footer" style={{ textAlign: "center", borderTop: "1px solid #ddd", paddingTop: 8, whiteSpace: "pre-wrap" }}>{o.footerText || c.invoiceFooter}</div>}
    </div>
  );
}

function RollPaper({ d, qr, tpl, docTitle }: { d: any; qr: string; tpl: Tpl; docTitle: string }) {
  const o = tpl.opts, c = d.company || {}, narrow = o.size === "T58";
  const fs = (narrow ? 10.5 : 12) * (o.font === "S" ? 0.92 : o.font === "L" ? 1.15 : 1);
  return (
    <div className={"thermal card tp-roll" + (narrow ? " t58" : "")} style={{ fontSize: fs, width: narrow ? "58mm" : "80mm" }} data-tpl={tpl.id}>
      <style>{pageCss(o)}</style>
      <div className="c">{o.logo && c.logo && <img src={c.logo} style={{ height: Math.min(o.logoSize, narrow ? 34 : 60) }} alt="" />}<div style={{ fontWeight: 700, fontSize: "1.15em" }}>{c.nameAr}</div>{c.nameEn && <div>{c.nameEn}</div>}{o.companyAddress && <div>{[c.street, c.city].filter(Boolean).join("، ")}</div>}{o.companyContact && c.phone && <div className="num">{c.phone}</div>}{c.vatNumber && <div>الرقم الضريبي: <span className="num">{c.vatNumber}</span></div>}{o.companyCr && c.crNumber && <div>س.ت: <span className="num">{c.crNumber}</span></div>}</div>
      <div className="c" style={{ margin: "6px 0", fontWeight: 700 }}>{o.title || docTitle}{d.kind === "CREDIT_NOTE" ? " — إشعار دائن" : ""}</div>
      {o.headerNote && <div className="c">{o.headerNote}</div>}
      <div>رقم: <span className="num">{d.number}</span></div>
      <div>التاريخ: <span className="num">{fmtDT(d.issuedAt)}</span></div>
      {d.partnerName && d.partnerName !== "عميل نقدي" && <div>العميل: {d.partnerName}{o.customerContact && d.partner?.phone ? <span className="num"> · {d.partner.phone}</span> : ""}</div>}
      {(d.tableName || d.orderNo) && <div>{d.tableName ? <>الطاولة: <b>{d.tableName}</b> · </> : ""}طلب #{d.orderNo}{d.orderType ? ` · ${({ DINE_IN: "محلي", TAKEAWAY: "سفري", DELIVERY: "توصيل" } as any)[d.orderType] || ""}` : ""}</div>}
      {o.cashier && d.createdBy && <div>الكاشير: {d.createdBy}</div>}
      <table style={{ marginTop: 6 }}><thead><tr><th style={{ textAlign: "start" }}>الصنف</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
        <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.description}{l.uom && <span style={{ fontSize: "0.82em" }}> ({l.uom})</span>}{o.colSku && l.sku && !narrow && <span className="num" style={{ fontSize: "0.82em" }}> {l.sku}</span>}{o.unitPrice && <div style={{ fontSize: "0.82em" }} className="num">{money(l.unitPrice)} × {Number(l.qty)}{o.colTax && !narrow && Number(l.vatAmount) > 0 ? ` · ضريبة ${money(l.vatAmount)}` : ""}</div>}</td><td className="c num">{Number(l.qty)}</td><td className="c num">{money(l.total)}</td></tr>)}</tbody></table>
      <div style={{ marginTop: 6 }}>
        <div className="row between"><span>الإجمالي قبل الضريبة</span><span className="num">{money(d.taxable)}</span></div>
        {Number(d.discountTotal) > 0 && <div className="row between"><span>الخصم</span><span className="num">{money(d.discountTotal)}</span></div>}
        <div className="row between"><span>ضريبة القيمة المضافة {CFG.vatRate}%</span><span className="num">{money(d.vatTotal)}</span></div>
        <div className="row between" style={{ fontWeight: 700, fontSize: "1.25em", borderTop: "1px solid #000", paddingTop: 3 }}><span>الإجمالي</span><span className="num">{money(d.total)} {CUR()}</span></div>
        {d.tenders?.map((t: any, i: number) => <div key={i} className="row between"><span>{METHOD_AR[t.method] || t.method}</span><span className="num">{money(t.amount)}</span></div>)}
        {Number(d.pointsRedeemed) > 0 && <div className="row between"><span>⭐ استبدال {Number(d.pointsRedeemed)} نقطة ولاء</span><span className="num">{money(d.pointsValue)}</span></div>}
        {d.lines?.some((l: any) => Number(l.promoDiscount) > 0) && <div className="c" style={{ marginTop: 4, fontWeight: 700 }}>🎁 وفّرت مع العروض: <span className="num">{money(d.lines.reduce((a: number, l: any) => a + Number(l.promoDiscount || 0), 0))}</span> {CUR()}</div>}
      </div>
      {o.notes && d.notes && <div style={{ marginTop: 4 }}>ملاحظات: {d.notes}</div>}
      {qr && <div className="c" style={{ marginTop: 8 }}><img src={qr} style={{ width: narrow ? 92 : 110 }} alt="QR" /></div>}
      {o.footer && (o.footerText || c.invoiceFooter) && <div className="c" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{o.footerText || c.invoiceFooter}</div>}
      {o.thanks && <div className="c" style={{ marginTop: 4, fontSize: "0.85em" }}>{o.thanks}</div>}
    </div>
  );
}
