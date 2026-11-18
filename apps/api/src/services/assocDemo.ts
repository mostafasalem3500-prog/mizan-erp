/**
 * Association demo data (associations edition only): programs, donors, beneficiaries, members, six months of
 * donations / zakat / grants / membership fees and aid / program disbursements — every record tagged is_demo and
 * posted through the same services a user would use, so the books stay balanced and the demo can be deleted.
 */
import { Db } from "../db/pool";
import { r2, monthEnd } from "../lib/core";
import { ensureCharity, saveProject, savePerson, createReceipt, createDisbursement } from "./charity";
import { saveMember } from "./assoc";
import { saveMeeting, saveDecision, saveGrant } from "./assoc3";

export async function seedAssocDemo(t: Db, companyId: string, user: string, months: string[], end: string) {
  await ensureCharity(t, companyId);
  let seed = 4711;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const day = (m: string, d: number) => { const x = `${m.slice(0, 8)}${String(Math.min(d, 28)).padStart(2, "0")}`; return x > end ? end : x; };
  const demo = async (table: string, id: string) => t.exec(`UPDATE ${table} SET is_demo=true WHERE id=$1`, [id]);

  const projects: any[] = [];
  for (const [name, kind, restricted, target] of [["سلة رمضان الغذائية", "CAMPAIGN", true, 60000], ["كفالة الأسر المتعففة", "PROGRAM", false, 0], ["برنامج تأهيل الشباب", "PROGRAM", false, 0]] as const) {
    const p = await saveProject(t, companyId, { name, kind, restricted, target, startDate: months[0] });
    await demo("charity_projects", p.id); projects.push(p);
  }
  const donors: any[] = [];
  for (const [name, donorType, phone] of [["مؤسسة الخير الوقفية", "ENTITY", "0500000101"], ["شركة البناء الحديث", "COMPANY", "0500000102"], ["عبدالله بن سالم", "INDIVIDUAL", "0500000103"], ["فاعل خير", "INDIVIDUAL", ""]] as const) {
    const p = await savePerson(t, companyId, "DONOR", { name, donorType, phone });
    await demo("partners", p.id); donors.push(p);
  }
  const benefs: any[] = [];
  for (const [name, familySize] of [["أسرة أم محمد", 6], ["أسرة أبو خالد", 4], ["أسرة أم عبدالرحمن", 5]] as const) {
    const p = await savePerson(t, companyId, "BENEFICIARY", { name, familySize, category: "أسرة محتاجة" });
    await demo("partners", p.id); benefs.push(p);
  }
  const members: any[] = [];
  for (const [name, kind] of [["سعد بن عبدالعزيز", "FOUNDER"], ["خالد بن محمد", "FOUNDER"], ["فهد بن ناصر", "WORKING"], ["ماجد بن علي", "WORKING"], ["نورة بنت سعد", "WORKING"], ["هند بنت فهد", "AFFILIATE"]] as const) {
    const m = await saveMember(t, companyId, { name, kind, joinDate: months[0], phone: "05000002" + String(members.length + 10) });
    await demo("partners", m.id); members.push(m);
  }
  await t.exec(`UPDATE charity_settings SET membership = membership || '{"annualFee":300}'::jsonb WHERE company_id=$1 AND COALESCE((membership->>'annualFee')::numeric,0)=0`, [companyId]);

  for (const [i, m] of months.entries()) {
    const n = (a: number, b: number) => r2(a + rand() * (b - a));
    await createReceipt(t, companyId, user, { date: day(m, 3), partnerId: donors[0].id, source: "SUPPORT", purpose: "دعم تشغيلي شهري", amount: Math.round(n(8000, 12000) / 100) * 100, method: "TRANSFER", refNo: `TRF-${i + 1}01`, isDemo: true });
    await createReceipt(t, companyId, user, { date: day(m, 8), partnerId: donors[2].id, source: "CASH_DONATION", purpose: "تبرع عام", amount: Math.round(n(500, 2000) / 50) * 50, method: "CASH", isDemo: true });
    await createReceipt(t, companyId, user, { date: day(m, 12), payerName: "فاعل خير", source: "ZAKAT", purpose: "زكاة مال", amount: Math.round(n(3000, 7000) / 100) * 100, method: "TRANSFER", refNo: `ZK-${i + 1}`, isDemo: true });
    if (i % 2 === 0) await createReceipt(t, companyId, user, { date: day(m, 18), partnerId: donors[1].id, source: "CASH_DONATION", projectId: projects[0].id, purpose: "مساهمة في سلة رمضان", amount: Math.round(n(5000, 9000) / 100) * 100, method: "TRANSFER", refNo: `PRJ-${i + 1}`, isDemo: true });
    await createDisbursement(t, companyId, user, { date: day(m, 15), kind: "TRANSFER", partnerId: benefs[i % 3].id, capacity: "BENEFICIARY", reason: "مساعدة نقدية شهرية", projectId: projects[1].id, amount: Math.round(n(1500, 2500) / 50) * 50, refNo: `AID-${i + 1}`, isDemo: true });
    await createDisbursement(t, companyId, user, { date: day(m, 22), kind: "TRANSFER", refNo: `SUP-${i + 1}`, beneficiaryName: "مؤسسة التموين", capacity: "SUPPLIER", reason: "شراء مواد غذائية للسلال", projectId: projects[0].id, amount: Math.round(n(2000, 4000) / 50) * 50, isDemo: true });
    if (i % 2 === 1) await createDisbursement(t, companyId, user, { date: day(m, 25), kind: "TRANSFER", refNo: `TRN-${i + 1}`, beneficiaryName: "مدرب البرنامج", capacity: "OTHER", reason: "دورة تأهيل الشباب", projectId: projects[2].id, amount: 1800, isDemo: true });
  }
  // this year's membership fees: most members paid
  const year = Number(end.slice(0, 4));
  for (const m of members.slice(0, 4)) await createReceipt(t, companyId, user, { date: day(months[Math.min(1, months.length - 1)], 10), partnerId: m.id, payerName: m.name, source: "MEMBERSHIP", feeYear: year, purpose: `اشتراك العضوية لعام ${year}`, amount: 300, method: "CASH", isDemo: true });
  // governance: board meeting + general assembly with decisions; a grant from the endowment foundation
  const bm = await saveMeeting(t, companyId, user, { kind: "BOARD", title: "الاجتماع الدوري لمجلس الإدارة", date: day(months[0], 5), membersTotal: 7, attendees: ["رئيس المجلس", "نائب الرئيس", "أمين الصندوق", "عضو", "عضو", "عضو"].map((role, i) => ({ name: `عضو المجلس ${i + 1}`, role, present: true })), agenda: "اعتماد خطة البرامج — حملة سلة رمضان — صلاحيات الصرف", minutes: "اجتمع المجلس بحضور ستة من سبعة أعضاء، وناقش جدول الأعمال واتخذ القرارات المرفقة.", isDemo: true });
  await saveMeeting(t, companyId, user, { status: "APPROVED", kind: "BOARD", date: day(months[0], 5), membersTotal: 7, attendees: ["رئيس المجلس", "نائب الرئيس", "أمين الصندوق", "عضو", "عضو", "عضو"].map((role, i) => ({ name: `عضو المجلس ${i + 1}`, role, present: true })), agenda: "اعتماد خطة البرامج — حملة سلة رمضان — صلاحيات الصرف", minutes: "اجتمع المجلس بحضور ستة من سبعة أعضاء، وناقش جدول الأعمال واتخذ القرارات المرفقة." }, bm.id);
  const ga = await saveMeeting(t, companyId, user, { kind: "GA", title: "اجتماع الجمعية العمومية العادية", date: day(months[1] || months[0], 20), membersTotal: members.length, attendees: members.map((m: any, i: number) => ({ name: m.name, role: "عضو", present: i < 5 })), agenda: "اعتماد القوائم المالية للعام السابق وتعيين المراجع الخارجي", minutes: "اعتمدت الجمعية العمومية القوائم المالية وعيّنت المراجع الخارجي.", isDemo: true });
  for (const [text, category, amount, due, status] of [["اعتماد ميزانية حملة سلة رمضان بمبلغ 60,000 ريال", "FINANCIAL", 60000, day(months[0], 25), "DONE"], ["تكليف المدير التنفيذي بالتعاقد مع مورد المواد الغذائية بعد ثلاثة عروض أسعار", "PROGRAM", null, day(months[1] || months[0], 10), "DONE"], ["تحديث لائحة الصلاحيات المالية ورفعها للجمعية العمومية", "ADMIN", null, day(months[2] || months[0], 1), "OPEN"], ["إطلاق برنامج تأهيل الشباب بالشراكة مع جهة تدريبية", "PROGRAM", 15000, end, "OPEN"]] as const) {
    await saveDecision(t, companyId, user, { meetingId: bm.id, text, category, amount, projectId: category === "FINANCIAL" ? projects[0].id : null, owner: "المدير التنفيذي", dueDate: due, status, isDemo: true });
  }
  await saveDecision(t, companyId, user, { meetingId: ga.id, text: "اعتماد القوائم المالية المدققة للعام السابق", category: "FINANCIAL", status: "DONE", isDemo: true });
  const tr = [0, 2, 4].map((i) => ({ dueDate: day(months[Math.min(i, months.length - 1)], 1), amount: 20000 }));
  const g = await saveGrant(t, companyId, user, { title: "منحة دعم البرامج التشغيلية", partnerId: donors[0].id, agreementNo: "اتفاقية 77/1447", projectId: projects[1].id, amount: 60000, startDate: months[0], endDate: `${end.slice(0, 4)}-12-31`, tranches: tr, reports: [{ title: "تقرير الإنجاز نصف السنوي", dueDate: day(months[Math.min(3, months.length - 1)], 15), submittedAt: day(months[Math.min(3, months.length - 1)], 12) }, { title: "التقرير الختامي والمالي", dueDate: `${end.slice(0, 4)}-12-31` }], isDemo: true });
  for (const x of tr.slice(0, 2)) if (x.dueDate! <= end) await createReceipt(t, companyId, user, { date: x.dueDate, partnerId: donors[0].id, source: "SUPPORT", grantId: g.id, purpose: `دفعة ${g.title}`, amount: x.amount, method: "TRANSFER", refNo: `GRT-${x.dueDate}`, isDemo: true });
  void monthEnd;
}

