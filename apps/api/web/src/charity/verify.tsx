/** Public page behind the QR on a printed donation receipt: shows the receipt as recorded (donor name partly hidden). */
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import "./charity.css";

const fmt = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function DonationVerify() {
  const { token } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { fetch(`/api/public/donation/${encodeURIComponent(token || "")}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message || "السند غير موجود"); setD(j); }).catch((e) => setErr(e.message)); }, [token]);
  return <div className="verify-page" dir="rtl"><div className="verify-card">
    <img src="/charity/logo.png" alt="" />
    {err ? <><h2 style={{ color: "#b42318" }}>✖ لم يُعثر على السند</h2><p>تأكد من الرمز أو تواصل مع الجمعية.</p></> : !d ? <p>جارٍ التحقق…</p> : <>
      <h2 style={{ margin: "8px 0" }}>{d.status === "POSTED" ? "✔ سند قبض صحيح" : "⚠ هذا السند ملغى"}</h2>
      <div style={{ color: "#66718a" }}>{d.association}{d.license ? ` — ترخيص رقم ${d.license}` : ""}</div>
      <table><tbody>
        <tr><td>رقم السند</td><td dir="ltr" style={{ textAlign: "end" }}>{d.number}</td></tr>
        <tr><td>التاريخ</td><td>{String(d.date).slice(0, 10)}</td></tr>
        <tr><td>المبلغ</td><td><b>{fmt(d.amount)} ريال</b></td></tr>
        <tr><td>المتبرع</td><td>{d.payer}</td></tr>
        <tr><td>نوع المبلغ</td><td>{d.source}</td></tr>
        {d.project && <tr><td>المشروع</td><td>{d.project}</td></tr>}
        <tr><td>الحالة</td><td>{d.status === "POSTED" ? "مرحّل في دفاتر الجمعية" : "ملغى"}</td></tr>
      </tbody></table>
      <p style={{ fontSize: 13, color: "#66718a", marginTop: 14 }}>جزاكم الله خيراً وتقبّل منكم.</p>
    </>}
  </div></div>;
}
