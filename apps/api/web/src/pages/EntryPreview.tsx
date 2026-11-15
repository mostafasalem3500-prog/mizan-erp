import React from "react";
import { Money } from "../lib";

/** The entry posting would create (from the …/preview-entry routes: posted inside a transaction that is rolled back). */
export function EntryPreview({ prev }: { prev: any }) {
  return <>
    <div className="alert info small mb">هذا ما سيُسجَّل عند الترحيل. لم يُرحَّل شيء بعد، ولم يتغير المخزون ولا الأرصدة.</div>
    <div className="table-wrap"><table className="tbl compact" data-preview><thead><tr><th>الحساب</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead><tbody>{prev.lines.map((l: any, i: number) => <tr key={i}><td>{l.code} {l.nameAr}{l.costCenter && <span className="badge gray" style={{ marginInlineStart: 6 }}>🏷 {l.costCenter}</span>}<div className="small muted">{l.description}</div></td><td className="n"><Money v={l.debit} blankZero /></td><td className="n"><Money v={l.credit} blankZero /></td></tr>)}</tbody>
      <tfoot><tr><th>الإجمالي {Math.abs(prev.debit - prev.credit) < 0.005 ? "— متوازن ✓" : ""}</th><th className="n"><Money v={prev.debit} /></th><th className="n"><Money v={prev.credit} /></th></tr></tfoot></table></div>
    {prev.costTotal > 0 && prev.direction === "SALE" && <div className="small muted mt">تكلفة البضاعة المباعة في هذه الفاتورة: <Money v={prev.costTotal} /> (بمتوسط التكلفة الحالي).</div>}
  </>;
}
