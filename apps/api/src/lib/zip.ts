/** Minimal ZIP writer (deflate, UTF-8 names) — enough to hand an auditor one file; no dependency. */
import zlib from "zlib";

export function zip(files: { name: string; data: Buffer; date?: Date }[]): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  const seen = new Map<string, number>();
  for (const f of files) {
    // unique, safe path inside the archive
    let name = f.name.replace(/\\/g, "/").split("/").map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, "-").trim() || "-").join("/").replace(/^\/+/, "");
    const n = seen.get(name) || 0; seen.set(name, n + 1);
    if (n) { const dot = name.lastIndexOf("."); name = dot > name.lastIndexOf("/") ? `${name.slice(0, dot)} (${n + 1})${name.slice(dot)}` : `${name} (${n + 1})`; }
    const nameBuf = Buffer.from(name, "utf8");
    const raw = f.data; const def = zlib.deflateRawSync(raw, { level: 6 });
    const stored = def.length >= raw.length; const body = stored ? raw : def;
    const crc = zlib.crc32(raw) >>> 0;
    const d = f.date || new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(stored ? 0 : 8, 10);
    cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(0, 30); cen.writeUInt32LE(0, 34); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, body); central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
