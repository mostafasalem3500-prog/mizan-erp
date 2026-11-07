// The PostgreSQL binaries are unpacked next to app.asar (asarUnpack), but the platform package computes their
// path from its own module location — which inside the packaged app is ".../app.asar/node_modules/...".
// Windows cannot execute a file through the asar archive, so initdb/pg_ctl failed with ENOENT on first run.
// Point the computed directory at app.asar.unpacked (a no-op when running unpackaged in development).
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "node_modules", "@embedded-postgres");
const MARK = "/* mizan: asar-unpacked */";
let patched = 0;
for (const pkg of fs.existsSync(root) ? fs.readdirSync(root) : []) {
  const file = path.join(root, pkg, "dist", "index.js");
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, "utf8");
  if (src.includes(MARK)) { patched++; continue; }
  const re = /const __dirname = path\.dirname\(fileURLToPath\(import\.meta\.url\)\);/;
  if (!re.test(src)) throw new Error(`unexpected layout in ${file} — update scripts/patch-embedded-postgres.js`);
  src = src.replace(re, `const __dirname = path.dirname(fileURLToPath(import.meta.url)).replace(/app\\.asar(?=[\\\\/])/, "app.asar.unpacked"); ${MARK}`);
  fs.writeFileSync(file, src);
  patched++;
}
if (!patched) throw new Error("no @embedded-postgres platform package found to patch");
console.log(`embedded-postgres: binary paths point to app.asar.unpacked (${patched} package(s))`);
