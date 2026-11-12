/**
 * Accessibility safety net for the whole app (WCAG 2.1 AA): every form control gets an accessible name and every
 * scrollable table can be reached and scrolled from the keyboard. Screens are built from many components, so the
 * names are derived here from what is already on screen: the field label, the column header, the placeholder.
 */
const TYPE_AR: Record<string, string> = { date: "التاريخ", month: "الشهر", time: "الوقت", number: "رقم", search: "بحث", file: "ملف", email: "البريد الإلكتروني", password: "كلمة المرور", tel: "رقم الجوال", color: "اللون", checkbox: "اختيار", radio: "اختيار" };
const clean = (s: string | null | undefined) => String(s || "").replace(/\s+/g, " ").replace(/[*:：]+$/, "").trim().slice(0, 60);
function nameFor(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const ph = clean((el as HTMLInputElement).placeholder); if (ph) return ph;
  const title = clean(el.title); if (title) return title;
  // a cell in a grid: the header of its column
  const td = el.closest("td"); const table = td?.closest("table");
  if (td && table) { const th = table.querySelectorAll("thead th")[(td as HTMLTableCellElement).cellIndex]; const t = clean(th?.textContent); if (t) return t; }
  const field = el.closest(".field"); const fl = clean(field?.querySelector("label")?.textContent); if (fl) return fl;
  const type = (el as HTMLInputElement).type;
  // a from–to pair of dates
  if (type === "date" || type === "month") { const sib = [...(el.parentElement?.querySelectorAll(`input[type=${type}]`) || [])]; if (sib.length === 2) return (sib[0] === el ? "من " : "إلى ") + (type === "date" ? "تاريخ" : "شهر"); }
  // the text just before it
  let p: ChildNode | null = el.previousSibling; while (p && !clean(p.textContent)) p = p.previousSibling; const before = clean(p?.textContent); if (before && before.length <= 30) return before;
  if (el.tagName === "SELECT") { const o = clean((el as HTMLSelectElement).options[0]?.textContent); if (o) return o; return "اختيار"; }
  if (el.tagName === "TEXTAREA") return "نص";
  return TYPE_AR[type] || "حقل إدخال";
}
function patch(root: ParentNode) {
  root.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea").forEach((el) => {
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.closest("label") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) return;
    el.setAttribute("aria-label", nameFor(el));
  });
  root.querySelectorAll<HTMLElement>(".table-wrap, .suggest, pre").forEach((el) => {
    if (el.hasAttribute("tabindex")) return;
    el.setAttribute("tabindex", "0");
    if (el.classList.contains("table-wrap")) { el.setAttribute("role", "region"); if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", clean(el.closest(".card")?.querySelector("h3, h2")?.textContent) || "جدول"); }
  });
}
export function startA11y() {
  let queued = false;
  const run = () => { queued = false; patch(document.body); };
  new MutationObserver(() => { if (!queued) { queued = true; (window.requestIdleCallback || ((f: any) => setTimeout(f, 80)))(run, { timeout: 400 } as any); } }).observe(document.body, { childList: true, subtree: true });
  run();
}
