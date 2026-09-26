/** Fixed assets: acquisition, straight-line monthly depreciation, disposal. */
import { Db } from "../db/pool";
import { bad, conflict, r2, D, num, isDate, today, monthEnd, addMonths } from "../lib/core";
import { post, nextNumber, reverse, accountByKey } from "../accounting/engine";

export interface AssetInput {
  name: string;
  category?: string;
  acquisitionDate: string;
  cost: number; // excluding VAT
  vatAmount?: number;
  salvageValue?: number;
  usefulLifeMonths: number;
  assetAccountId?: string;
  accDepAccountId?: string;
  depExpAccountId?: string;
  payAccountId?: string | null; // cash/bank; null → AP supplier
  partnerId?: string | null;
  isDemo?: boolean;
  noJournal?: boolean; // asset existed before (opening balance) — no acquisition entry
  accumulated?: number; // opening accumulated depreciation
}

export async function createAsset(t: Db, companyId: string, user: string, a: AssetInput) {
  if (!isDate(a.acquisitionDate)) throw bad("تاريخ الشراء غير صحيح");
  const cost = r2(num(a.cost));
  if (cost <= 0) throw bad("التكلفة يجب أن تكون أكبر من صفر");
  const life = Math.max(1, Math.round(num(a.usefulLifeMonths)));
  const salvage = r2(num(a.salvageValue));
  if (salvage >= cost) throw bad("القيمة التخريدية يجب أن تكون أقل من التكلفة");
  const assetAcc = a.assetAccountId ? await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND subtype='FIXED_ASSET' AND NOT is_group`, [a.assetAccountId, companyId], "حساب الأصل غير صحيح") : await accountByKey(t, companyId, "FIXED_ASSET");
  const accDep = a.accDepAccountId ? await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND subtype='ACC_DEPRECIATION' AND NOT is_group`, [a.accDepAccountId, companyId], "حساب مجمع الإهلاك غير صحيح") : await accountByKey(t, companyId, "ACC_DEP");
  const depExp = a.depExpAccountId ? await t.one(`SELECT id FROM accounts WHERE id=$1 AND company_id=$2 AND type='EXPENSE' AND NOT is_group`, [a.depExpAccountId, companyId], "حساب مصروف الإهلاك غير صحيح") : await accountByKey(t, companyId, "DEPRECIATION");
  const code = await nextNumber(t, companyId, "FA", a.acquisitionDate, 4);
  let journalId: string | null = null;
  if (!a.noJournal) {
    const vat = r2(num(a.vatAmount));
    const lines: any[] = [{ account: assetAcc.id, debit: cost, description: `شراء أصل ${a.name}` }];
    if (vat) lines.push({ key: "VAT_IN", debit: vat, description: `ضريبة مدخلات ${code}` });
    if (a.payAccountId) lines.push({ account: a.payAccountId, credit: r2(cost + vat), description: `سداد ${a.name}` });
    else if (a.partnerId) lines.push({ key: "AP", credit: r2(cost + vat), partnerId: a.partnerId, description: `شراء أصل ${a.name}` });
    else throw bad("حدد طريقة السداد (نقدي/بنك) أو المورد");
    const e = await post(t, companyId, { date: a.acquisitionDate, type: "ASSET", sourceType: "ASSET", reference: code, memo: `شراء أصل ثابت ${code} — ${a.name}`, isDemo: a.isDemo, createdBy: user, lines });
    journalId = e!.id;
  }
  const row = await t.insert("fixed_assets", {
    companyId, code, name: a.name, category: a.category || null, acquisitionDate: a.acquisitionDate, cost, salvageValue: salvage, usefulLifeMonths: life,
    accumulated: r2(num(a.accumulated)), assetAccountId: assetAcc.id, accDepAccountId: accDep.id, depExpAccountId: depExp.id, payAccountId: a.payAccountId || null,
    journalId, isDemo: !!a.isDemo, lastDepreciation: a.accumulated ? monthEnd(addMonths(a.acquisitionDate, -1)) : null,
  });
  if (journalId) await t.exec(`UPDATE journal_entries SET source_id=$2 WHERE id=$1`, [journalId, row.id]);
  return row;
}

