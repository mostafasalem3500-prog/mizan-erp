/**
 * Interface language. The screens are written in Arabic; in English mode every text that reaches the page is looked up
 * in a dictionary on its way to the DOM (see jsx-runtime.ts), so no screen has to be rewritten. What is not in the
 * dictionary — names, descriptions and other data the user typed — stays as it is.
 *
 * Lookup order for one string: the whole text, the text without its surrounding punctuation, a sentence pattern with
 * variable parts («تم حفظ {0} صنف»), the text without a code or number before or after it, then each Arabic run on its
 * own. The dictionary is built and checked with tools/i18n, which normalises text the same way.
 */
export type Lang = "ar" | "en";
const KEY = "mz_lang";
const read = (): Lang => {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "en" || q === "ar") { localStorage.setItem(KEY, q); return q; }
    return localStorage.getItem(KEY) === "en" ? "en" : "ar";
  } catch { return "ar"; }
};
/** Mutable on purpose: the edition is only known after the configuration loads. */
export const I18N: { lang: Lang; on: boolean; allowed: boolean } = { lang: read(), on: false, allowed: true };
export const isEn = () => I18N.on;
export const locale = () => (I18N.on ? "en-GB" : "ar-SA-u-nu-latn-ca-gregory");
export function setLang(l: Lang) { try { localStorage.setItem(KEY, l); } catch { /* private mode */ } const u = new URL(location.href); u.searchParams.delete("lang"); location.replace(u.toString()); }

let S: Record<string, string> = {};
let P: [RegExp, string, number][] = [];
const cache = new Map<string, string>();
const AR = /[ء-ي]/;
const AR_ALL = /[ء-ي]/g;
const EDGE = /[^\p{L}\p{N}\p{M}]/u;
const PAIRS: [string, string][] = [["(", ")"], ["«", "»"], ["[", "]"], ["“", "”"]];
const count = (s: string, c: string) => s.split(c).length - 1;
const PUNCT: Record<string, string> = { "،": ",", "؛": ";", "؟": "?", "«": "“", "»": "”", "←": "→", "→": "←", "٪": "%" };
const punct = (s: string) => s.replace(/[،؛؟«»←→٪]/g, (c) => PUNCT[c]);
const flip = (s: string) => s.replace(/[‹›]/g, (c) => (c === "‹" ? "›" : "‹"));
/** A chevron on its own (the menu's ‹, the « ‹ » between section and screen) points the other way when the page reads
 *  left to right. Inside a sentence («‹ السابق») the browser already mirrors ‹ › with the text direction, and an arrow
 *  between two dates or numbers is laid out left to right anyway, so those are left alone. */
const ARROWS = /^[\s‹›]+$/;

function split(body: string): [string, string, string] {
  let a = 0, b = body.length;
  while (a < b && EDGE.test(body[a])) a++;
  while (b > a && EDGE.test(body[b - 1])) b--;
  for (let moved = true; moved;) {
    moved = false;
    for (const [o, c] of PAIRS) {
      const core = body.slice(a, b);
      if (b < body.length && body[b] === c && count(core, o) > count(core, c)) { b++; moved = true; }
      else if (a > 0 && body[a - 1] === o && count(core, c) > count(core, o)) { a--; moved = true; }
    }
    const core = body.slice(a, b);
    if (b < body.length && body[b] === '"' && count(core, '"') % 2 === 1) { b++; moved = true; }
    else if (a > 0 && body[a - 1] === '"' && count(core, '"') % 2 === 1) { a--; moved = true; }
  }
  return [body.slice(0, a), body.slice(a, b), body.slice(b)];
}

function lookup(body: string, depth: number): string | undefined {
  const hit = S[body]; if (hit !== undefined) return hit;
  const [pre, core, suf] = split(body);
  if (core !== body) { const h = S[core]; if (h !== undefined) return punct(pre) + h + punct(suf); }
  if (depth < 3) {
    const letters = (body.match(AR_ALL) || []).length;
    for (const [re, en, fixed] of P) {
      const m = re.exec(body);
      if (!m) continue;
      // values may be data (a name, a description) and stay as they are — but only when the fixed text of the pattern
      // is a real part of the sentence; otherwise a short pattern would claim any text that happens to contain its words
      let whole = true;
      const out = en.replace(/\{(\d)\}/g, (_, i) => { const g = m[Number(i) + 1] ?? ""; if (!AR.test(g)) return g; const t = translate(g, depth + 1); if (AR.test(t)) whole = false; return t; });
      if (whole || fixed >= letters * 0.3) return out;
    }
  }
  // last, a code or number written before or after known text: «5203 رواتب وأجور», «الفروع 3»
  const ht = /^([^ء-ي]*\s)?([\s\S]*?[ء-ي][\s\S]*?)(\s[^ء-ي]*)?$/.exec(body);
  if (ht && (ht[1] || ht[3])) { const mid = ht[2], h = S[mid] ?? (split(mid)[1] !== mid ? lookup(mid, depth) : undefined); if (h !== undefined) return (ht[1] || "") + h + (ht[3] || ""); }
  return undefined;
}

