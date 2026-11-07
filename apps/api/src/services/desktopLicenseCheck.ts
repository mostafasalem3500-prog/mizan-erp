/**
 * Desktop edition: when the PC is online, ask the cloud licence server whether each company's licence still lives on
 * this PC. If it was transferred to another PC, this copy turns read-only (so a transfer cannot leave two working PCs).
 * Offline PCs are never locked by this check.
 */
import os from "os";
import { db } from "../db/pool";
import { isDesktopLocal, currentDeviceId, deviceMatches, licenseServer } from "../lib/desktopLicense";

export async function checkDesktopLicences(): Promise<{ checked: number; movedAway: number } | null> {
  if (!isDesktopLocal()) return null;
  const dev = currentDeviceId();
  if (!dev) return null;
  const rows = await db.rows(
    `SELECT DISTINCT ON (k.company_id) k.company_id, k.key, c.licensed_device
       FROM license_keys k JOIN companies c ON c.id=k.company_id
      WHERE k.desktop AND k.activated_at IS NOT NULL AND c.licensed_device IS NOT NULL
      ORDER BY k.company_id, k.activated_at DESC`,
  );
  let checked = 0, movedAway = 0;
  for (const r of rows) {
    if (!deviceMatches(r.licensedDevice, dev)) continue; // already read-only here
    let j: any;
    try {
      const res = await fetch(licenseServer() + "/api/auth/license/desktop-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: r.key, device: dev, computer: os.hostname() }), signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      j = await res.json();
    } catch {
      return { checked, movedAway }; // offline — try again later
    }
    checked++;
    if (j?.state === "moved" && j.currentDevice && !deviceMatches(j.currentDevice, dev)) {
      await db.exec(`UPDATE companies SET licensed_device=$2, updated_at=now() WHERE id=$1`, [r.companyId, j.currentDevice]);
      await db.insert("audit_logs", { companyId: r.companyId, userId: null, userName: "النظام", action: "LICENSE_MOVED_AWAY", entity: "company", entityId: r.companyId, details: { from: dev, to: j.currentDevice } });
      movedAway++;
    }
  }
  return { checked, movedAway };
}

export function startDesktopLicenseCheck() {
  if (!isDesktopLocal()) return;
  const run = () => checkDesktopLicences().then((r) => r && r.movedAway && console.log("[licence] moved to another PC:", r.movedAway)).catch((e) => console.error("[licence]", e.message));
  setTimeout(run, Number(process.env.LICENSE_CHECK_DELAY_MS || 60000));
  setInterval(run, 6 * 3600 * 1000).unref();
}
