/** Automatic daily backups (every edition): list, take one now, download. */
import React from "react";
import { api, session, useFetch, Loading, Empty, Badge, useAction, useToast, fmtDate } from "../lib";

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export async function downloadAuth(url: string, name: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || "تعذّر التنزيل");
  const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function BackupsPage() {
  const { data, loading, reload } = useFetch<any>("/backups");
  const { run, busy } = useAction();
  const toast = useToast();
  return <div className="card"><div className="card-h"><h3>الحفظ اليومي — النسخ الاحتياطية</h3><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/backups", { body: {} }); reload(); }, "تم أخذ نسخة احتياطية الآن")}>💾 نسخة الآن</button></div>
    <div className="card-b"><div className="alert info small">يُحفظ كل يوم تلقائياً نسخة كاملة مضغوطة من بيانات المنشأة (كل الجداول؛ والمرفقات بفهرسها) إذا تغيّر فيها شيء، ويُحتفظ بآخر {data?.retention?.auto || 30} نسخة يومية و{data?.retention?.manual || 20} نسخة يدوية. التنزيل بصيغة JSON مضغوطة للمالك والمدير. ملفات المرفقات نفسها تُنزَّل من «الأرشيف اليومي» أو حزمة المراجع.</div></div>
    {loading && !data ? <Loading /> : !data?.rows?.length ? <Empty text="لا توجد نسخ بعد — تُؤخذ أول نسخة تلقائية خلال ساعة من أول حركة" /> : <div className="table-wrap"><table className="tbl">
      <thead><tr><th>اليوم</th><th>النوع</th><th className="n">الجداول</th><th className="n">السجلات</th><th className="n">الحجم</th><th>بواسطة</th><th /></tr></thead>
      <tbody>{data.rows.map((b: any) => <tr key={b.id}><td className="dt">{fmtDate(b.day)} <span className="muted small">{new Date(b.createdAt).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</span></td><td><Badge s={b.kind} map={{ AUTO: "تلقائي", MANUAL: "يدوي" }} /></td><td className="n num">{b.tables}</td><td className="n num">{Number(b.rows).toLocaleString("en")}</td><td className="n">{fmtSize(b.size)}</td><td className="small">{b.createdBy}</td>
        <td><button className="btn sm" onClick={() => downloadAuth(`/api/backups/${b.id}/download`, `mizan-backup-${String(b.day).slice(0, 10)}${b.kind === "MANUAL" ? "-manual" : ""}.json.gz`).catch((e) => toast(e.message, "err"))}>⬇ تنزيل</button></td></tr>)}</tbody></table></div>}
  </div>;
}