/** Posts straight-line depreciation for every active asset up to `throughDate` (month by month). */
export async function runDepreciation(t: Db, companyId: string, user: string, throughDate: string, isDemo = false) {
  if (!isDate(throughDate)) throw bad("التاريخ غير صحيح");
  const assets = await t.rows(`SELECT * FROM fixed_assets WHERE company_id=$1 AND status='ACTIVE' FOR UPDATE`, [companyId]);
  const results: any[] = [];
  for (const asset of assets) {
    const monthly = r2(D(asset.cost).minus(asset.salvageValue).div(asset.usefulLifeMonths));
    let cursor = asset.lastDepreciation ? monthEnd(addMonths(asset.lastDepreciation, 1)) : monthEnd(asset.acquisitionDate);
    while (cursor <= throughDate) {
      const depreciable = r2(D(asset.cost).minus(asset.salvageValue));
      const remaining = r2(D(depreciable).minus(asset.accumulated));
      if (remaining <= 0) {
        await t.exec(`UPDATE fixed_assets SET status='FULLY_DEPRECIATED' WHERE id=$1`, [asset.id]);
        break;
      }
      const amount = Math.min(monthly, remaining);
      const e = await post(t, companyId, {
        date: cursor, type: "DEPRECIATION", sourceType: "ASSET", sourceId: asset.id, reference: asset.code,
        memo: `إهلاك ${asset.name} — ${cursor.slice(0, 7)}`, isDemo: isDemo || asset.isDemo, createdBy: user,
        lines: [
          { account: asset.depExpAccountId, debit: amount, description: `إهلاك ${asset.name}` },
          { account: asset.accDepAccountId, credit: amount, description: `مجمع إهلاك ${asset.name}` },
        ],
      });
      await t.insert("asset_depreciations", { companyId, assetId: asset.id, periodEnd: cursor, amount, journalId: e!.id, isDemo: isDemo || asset.isDemo });
      asset.accumulated = r2(D(asset.accumulated).plus(amount));
      await t.exec(`UPDATE fixed_assets SET accumulated=$2, last_depreciation=$3, status=$4 WHERE id=$1`, [asset.id, asset.accumulated, cursor, asset.accumulated >= depreciable ? "FULLY_DEPRECIATED" : "ACTIVE"]);
      results.push({ asset: asset.name, period: cursor, amount });
      cursor = monthEnd(addMonths(cursor, 1));
    }
  }
  return results;
}

export async function disposeAsset(t: Db, companyId: string, user: string, id: string, date: string, proceeds: number, proceedsAccountId?: string | null) {
  const asset = await t.one(`SELECT * FROM fixed_assets WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, companyId], "الأصل غير موجود");
  if (asset.status === "DISPOSED") throw conflict("الأصل مستبعد مسبقاً");
  const nbv = r2(D(asset.cost).minus(asset.accumulated));
  const p = r2(num(proceeds));
  const gainLoss = r2(D(p).minus(nbv));
  const lines: any[] = [
    { account: asset.accDepAccountId, debit: asset.accumulated, description: `استبعاد ${asset.name}` },
    { account: asset.assetAccountId, credit: asset.cost, description: `استبعاد ${asset.name}` },
  ];
  if (p > 0) lines.push({ ...(proceedsAccountId ? { account: proceedsAccountId } : { key: "CASH" }), debit: p, description: `متحصلات بيع ${asset.name}` });
  if (gainLoss > 0) lines.push({ key: "OTHER_INCOME", credit: gainLoss, description: `ربح بيع ${asset.name}` });
  if (gainLoss < 0) lines.push({ key: "GENERAL_EXPENSE", debit: -gainLoss, description: `خسارة استبعاد ${asset.name}` });
  const e = await post(t, companyId, { date, type: "ASSET", sourceType: "ASSET", sourceId: asset.id, reference: asset.code, memo: `استبعاد أصل ${asset.code} — ${asset.name}`, createdBy: user, isDemo: asset.isDemo, lines });
  await t.exec(`UPDATE fixed_assets SET status='DISPOSED' WHERE id=$1`, [id]);
  return e;
}
