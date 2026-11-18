#!/usr/bin/env node
/**
 * English interface: which Arabic interface texts have no English yet.
 *
 *   node tools/i18n/check.cjs                 → summary + the missing texts, exit 1 when more than MAX are missing
 *   node tools/i18n/check.cjs --todo out.tsv  → also writes the missing texts as a file to translate (see add.cjs)
 *
 * Reads the screens (apps/api/web/src) and the server texts that reach the screen (messages, report and lesson texts).
 * Text written by the server in both languages (T(arabic, english), e.g. the written financial report) needs no entry.
 * Left out on purpose: the associations edition (Arabic only), printed documents (files that use React's own JSX factory
 * keep the language of their print template), the assistant's Arabic language rules, demo data, internal checks, SQL
 * and e-mail HTML.
 */
const fs = require("fs"), path = require("path");
const { split, ws } = require("./norm.cjs");
const ROOT = path.resolve(__dirname, "../..");
const API = path.join(ROOT, "apps/api");
const ts = require(require.resolve("typescript", { paths: [path.join(API, "web")] })); // the web app's TypeScript (5.x) has the parser API
const DICT = path.join(API, "web/src/i18n/en.json");
const MAX = Number(process.env.I18N_MAX_MISSING ?? 40);

const AR = /[ء-ي]/;
const SKIP_DIRS = new Set(["charity", "i18n", "node_modules", "dist"]);
const SKIP_FILES = /^(ai[A-Z].*|ai|selfcheck.*|selftest|scripts-selfcheck|demo|assocDemo|seed-demo-account|assoc\d*|charity\d*|openapi|migrate)\.ts$/;
const NOT_UI = (s) => /\b(SELECT|UPDATE|INSERT|COALESCE|CASE WHEN|replace\(replace)\b/.test(s) || /^<|style="|<\/(div|p|table|td|b)>/.test(s);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); }
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !SKIP_FILES.test(e.name)) acc.push(p);
  }
  return acc;
}

const strings = new Map(), patterns = new Map();
const files = [...walk(path.join(API, "web/src")), ...walk(path.join(API, "src"))];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  if (src.includes("@jsxImportSource react")) continue; // printed documents
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(ROOT, f);
  (function v(n) {
    // T(arabic, english): text the server writes in both languages itself — only the English argument is read
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "T" && n.arguments.length === 2) { v(n.arguments[1]); return; }
    if (ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const c = split(ws(n.text))[1];
      if (c && AR.test(c) && !NOT_UI(c) && !strings.has(c)) strings.set(c, rel);
    } else if (ts.isTemplateExpression(n)) {
      let s = n.head.text; n.templateSpans.forEach((sp, i) => { s += "${" + i + "}" + sp.literal.text; });
      s = ws(s);
      if (AR.test(s.replace(/\$\{\d\}/g, "")) && !NOT_UI(s) && !patterns.has(s)) patterns.set(s, rel);
    }
    ts.forEachChild(n, v);
  })(sf);
}

const dict = JSON.parse(fs.readFileSync(DICT, "utf8"));
const known = new Set(Object.keys(dict.s)), knownP = new Set(dict.p.map(([k]) => k));
// a template is covered by its pattern, or — when its fixed words are in the dictionary — by the word-by-word step
const wordsKnown = (t) => t.split(/\$\{\d\}/).every((part) => { const c = split(ws(part))[1]; return !c || !AR.test(c) || known.has(c); });
const missS = [...strings].filter(([k]) => !known.has(k));
const missP = [...patterns].filter(([k]) => !knownP.has(k) && !wordsKnown(k));

console.log(`interface texts: ${strings.size} strings, ${patterns.size} templates · dictionary: ${known.size} strings, ${knownP.size} patterns`);
console.log(`missing English: ${missS.length} strings, ${missP.length} templates`);
for (const [k, f] of [...missS, ...missP].slice(0, 200)) console.log(`  ${f}: ${k}`);

const i = process.argv.indexOf("--todo");
if (i > 0) {
  const out = process.argv[i + 1];
  fs.writeFileSync(out, [...missS.map(([k]) => `s\t${k}\t`), ...missP.map(([k]) => `p\t${k}\t`)].join("\n") + "\n");
  console.log(`wrote ${out}: fill the third column, then run add.cjs`);
}
if (missS.length + missP.length > MAX) { console.error(`more than ${MAX} interface texts have no English — run tools/i18n/check.cjs --todo and translate them`); process.exit(1); }
