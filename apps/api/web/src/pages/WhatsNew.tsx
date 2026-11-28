/** «ما الجديد»: what each recent release added, in plain words, each with the screen it lives on. */
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { useCompanyContext } from "../lib";
import { CFG } from "../shared/country";

type Rel = { v: string; date: string; title: string; items: { text: string; to?: string; perm?: string; sa?: boolean }[] };
export const RELEASES: Rel[] = [
  { v: "3.59.0", date: "2026-11-28", title: "صفحة «ما الجديد»", items: [
    { text: "هذه الصفحة: ما أضافه كل إصدار مع رابط شاشته. تُفتح من رقم الإصدار أسفل القائمة، وتظهر نقطة بجانبه عند وجود إصدار لم تطّلع عليه." }] },
  { v: "3.58.0", date: "2026-11-28", title: "نقطة البيع والأصناف التي تُباع بخلطتها", items: [
    { text: "الصنف الذي تعتمد خلطته على إنتاج مسبق يعرض على بطاقته «باقي كذا» و«نفد».", to: "/pos", perm: "pos.use" },
    { text: "الصنف الذي له خلطة يُباع من نقطة البيع بلا تحذير رصيد." }] },
  { v: "3.57.0", date: "2026-11-28", title: "تنبيهات لكل قسم وآخر سعر مع الطرف", items: [
    { text: "تنبيهات: أمر تصنيع متأخر، عقد تأجير انتهى أو يقترب، تجربة اشتراك تنتهي، فترة تجربة موظف تنتهي، أصل لم يُهلك، سطور كشف بنك بلا مطابقة.", to: "/" },
    { text: "في الفاتورة: آخر سعر بيع لهذا العميل وآخر سعر شراء من هذا المورد تحت السعر.", to: "/sales/invoices", perm: "sales.read" },
    { text: "مركز التقارير: الهالك من الإنتاج المسبق، الطبخات ونسبة الناتج، الأصناف حسب التصنيف.", to: "/reports-center?m=resto", perm: "reports.read" }] },
  { v: "3.56.0", date: "2026-11-28", title: "تصنيف جماعي وسجل الهالك", items: [
    { text: "تصنيف عدة أصناف دفعة واحدة من قائمة الأصناف («تصنيف المحدد»).", to: "/products", perm: "products.read" },
    { text: "إقفال اليوم: إدخال الإنتاج من التبويب نفسه، وجدول الهالك في آخر 30 يوماً بنسبته من الإنتاج.", to: "/recipes?tab=close", perm: "inventory.read" }] },
  { v: "3.55.0", date: "2026-11-28", title: "تصنيف الأصناف والخلطات والإنتاج المسبق", items: [
    { text: "بطاقة الصنف: استخدامه في المشتريات (مخزني، خدمي، مكوِّن) وتصنيفه في البيع (مخزني، له خلطة، خدمي، لا يُباع).", to: "/products", perm: "products.read" },
    { text: "خلطة تُخصم مكوناتها بنِسبها عند البيع، أو إنتاج مسبق بحد أدنى للتشغيل يسحب منه البيع ويُهلك المتبقي آخر اليوم.", to: "/recipes?tab=preps", perm: "products.read" }] },
  { v: "3.54.0", date: "2026-11-26", title: "تبويب الأنشطة المتخصصة", items: [
    { text: "القائمة في تبويبين: الأساسي، والأنشطة (مطاعم، تصنيع، تأجير، اشتراكات).", to: "/sectors" },
    { text: "تقارير جديدة للموارد البشرية والتصنيع والتأجير والاشتراكات في مركز التقارير.", to: "/reports-center", perm: "reports.read" }] },
  { v: "3.53.0", date: "2026-11-25", title: "بوابة الموظف وصلاحيات الموارد البشرية", items: [
    { text: "رابط خاص لكل موظف يرى منه قسائم راتبه ويطلب إجازته، ودور «موارد بشرية» مستقل.", to: "/hr", perm: "hr.read" }] },
  { v: "3.52.0", date: "2026-11-25", title: "الموارد البشرية والرواتب", items: [
    { text: "ملف الموظف، أنواع الإجازات وطلباتها، الوثائق وانتهاؤها، تعديلات الراتب، واعتماد المسير قبل ترحيله.", to: "/hr", perm: "hr.read" }] },
];
const KEY = "mz_seen_version";
export const latestRelease = RELEASES[0].v;
export function unseenRelease() { try { return localStorage.getItem(KEY) !== latestRelease; } catch { return false; } }

export function WhatsNewPage() {
  const { can } = useCompanyContext();
  useEffect(() => { try { localStorage.setItem(KEY, latestRelease); window.dispatchEvent(new Event("mz-seen-version")); } catch { /* private window */ } }, []);
  return (
    <div className="grid" data-whats-new>
      <div className="card"><div className="card-h"><h3>ما الجديد في البرنامج</h3><span className="small muted">الإصدار الظاهر الآن {(window as any).MIZAN_VERSION}</span></div>
        <div className="small muted">آخر ما أُضيف، الأحدث أولاً. تفاصيل الشرح خطوة بخطوة في مركز التعلّم.</div></div>
      {RELEASES.map((r) => <div className="card" key={r.v} data-release={r.v}>
        <div className="card-h"><h3><span className="badge teal" style={{ marginInlineEnd: 8 }}>{r.v}</span>{r.title}</h3><span className="small muted num">{r.date}</span></div>
        <ul style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.9 }}>{r.items.filter((i) => !i.sa || CFG.country !== "EG").map((i, k) => <li key={k}>{i.text}{i.to && (!i.perm || can(i.perm)) && <> <Link to={i.to} className="small">فتح الشاشة ←</Link></>}</li>)}</ul>
      </div>)}
    </div>
  );
}
