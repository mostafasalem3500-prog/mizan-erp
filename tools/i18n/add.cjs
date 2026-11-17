#!/usr/bin/env node
/**
 * Adds translations to the English dictionary (apps/api/web/src/i18n/en.json).
 *
 *   node tools/i18n/add.cjs file.tsv [more.tsv …]
 *
 * One line per text: `s<TAB>Arabic<TAB>English` for a whole text, `p<TAB>Arabic with ${0}<TAB>English with {0}` for a
 * sentence with variable parts. Lines with an empty English column are skipped. The Arabic is normalised the same way
 * the app normalises what it shows (outer punctuation and spaces trimmed), so it can be pasted as it appears in the code.
 */
const fs = require("fs"), path = require("path");
const { split, ws } = require("./norm.cjs");
const DICT = path.resolve(__dirname, "../../apps/api/web/src/i18n/en.json");
const d = JSON.parse(fs.readFileSync(DICT, "utf8"));
const pm = new Map(d.p);
let ns = 0, np = 0;
for (const f of process.argv.slice(2)) for (const [n, line] of fs.readFileSync(f, "utf8").split("\n").entries()) {
  if (!line.trim()) continue;
  const [kind, ar, en] = line.split("\t");
  if (!en || !en.trim()) continue;
  if (kind === "s") { const k = split(ws(ar))[1]; if (!k) throw new Error(`${f}:${n + 1}: empty Arabic`); d.s[k] = en.trim(); ns++; }
  else if (kind === "p") {
    const k = ws(ar);
    const need = new Set(k.match(/\$\{\d\}/g) || []).size, used = new Set(en.match(/\{\d\}/g) || []).size;
    if (used > need) throw new Error(`${f}:${n + 1}: the English uses more placeholders than the Arabic has`);
    pm.set(k, en.trim()); np++;
  } else throw new Error(`${f}:${n + 1}: the first column must be s or p`);
}
d.p = [...pm.entries()];
fs.writeFileSync(DICT, JSON.stringify(d));
console.log(`added ${ns} strings, ${np} patterns · dictionary: ${Object.keys(d.s).length} strings, ${d.p.length} patterns`);
