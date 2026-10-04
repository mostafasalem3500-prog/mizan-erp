// electron-builder afterPack: stamp the Windows executable with Mizan's icon and version info using
// resedit (pure JS) — so the installer can be produced on Linux CI without wine/rcedit.
const path = require("path");
const fs = require("fs");
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit").then((m) => m.default || m);
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const pe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(pe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, "..", "assets", "icon.ico")));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));
  const vers = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const v = vers[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = ctx.packager.appInfo.version.split(".").map(Number);
  v.setFileVersion(a, b, c, 0);
  v.setProductVersion(a, b, c, 0);
  v.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: "Mizan ERP", ProductName: "Mizan ERP", CompanyName: "Mizan ERP", LegalCopyright: "Mizan ERP",
    OriginalFilename: path.basename(exe), InternalName: "Mizan ERP", FileVersion: ctx.packager.appInfo.version, ProductVersion: ctx.packager.appInfo.version,
  });
  v.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
  console.log("  • stamped icon & version info on", path.basename(exe));
};
