/**
 * Association demo data (associations edition only): programs, donors, beneficiaries, members, six months of
 * donations / zakat / grants / membership fees and aid / program disbursements — every record tagged is_demo and
 * posted through the same services a user would use, so the books stay balanced and the demo can be deleted.
 */
import { Db } from "../db/pool";
import { r2, monthEnd } from "../lib/core";
import { ensureCharity, saveProject, savePerson, createReceipt, createDisbursement } from "./charity";
import { saveMember } from "./assoc";

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
    await createDisbursement(t, companyId, user, { date: day(m, 22), kind: "CASH", beneficiaryName: "مؤسسة التموين", capacity: "SUPPLIER", reason: "شراء مواد غذائية للسلال", projectId: projects[0].id, amount: Math.round(n(2000, 4000) / 50) * 50, isDemo: true });
    if (i % 2 === 1) await createDisbursement(t, companyId, user, { date: day(m, 25), kind: "CASH", beneficiaryName: "مدرب البرنامج", capacity: "OTHER", reason: "دورة تأهيل الشباب", projectId: projects[2].id, amount: 1800, isDemo: true });
  }
  // this year's membership fees: most members paid
  const year = Number(end.slice(0, 4));
  for (const m of members.slice(0, 4)) await createReceipt(t, companyId, user, { date: day(months[Math.min(1, months.length - 1)], 10), partnerId: m.id, payerName: m.name, source: "MEMBERSHIP", feeYear: year, purpose: `اشتراك العضوية لعام ${year}`, amount: 300, method: "CASH", isDemo: true });
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
