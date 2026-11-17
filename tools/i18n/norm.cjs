// Normalisation shared by the i18n tools: the same rules as apps/api/web/src/i18n/index.ts (keep the two in step).
const EDGE = /[^\p{L}\p{N}\p{M}]/u;
const PAIRS = [["(", ")"], ["«", "»"], ["[", "]"], ["“", "”"]];
const count = (s, c) => s.split(c).length - 1;
function split(body) {
  let a = 0, b = body.length;
  while (a < b && EDGE.test(body[a])) a++;
  while (b > a && EDGE.test(body[b - 1])) b--;
  // keep brackets that close or open something inside the core
  for (let moved = true; moved;) { moved = false;
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
const ws = (s) => s.replace(/\s+/g, " ").trim();
module.exports = { split, ws };