/** Removes the association demo rows (called from the general demo purge, before demo journals are deleted). */
export async function purgeAssocDemo(t: Db, companyId: string) {
  const has = await t.maybe(`SELECT 1 FROM information_schema.tables WHERE table_name='assoc_share_txns'`);
  if (has) {
    await t.exec(`DELETE FROM assoc_dist_payments WHERE company_id=$1 AND distribution_id IN (SELECT id FROM assoc_distributions WHERE company_id=$1 AND is_demo)`, [companyId]);
    await t.exec(`DELETE FROM assoc_distributions WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM assoc_share_txns WHERE company_id=$1 AND is_demo`, [companyId]);
  }
  await t.exec(`DELETE FROM charity_receipts WHERE company_id=$1 AND is_demo`, [companyId]);
  if (await t.maybe(`SELECT 1 FROM information_schema.tables WHERE table_name='assoc_grants'`)) {
    await t.exec(`UPDATE charity_receipts SET grant_id=NULL WHERE company_id=$1 AND grant_id IN (SELECT id FROM assoc_grants WHERE company_id=$1 AND is_demo)`, [companyId]);
    await t.exec(`DELETE FROM assoc_grants WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`UPDATE charity_requests SET decision_id=NULL WHERE company_id=$1 AND decision_id IN (SELECT id FROM assoc_decisions WHERE company_id=$1 AND is_demo)`, [companyId]);
    await t.exec(`DELETE FROM assoc_decisions WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM assoc_meetings WHERE company_id=$1 AND is_demo AND NOT EXISTS (SELECT 1 FROM assoc_decisions d WHERE d.meeting_id=assoc_meetings.id)`, [companyId]);
  }
  await t.exec(`DELETE FROM charity_disbursements WHERE company_id=$1 AND is_demo`, [companyId]);
  // anything real still pointing at a demo program loses the link; a demo person still referenced by real records stays (as real)
  const cols = await t.rows(`SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND (table_name LIKE 'charity\\_%' OR table_name LIKE 'assoc\\_%') AND column_name IN ('project_id','partner_id') AND table_name<>'charity_projects'`);
  for (const c of cols) {
    if (c.columnName === "project_id") {
      if (c.isNullable === "YES") await t.exec(`UPDATE "${c.tableName}" SET project_id=NULL WHERE company_id=$1 AND project_id IN (SELECT id FROM charity_projects WHERE company_id=$1 AND is_demo)`, [companyId]);
      else await t.exec(`UPDATE charity_projects SET is_demo=false WHERE company_id=$1 AND is_demo AND id IN (SELECT project_id FROM "${c.tableName}" WHERE company_id=$1)`, [companyId]);
    } else await t.exec(`UPDATE partners SET is_demo=false WHERE company_id=$1 AND is_demo AND id IN (SELECT partner_id FROM "${c.tableName}" WHERE company_id=$1 AND partner_id IS NOT NULL)`, [companyId]);
  }
  await t.exec(`DELETE FROM charity_projects WHERE company_id=$1 AND is_demo`, [companyId]);
}