function translate(s: string, depth = 0): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  const body = m[2].replace(/\s+/g, " ");
  let out = lookup(body, depth);
  if (out === undefined) {
    // piece by piece: text built by joining words with values («فاتورة 12 — مرحّلة»)
    let all = true;
    out = body.replace(/[ء-ْٰ-ۓ]+(?:[  ][ء-ْٰ-ۓ]+)*/g, (run) => { const h = S[run]; if (h === undefined) all = false; return h ?? run; });
    if (all) out = punct(out);
  }
  return m[1] + out + m[3];
}

/** Arabic interface text → the current interface language. Text with no Arabic in it is returned untouched. */
export function tr(s: string): string {
  if (!I18N.on) return s;
  if (!AR.test(s)) return ARROWS.test(s) ? flip(s) : s;
  let r = cache.get(s);
  if (r === undefined) { if (cache.size > 30000) cache.clear(); r = translate(s); cache.set(s, r); }
  return r;
}

const ATTRS = ["placeholder", "title", "aria-label", "alt", "label"];
const SHARED = ["title", "placeholder", "aria-label", "alt"];
function kids(c: any): any {
  if (typeof c === "string") return tr(c);
  // «تم حفظ {n} صنف» arrives as ["تم حفظ ", 5, " صنف"]: read as one sentence first, so its pattern can match
  if (Array.isArray(c) && c.length > 1 && c.every((v) => typeof v === "string" || typeof v === "number") && c.some((v) => typeof v === "string" && AR.test(v))) {
    const t = tr(c.join(""));
    if (!AR.test(t)) return t;
  }
  if (Array.isArray(c)) { let copy: any[] | null = null; for (let i = 0; i < c.length; i++) { const v = c[i]; if (typeof v === "string" || Array.isArray(v)) { const t = kids(v); if (t !== v) { copy ??= c.slice(); copy[i] = t; } } } return copy ?? c; }
  return c;
}
/**
 * Props with their visible text translated; the same object comes back when nothing changed. DOM elements get every
 * text attribute. Components get their text children and the attributes they hand on to the DOM as they are, because
 * a library component (a router link) builds its DOM element outside this factory.
 */
export function trProps(props: any, host: boolean): any {
  if (!props) return props;
  let out: any = null;
  const c = props.children;
  if (typeof c === "string" || Array.isArray(c)) { const t = kids(c); if (t !== c) (out ??= { ...props }).children = t; }
  for (const a of host ? ATTRS : SHARED) { const v = props[a]; if (typeof v === "string" && AR.test(v)) (out ??= { ...props })[a] = tr(v); }
  return out ?? props;
}

/** Called once before the first render. `allowed` is false for editions that have no English interface. */
export async function startI18n(allowed: boolean) {
  I18N.allowed = allowed;
  if (I18N.lang !== "en" || !allowed) return;
  const d: { s: Record<string, string>; p: [string, string][] } = (await import("./en.json")).default as any;
  S = d.s;
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // a pattern with little fixed text («{0} يوم») only accepts values with no Arabic in them, so it cannot swallow a name
  // most specific first: more fixed Arabic text and fewer variable parts win
  const score = (x: [RegExp, string, number]) => x[2] - 4 * (x[0].source.match(/\(\[/g) || []).length;
  // a value may hold Arabic (a name) only where fixed words mark where it starts and ends: not in a short pattern, and not
  // as the first of two values written side by side («${1}${2}»), which could otherwise split any text anywhere
  const NUM = "([^\\u0621-\\u064A]*?)", ANY = "([\\s\\S]*?)"; // a value may be empty: «${x ? "، …" : ""}»
  P = d.p.map(([k, en]) => {
    const parts = k.split(/\$\{\d\}/), fixed = (parts.join("").match(AR_ALL) || []).length, n = parts.length - 1;
    let src = "^" + esc(parts[0]);
    for (let i = 1; i <= n; i++) src += (fixed < 5 || (i < n && parts[i] === "") ? NUM : ANY) + esc(parts[i]); // of two values side by side, the first is a number
    return [new RegExp(src + "$"), en, fixed] as [RegExp, string, number];
  })
    .sort((x, y) => score(y) - score(x) || y[0].source.length - x[0].source.length);
  I18N.on = true;
  const h = document.documentElement; h.lang = "en"; h.dir = "ltr";
  // text that never passes through a component: the tab title and the browser's own dialogs
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "title");
  if (desc?.set && desc.get) Object.defineProperty(document, "title", { configurable: true, get() { return desc.get!.call(document); }, set(v: string) { desc.set!.call(document, tr(String(v))); } });
  document.title = document.title;
  for (const k of ["confirm", "alert", "prompt"] as const) { const f = (window as any)[k].bind(window); (window as any)[k] = (msg?: any, ...rest: any[]) => f(typeof msg === "string" ? tr(msg) : msg, ...rest); }
}
