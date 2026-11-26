/** 3.54.0: one page that introduces the activity-specific sections and opens each of them. */
import React from "react";
import { Link } from "react-router-dom";
import { CFG } from "../shared/country";
import { useCompanyContext } from "../lib";

type Sector = { key: string; ic: string; title: string; who: string; points: string[]; perm: string; links: [string, string][]; sa?: boolean };
const SECTORS: Sector[] = [
  { key: "resto", ic: "🍽", title: "المطاعم والمقاهي", who: "مطعم، مقهى، مطبخ سحابي، مخبز", perm: "products.read",
    points: ["وصفة لكل طبق وتكلفته من المكونات، والخصم من المخزون عند البيع", "الطاولات وشاشة المطبخ ومحطاته، والإضافات والأحجام", "تقرير تكاليف الطعام وهندسة القائمة وخطة شراء المكونات"],
    links: [["/recipes", "الوصفات وتكلفة الأطباق"], ["/recipes?tab=cost", "تقرير تكاليف الطعام"], ["/pos/setup", "الطاولات ومحطات المطبخ"]] },
  { key: "mfg", ic: "🏭", title: "التصنيع", who: "مصنع، ورشة، تعبئة وتجميع", perm: "mfg.read",
    points: ["قائمة مواد ومراحل تشغيل لكل منتج، وتكلفة معيارية", "أمر تصنيع: صرف المواد، تسجيل الوقت، فحص الجودة، استلام الإنتاج", "تخطيط الاحتياجات والجدولة، وانحراف التكلفة الفعلية عن المعيار"],
    links: [["/mfg", "لوحة التصنيع"], ["/mfg/orders", "أوامر التصنيع"], ["/reports-center?m=mfg", "تقارير التصنيع"]] },
  { key: "rent", ic: "🔑", title: "التأجير", who: "تأجير معدات، سيارات، قاعات، أدوات", perm: "sales.read",
    points: ["أصول بأسعار الساعة واليوم والأسبوع والشهر، وتقويم يمنع الحجز المتداخل", "عقد بتأمين مسترد، تسليم وإرجاع، وغرامة تأخير", "فوترة مقدمة أو شهرية تلقائية، وتسوية التأمين"],
    links: [["/rentals", "لوحة التأجير"], ["/rentals/contracts", "العقود"], ["/reports-center?m=rental", "تقارير التأجير"]] },
  { key: "subs", ic: "🔁", title: "الاشتراكات", who: "نادٍ رياضي، برنامج سحابي، عقود صيانة، صناديق شهرية", perm: "sales.read",
    points: ["خطط بمدد وأيام تجربة وحد استخدام", "فوترة متكررة تلقائية، وإيراد مؤجل للخطط الأطول من شهر", "تسجيل الحضور، الترقية والإيقاف والإلغاء، والإيراد الشهري المتكرر"],
    links: [["/subs", "لوحة الاشتراكات"], ["/subs/list", "المشتركون"], ["/reports-center?m=subs", "تقارير الاشتراكات"]] },
  { key: "estore", ic: "🛍", title: "المتاجر الإلكترونية", who: "متجر على سلة أو زد", perm: "sales.read", sa: true,
    points: ["كل طلب من المتجر يصير فاتورة مرحّلة بمخزونها", "تسوية تحويلات المنصة مع البنك وعمولتها", "ربحية كل طلب بعد العمولة والشحن"],
    links: [["/estore/profit", "ربحية الطلبات"], ["/estore/settlement", "تسوية المنصات"], ["/settings/salla", "ربط متجر سلة"]] },
];

export function SectorsPage() {
  const { can } = useCompanyContext();
  const list = SECTORS.filter((s) => !(s.sa && CFG.country !== "SA"));
  return <div className="grid" data-sectors>
    <div className="card"><div className="card-b"><h3 style={{ margin: 0 }}>الأنشطة المتخصصة</h3><div className="small muted mt">أقسام تُضاف فوق المحاسبة والمبيعات والمخزون لمن يحتاجها. كل قسم يسجّل قيوده بنفسه ويظهر في القوائم المالية والتقارير، ويمكن تجاهل ما لا يخص نشاطك.</div></div></div>
    <div className="grid c2">{list.map((s) => { const ok = can(s.perm); return <div key={s.key} className="card" data-sector={s.key}>
      <div className="card-h"><div><h3>{s.ic} {s.title}</h3><div className="small muted">{s.who}</div></div></div>
      <div className="card-b"><ul className="sector-points">{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
        {ok ? <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{s.links.map(([to, l], i) => <Link key={to} to={to} className={"btn sm" + (i === 0 ? " primary" : "")}>{l}</Link>)}</div> : <div className="small muted">صلاحيتك لا تشمل هذا القسم.</div>}</div>
    </div>; })}</div>
  </div>;
}
