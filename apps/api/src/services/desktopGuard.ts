/**
 * Desktop (local database) edition — what the licence check trusts, since the database and the PC clock belong to the user:
 *  1. Time: the latest moment this installation has ever seen. Turning the PC clock back does not bring back a trial
 *     or a subscription that has ended.
 *  2. Entitlement: taken from the signed licence keys themselves (plan months counted from the key's signed issue date),
 *     not from the dates stored in the database — so editing `subscription_ends_at` or `plan` by hand gains nothing.
 *  3. Trial: one trial period per installation, shared by every company created on it.
 * None of this runs on the cloud edition.
 */
import { db } from "../db/pool";
import { isDesktopLocal, verifyDesktopLicense, deviceMatches, currentDeviceId } from "../lib/desktopLicense";

/** A key may be activated late; the months still count from its issue date plus this allowance. */
export const ACTIVATION_GRACE_DAYS = 180;
export const DESKTOP_TRIAL_DAYS = () => Math.max(1, Math.min(30, Number(process.env.TRIAL_DAYS || 30)));

let highWater = 0;
let firstRun: Date | null = null;
/** The time to judge subscriptions by: never earlier than the latest time already seen. */
export const trustedNow = () => (isDesktopLocal() ? Math.max(Date.now(), highWater) : Date.now());
export const clockTurnedBack = () => isDesktopLocal() && highWater - Date.now() > 36 * 3600 * 1000;
export const firstRunAt = () => firstRun;

async function tick() {
  highWater = Math.max(highWater, Date.now());
  await db.exec(`INSERT INTO app_state(key, value) VALUES ('clock_high', $1) ON CONFLICT (key) DO UPDATE SET value = GREATEST(app_state.value::bigint, EXCLUDED.value::bigint)::text, updated_at = now()`, [String(highWater)]);
}
export async function startDesktopGuard() {
  if (!isDesktopLocal()) return;
  const st = await db.rows(`SELECT key, value FROM app_state WHERE key IN ('clock_high','first_run')`);
  const get = (k: string) => st.find((r: any) => r.key === k)?.value;
  // what the data itself remembers: the newest record is a time that has certainly passed
  const seen = await db.one(`SELECT GREATEST((SELECT MAX(created_at) FROM audit_logs), (SELECT MAX(created_at) FROM journal_entries), (SELECT MAX(created_at) FROM companies)) m`);
  highWater = Math.max(Number(get("clock_high") || 0), seen.m ? new Date(seen.m).getTime() : 0);
  const oldest = await db.one(`SELECT MIN(created_at) m FROM companies`);
  const fr = [get("first_run") ? new Date(get("first_run")) : null, oldest.m ? new Date(oldest.m) : null, new Date(trustedNow())].filter((d): d is Date => !!d && !isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime())[0];
  firstRun = fr;
  await db.exec(`INSERT INTO app_state(key, value) VALUES ('first_run', $1) ON CONFLICT (key) DO UPDATE SET value = LEAST(app_state.value, EXCLUDED.value)`, [fr.toISOString()]);
  await tick();
  setInterval(() => tick().catch(() => undefined), 5 * 60 * 1000).unref();
  if (clockTurnedBack()) console.warn("[guard] the PC clock is behind the latest time seen by this installation");
}

/** When a new company's trial ends on this installation: the installation's first run + the trial length. */
export function desktopTrialEnd(): Date {
  const start = firstRun || new Date(trustedNow());
  return new Date(start.getTime() + DESKTOP_TRIAL_DAYS() * 86400000);
}

export type Entitlement = { keys: number; maxEnd: Date | null };
const cache = new Map<string, { at: number; v: Entitlement }>();
export const forgetEntitlement = (companyId?: string) => (companyId ? cache.delete(companyId) : cache.clear());
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
/** The furthest date the company's activated, authentic, this-PC keys can pay for: latest issue date + all their months + the activation allowance. */
export async function desktopEntitlement(companyId: string): Promise<Entitlement> {
  const c = cache.get(companyId);
  if (c && Date.now() - c.at < 60000) return c.v;
  const rows = await db.rows(`SELECT key FROM license_keys WHERE company_id=$1 AND desktop AND activated_at IS NOT NULL`, [companyId]);
  const dev = currentDeviceId();
  let months = 0, latest = 0, keys = 0;
  for (const r of rows) {
    const p = verifyDesktopLicense(r.key);
    if (!p || p.type === "rebind" || !p.months) continue;
    keys++; months += Number(p.months) || 0; latest = Math.max(latest, new Date(p.issuedAt).getTime() || 0);
    void dev; void deviceMatches; // the PC binding itself is enforced through companies.licensed_device (which a transfer key moves)
  }
  const v: Entitlement = { keys, maxEnd: keys && latest ? new Date(addMonths(new Date(latest), months).getTime() + ACTIVATION_GRACE_DAYS * 86400000) : null };
  cache.set(companyId, { at: Date.now(), v });
  return v;
}
