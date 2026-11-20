/**
 * Association demo data (associations edition only): programs, donors, beneficiaries, members, six months of
 * donations / zakat / grants / membership fees and aid / program disbursements — every record tagged is_demo and
 * posted through the same services a user would use, so the books stay balanced and the demo can be deleted.
 */
import { Db } from "../db/pool";
import { r2, monthEnd } from "../lib/core";
import { ensureCharity, saveProject, savePerson, createReceipt, createDisbursement } from "./charity";
import { saveMember } from "./assoc";
import { saveMeeting, saveDecision, saveGrant, approveRequest } from "./assoc3";
import { saveBatch, postBatch, saveRequest, actRequest, saveBudgetLine } from "./charity";
import { saveCustody, actCustody, disburseCustody, settleCustody } from "./charity2";
import { saveSponsorship, collectSponsorship, createInkindDoc } from "./charity3";
import { closeWeek, closeMonth, closeProject, weekOf } from "./assoc2";
import { createPayout } from "./payouts";
import { newSallaToken } from "./salla";

/** A small, readable supporting document (SVG) for the demo vouchers: an invoice or receipt image with the voucher's figures. */
const demoDoc = (title: string, party: string, amount: number, date: string, ref: string) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="420" viewBox="0 0 595 420" direction="rtl" font-family="Tahoma,Arial">` +
  `<rect width="595" height="420" fill="#fff" stroke="#1f3b73" stroke-width="3"/><rect width="595" height="64" fill="#1f3b73"/>` +
  `<text x="565" y="42" fill="#fff" font-size="24" text-anchor="end">${title}</text>` +
  `<text x="565" y="110" font-size="18" text-anchor="end">الجهة: ${party}</text>` +
  `<text x="565" y="150" font-size="18" text-anchor="end">التاريخ: ${date}</text>` +
  `<text x="565" y="190" font-size="18" text-anchor="end">المرجع: ${ref}</text>` +
  `<text x="565" y="250" font-size="26" font-weight="bold" text-anchor="end">المبلغ: ${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ريال</text>` +
  `<text x="565" y="380" fill="#888" font-size="14" text-anchor="end">مستند تجريبي — بيانات العرض</text></svg>`, "utf8");

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
    await createReceipt(t, companyId, user, { date: day(m, 18), partnerId: donors[1].id, source: "CASH_DONATION", projectId: projects[0].id, purpose: "مساهمة في سلة رمضان", amount: Math.round(n(5000, 9000) / 100) * 100, method: "TRANSFER", refNo: `PRJ-${i + 1}`, isDemo: true });
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

  // ── what the financial reviewer asked for, with figures to show it working ──────────────────
  const acc = async (key: string) => (await t.one(`SELECT id FROM accounts WHERE company_id=$1 AND system_key=$2`, [companyId, key])).id;
  const [CASH, BANK, CLEAR] = [await acc("CASH"), await acc("BANK"), await acc("ESTORE_CLEARING")];
  const last = months[months.length - 1], prev = months[Math.max(0, months.length - 2)];

  // budget table for each project (this year), the actual comes from the ledger
  for (const [pi, key, name, amount] of [[0, "DON_RESTRICTED", "تبرعات حملة سلة رمضان", 60000], [0, "CH_PROGRAMS", "شراء المواد الغذائية للسلال", 24000], [0, "CH_AID", "مساعدات نقدية للأسر", 10000], [0, "CH_INKIND_DIST", "توزيع السلال العينية", 6000],
    [1, "CH_AID", "المساعدات الشهرية للأسر المكفولة", 14000], [2, "CH_PROGRAMS", "مدربون ومواد تدريبية ويوم التطوع", 9000]] as const) {
    await saveBudgetLine(t, companyId, { year, projectId: projects[pi].id, accountId: await acc(key), name, amount });
  }

  // supporting documents on most disbursements (the rest show under «بلا مسوغات»)
  const disb = await t.rows(`SELECT id, number, date::text date, amount, beneficiary_name FROM charity_disbursements WHERE company_id=$1 AND status='POSTED' ORDER BY date, number`, [companyId]);
  for (const [i, d] of disb.entries()) {
    if (i % 4 === 3) continue;
    const buf = demoDoc(i % 2 ? "إيصال استلام مساعدة" : "فاتورة مورد", d.beneficiaryName, Number(d.amount), d.date, d.number);
    await t.exec(`INSERT INTO attachments (company_id, entity, entity_id, name, mime, size, data, created_by, notes) VALUES ($1,'ch_disb',$2,$3,'image/svg+xml',$4,$5,$6,'demo')`, [companyId, d.id, `${i % 2 ? "إيصال" : "فاتورة"}-${d.number}.svg`, buf.length, buf, user]);
  }

  // custody: one settled (spent 1,650, returned 350), one still with its holder
  const c1 = await saveCustody(t, companyId, user, { holderName: "سعد المطيري", jobTitle: "منسق البرامج", amount: 2000, purpose: "مشتريات يوم التطوع", method: "CASH", projectId: projects[2].id, isDemo: true });
  await actCustody(t, companyId, "المدير التنفيذي", c1.id, "approve", {});
  await disburseCustody(t, companyId, user, c1.id, { date: day(prev, 2), payAccountId: CASH });
  await settleCustody(t, companyId, user, c1.id, { date: day(prev, 9), lines: [{ description: "ضيافة المتطوعين", amount: 950, docNo: "INV-3301" }, { description: "مطبوعات وشهادات", amount: 700, docNo: "INV-3302" }], returnAccountId: CASH, note: "أعيد المتبقي للصندوق" });
  const c2 = await saveCustody(t, companyId, user, { holderName: "خالد الحربي", jobTitle: "مسؤول التوزيع", amount: 1200, purpose: "نقل السلال للأسر", method: "CASH", projectId: projects[0].id, isDemo: true });
  await actCustody(t, companyId, "المدير التنفيذي", c2.id, "approve", {});
  await disburseCustody(t, companyId, user, c2.id, { date: day(last, 3), payAccountId: CASH });

  // sponsorships collected month by month
  const sp = await saveSponsorship(t, companyId, user, { sponsorId: donors[2].id, beneficiaryId: benefs[0].id, kind: "ORPHAN", amount: 500, frequency: 1, startDate: months[0], projectId: projects[1].id, isDemo: true });
  for (const m of months.slice(0, -1)) await collectSponsorship(t, companyId, user, sp.id, { count: 1, date: day(m, 6), method: "TRANSFER", refNo: `SP-${m.slice(0, 7)}`, cashAccountId: BANK });

  // in-kind: 40 food baskets received, 25 distributed
  await createInkindDoc(t, companyId, user, { kind: "IN", date: day(prev, 4), partyName: "متجر الإحسان", partnerId: donors[1].id, lines: [{ name: "سلة غذائية متكاملة", unit: "سلة", qty: 40, unitValue: 180 }, { name: "كيس أرز 10 كجم", unit: "كيس", qty: 30, unitValue: 45 }], isDemo: true });
  const items = await t.rows(`SELECT id, name FROM charity_inkind_items WHERE company_id=$1`, [companyId]);
  const it = (n: string) => items.find((x: any) => x.name === n)?.id;
  await createInkindDoc(t, companyId, user, { kind: "OUT", date: day(last, 5), partyName: "أسر الحي الشرقي", projectId: projects[0].id, lines: [{ itemId: it("سلة غذائية متكاملة"), qty: 25 }, { itemId: it("كيس أرز 10 كجم"), qty: 12 }], isDemo: true });

  // a payment request through the authority matrix: one approved and paid, one waiting for its second approval
  const rq1 = await saveRequest(t, companyId, user, { date: day(prev, 12), purpose: "صيانة مستودع الجمعية", requester: "مسؤول المستودع", beneficiaryName: "مؤسسة الصيانة المتكاملة", amount: 7500, method: "TRANSFER", justification: "تسرّب في سقف المستودع", projectId: null, isDemo: true });
  await actRequest(t, companyId, "المدير المالي", rq1.id, "review", {});
  await approveRequest(t, companyId, "المدير التنفيذي", rq1.id, {});
  const pay1 = await createDisbursement(t, companyId, user, { date: day(prev, 16), kind: "TRANSFER", requestId: rq1.id, beneficiaryName: "مؤسسة الصيانة المتكاملة", capacity: "SUPPLIER", amount: 7500, reason: "صيانة مستودع الجمعية", refNo: "MNT-77", payAccountId: BANK, isDemo: true });
  const rq2 = await saveRequest(t, companyId, user, { date: day(last, 8), purpose: "تجهيز قاعة التدريب", requester: "مسؤول البرامج", beneficiaryName: "شركة التجهيزات الحديثة", amount: 28000, method: "TRANSFER", justification: "توسعة برنامج تأهيل الشباب", projectId: projects[2].id, isDemo: true });
  await actRequest(t, companyId, "المدير المالي", rq2.id, "review", {});
  await approveRequest(t, companyId, "المدير التنفيذي", rq2.id, {});

  // an expense run above the direct limit, posted against a board decision
  const dec = await saveDecision(t, companyId, user, { meetingId: bm.id, text: "اعتماد مسير مساعدات الأسر لشهر الحملة بمبلغ 9,000 ريال", category: "FINANCIAL", amount: 9000, projectId: projects[0].id, owner: "المدير التنفيذي", status: "DONE", isDemo: true });
  const bt = await saveBatch(t, companyId, user, { date: day(last, 10), title: "مسير مساعدات الأسر — الحملة", projectId: projects[0].id, kind: "TRANSFER", payAccountId: BANK, isDemo: true,
    lines: [["أسرة أم محمد", 2500], ["أسرة أبو خالد", 2000], ["أسرة أم عبدالرحمن", 2500], ["أسرة أم سلطان", 2000]].map(([name, amount]) => ({ name, amount, capacity: "BENEFICIARY", iban: "SA0380000000608010167519" })) });
  await t.exec(`UPDATE charity_batches SET decision_id=$2 WHERE id=$1`, [bt.id, dec.id]);
  await postBatch(t, companyId, user, bt.id);

  // a finished campaign: final disbursement, the restricted remainder released to general donations, then closed
  const wc = await saveProject(t, companyId, { name: "حملة كسوة الشتاء", kind: "CAMPAIGN", restricted: true, target: 15000, startDate: months[0] });
  for (const [m, amt] of [[months[0], 6000], [months[1] || months[0], 5500], [months[2] || months[0], 3000]] as const) await createReceipt(t, companyId, user, { date: day(m, 14), partnerId: donors[1].id, source: "CASH_DONATION", projectId: wc.id, purpose: "حملة كسوة الشتاء", amount: amt, method: "TRANSFER", refNo: `WC-${m.slice(5, 7)}`, isDemo: true });
  await saveBudgetLine(t, companyId, { year, projectId: wc.id, accountId: await acc("DON_RESTRICTED"), name: "تبرعات حملة الكسوة", amount: 15000 });
  await saveBudgetLine(t, companyId, { year, projectId: wc.id, accountId: await acc("CH_PROGRAMS"), name: "شراء الكسوة ونقلها", amount: 13000 });
  await createDisbursement(t, companyId, user, { date: day(months[2] || months[0], 20), kind: "TRANSFER", beneficiaryName: "مصنع الملابس الوطني", capacity: "SUPPLIER", reason: "شراء 200 قطعة كسوة شتوية", projectId: wc.id, amount: 11000, refNo: "WC-PO-1", isDemo: true });
  await closeProject(t, companyId, user, wc.id, { date: day(months[3] || months[0], 2), remainder: "RELEASE", note: "انتهت الحملة",
    finalDisbursement: { kind: "TRANSFER", beneficiaryName: "جمعية النقل الخيري", capacity: "SUPPLIER", amount: 1800, reason: "نقل وتوزيع الكسوة — الصرف النهائي", refNo: "WC-FIN", payAccountId: BANK } });

  // Salla donation store: paid orders as card donations into the clearing account, then Salla's transfer to the bank
  if (!(await t.maybe(`SELECT 1 FROM salla_connections WHERE company_id=$1 AND platform='SALLA'`, [companyId])))
    await t.insert("salla_connections", { companyId, platform: "SALLA", token: newSallaToken(), autoPost: true, createProducts: false, mode: "DONATIONS", enabled: true,
      donationMap: JSON.stringify({ defaultSource: "CASH_DONATION", defaultProjectId: null, rules: [{ match: "RMD", projectId: projects[0].id, source: null }, { match: "كفالة", projectId: projects[1].id, source: "SPONSORSHIP" }, { match: "زكاة", projectId: null, source: "ZAKAT" }] }) });
  let storeTotal = 0;
  for (const [i, [m, name, amount, src, pj]] of ([[prev, "سهم سلة رمضان", 350, "CASH_DONATION", 0], [prev, "زكاة المال", 1200, "ZAKAT", -1], [last, "سهم سلة رمضان", 700, "CASH_DONATION", 0], [last, "كفالة أسرة شهرية", 500, "SPONSORSHIP", 1], [last, "تبرع عام", 150, "CASH_DONATION", -1]] as const).entries()) {
    const ref = `DEMO-${81000 + i}`;
    const buyer = await savePerson(t, companyId, "DONOR", { name: ["نورة العتيبي", "فهد القحطاني", "سارة الزهراني", "عبدالرحمن الشهري", "ريم الغامدي"][i], phone: `05500033${10 + i}`, donorType: "INDIVIDUAL" });
    const r = await createReceipt(t, companyId, user, { date: day(m, 11 + i), partnerId: buyer.id, source: src, projectId: pj >= 0 ? projects[pj].id : null, purpose: `تبرع عبر متجر سلة — ${name}`, amount, method: "CARD", cashAccountId: CLEAR, externalRef: `salla:demo-${i}`, isDemo: true });
    await t.insert("salla_events", { companyId, platform: "SALLA", event: "order.created", sallaId: `demo-${i}`, reference: ref, payload: JSON.stringify({ demo: true }), isTest: true, status: "DONE", message: `سند تبرع ${r.number} بمبلغ ${amount} ريال`, processedAt: new Date() });
    storeTotal += amount;
  }
  await createPayout(t, companyId, user, { platform: "SALLA", date: day(last, 20), net: r2(storeTotal - 1200 - 60 - 9), fees: 60, feeVat: 9, bankAccountId: BANK, reference: "SALLA-PAYOUT-DEMO", isDemo: true } as any);

  // weekly closings: the first weeks closed (with the reviewer's note), recent weeks left open so the bell shows them
  const firstWeeks = new Set<string>();
  for (const m of months.slice(0, -1)) for (const d0 of [1, 8, 15, 22, 28]) { const w = weekOf(day(m, d0), 4); if (w.to < day(last, 1)) firstWeeks.add(w.key); }
  for (const k of firstWeeks) await closeWeek(t, companyId, "المدير المالي", { key: k, force: true, notes: "أُقفل بعد مطابقة الصندوق والبنك — بيانات العرض" });
  // monthly closing: the two oldest months locked (no voucher can be dated in them any more); later months raise the alert
  for (const m of months.slice(0, 2)) {
    const per = await t.maybe(`SELECT id FROM periods WHERE company_id=$1 AND $2::date BETWEEN start_date AND end_date`, [companyId, day(m, 15)]);
    if (per) await closeMonth(t, companyId, "المدير المالي", { periodId: per.id, force: true, notes: "أُقفل الشهر بعد المراجعة — بيانات العرض" }, true);
  }

  // every row this load wrote is demo data (some services post without the flag)
  const tabs = await t.rows(`SELECT c1.table_name FROM information_schema.columns c1 JOIN information_schema.columns c2 ON c2.table_name=c1.table_name AND c2.table_schema=c1.table_schema AND c2.column_name='created_at'
    JOIN information_schema.columns c3 ON c3.table_name=c1.table_name AND c3.table_schema=c1.table_schema AND c3.column_name='company_id'
    WHERE c1.table_schema='public' AND c1.column_name='is_demo' AND (c1.table_name LIKE 'charity\\_%' OR c1.table_name LIKE 'assoc\\_%' OR c1.table_name IN ('journal_entries','estore_payouts','partners'))`);
  for (const x of tabs) await t.exec(`UPDATE "${x.tableName}" SET is_demo=true WHERE company_id=$1 AND created_at=now() AND NOT is_demo`, [companyId]);
  void monthEnd; void pay1;
}

/** Removes the association demo rows (called from the general demo purge, before demo journals are deleted). */
export async function purgeAssocDemo(t: Db, companyId: string) {
  const has = await t.maybe(`SELECT 1 FROM information_schema.tables WHERE table_name='assoc_share_txns'`);
  if (has) {
    await t.exec(`DELETE FROM assoc_dist_payments WHERE company_id=$1 AND distribution_id IN (SELECT id FROM assoc_distributions WHERE company_id=$1 AND is_demo)`, [companyId]);
    await t.exec(`DELETE FROM assoc_distributions WHERE company_id=$1 AND is_demo`, [companyId]);
    await t.exec(`DELETE FROM assoc_share_txns WHERE company_id=$1 AND is_demo`, [companyId]);
  }
  // the reviewer's-notes demo: documents, custody, in-kind, requests, runs, budget lines, store events, closings
  await t.exec(`DELETE FROM attachments WHERE company_id=$1 AND notes='demo' AND entity IN ('ch_disb','ch_rcpt','ch_req')`, [companyId]);
  await t.exec(`DELETE FROM salla_events WHERE company_id=$1 AND reference LIKE 'DEMO-%' AND is_test`, [companyId]);
  await t.exec(`UPDATE periods SET status='OPEN' WHERE company_id=$1 AND status='LOCKED' AND to_char(start_date,'YYYY-MM') IN (SELECT period_key FROM assoc_closings WHERE company_id=$1 AND kind='MONTHLY' AND notes LIKE '%بيانات العرض%')`, [companyId]);
  await t.exec(`DELETE FROM assoc_closings WHERE company_id=$1 AND notes LIKE '%بيانات العرض%'`, [companyId]);
  await t.exec(`DELETE FROM charity_budget_lines WHERE company_id=$1 AND project_id IN (SELECT id FROM charity_projects WHERE company_id=$1 AND is_demo)`, [companyId]);
  await t.exec(`UPDATE charity_custody SET disburse_journal_id=NULL, settle_journal_id=NULL WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`DELETE FROM charity_custody WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`DELETE FROM charity_inkind_docs WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`DELETE FROM charity_inkind_items i WHERE company_id=$1 AND name IN ('سلة غذائية متكاملة','كيس أرز 10 كجم') AND NOT EXISTS (SELECT 1 FROM charity_inkind_docs d, jsonb_array_elements(d.lines) l WHERE d.company_id=$1 AND l->>'itemId'=i.id::text)`, [companyId]);
  await t.exec(`UPDATE charity_disbursements SET request_id=NULL, batch_id=NULL WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`DELETE FROM charity_requests WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`UPDATE charity_batches SET decision_id=NULL WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`DELETE FROM charity_batches WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`UPDATE charity_receipts SET sponsorship_id=NULL WHERE company_id=$1 AND is_demo`, [companyId]);
  await t.exec(`DELETE FROM charity_sponsorships WHERE company_id=$1 AND is_demo`, [companyId]);
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
