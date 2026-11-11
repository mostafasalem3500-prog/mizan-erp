/** Client-side PDF export (true PDF file download) of any on-screen element — keeps Arabic shaping by rasterising via the browser. */
import { sheetMeta } from "./sheet";
const A4W = 210, A4H = 297;

function filter(node: HTMLElement) {
  if (!(node instanceof HTMLElement)) return true;
  if (node.classList?.contains("no-print") || node.classList?.contains("no-pdf") || node.classList?.contains("toasts")) return false;
  if (node.tagName === "BUTTON") return false;
  return true;
}

async function canvasOf(el: HTMLElement, width?: number) {
  const { toCanvas } = await import("html-to-image");
  // print-only headers (company, partner, period) belong in the PDF; scrolling tables are captured in full
  document.body.classList.add("pdf-capture");
  try { return await rawCanvas(toCanvas, el, width); } finally { document.body.classList.remove("pdf-capture"); }
}

async function rawCanvas(toCanvas: any, el: HTMLElement, width?: number) {
  return toCanvas(el, { pixelRatio: 2, backgroundColor: "#ffffff", filter: filter as any, cacheBust: true, skipFonts: true, ...(width ? { width } : {}), style: { margin: "0", boxShadow: "none" } as any });
}

/** Each element is one A4 page (used for the association's A4 forms). */
export async function pagesToPdf(pages: HTMLElement[], filename: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  for (let i = 0; i < pages.length; i++) {
    const c = await canvasOf(pages[i]);
    if (i) pdf.addPage();
    const ratio = c.height / c.width;
    const h = Math.min(A4H, A4W * ratio), w = h / ratio;
    pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", (A4W - w) / 2, 0, w, h);
  }
  pdf.save(safe(filename));
}

/** Long content (reports, invoices, statements): rendered once and sliced into A4 pages with margins. */
export async function elementToPdf(el: HTMLElement, filename: string, opts: { landscape?: boolean; margin?: number } = {}) {
  const { jsPDF } = await import("jspdf");
  // wide on-screen layouts (dialogs on a large monitor) are re-flowed to a readable A4 width before capture
  const prevW = el.style.width, prevMax = el.style.maxWidth;
  const fit = !opts.landscape && el.clientWidth > 1000;
  if (fit) { el.style.width = "960px"; el.style.maxWidth = "960px"; }
  const landscape = !!opts.landscape || (!fit && el.scrollWidth > el.clientHeight * 1.6 && el.scrollWidth > 1100);
  const pw = landscape ? A4H : A4W, ph = landscape ? A4W : A4H, m = opts.margin ?? 8;
  let c: HTMLCanvasElement;
  try { c = await canvasOf(el); } finally { if (fit) { el.style.width = prevW; el.style.maxWidth = prevMax; } }
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  const w = pw - 2 * m;
  const pxPerMm = c.width / w;
  // every page: a footer (establishment · print time · page x of y); continuation pages also get a slim title band
  const HEAD_MM = 7, FOOT_MM = 7;
  const first = Math.floor((ph - 2 * m - FOOT_MM) * pxPerMm), next = Math.floor((ph - 2 * m - FOOT_MM - HEAD_MM) * pxPerMm);
  // never cut through a table row or a line of text: move each cut up to the nearest blank scan line
  const g0 = c.getContext("2d", { willReadFrequently: true })!;
  const blank = (y: number) => { const d = g0.getImageData(0, y, c.width, 1).data; for (let i = 0; i < d.length; i += 8) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) return false; return true; }; // text is dark; hairline borders and zebra fills are not
  const cuts: number[] = [0];
  while (cuts[cuts.length - 1] < c.height) {
    const from = cuts[cuts.length - 1]; let to = from + (cuts.length === 1 ? first : next);
    if (to < c.height) { const floor = from + Math.floor((to - from) * 0.82); for (let y = to; y > floor; y--) if (blank(y)) { to = y; break; } }
    cuts.push(Math.min(to, c.height));
  }
  const pages = cuts.length - 1;
  const meta = sheetMeta();
  const stamp = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  const docTitle = filename.replace(/\s*\d{4}-\d{2}-\d{2}$/, "").replace(/\.pdf$/, "");
  for (let page = 0; page < pages; page++) {
    const y = cuts[page], h = cuts[page + 1] - y;
    const part = document.createElement("canvas");
    part.width = c.width; part.height = h;
    const g = part.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, part.width, part.height);
    g.drawImage(c, 0, y, c.width, h, 0, 0, c.width, h);
    if (page) pdf.addPage();
    const top = m + (page ? HEAD_MM : 0);
    if (page) pdf.addImage(band(c.width, HEAD_MM * pxPerMm, [meta.company || "", `تابع: ${docTitle}`, ""], true).toDataURL("image/png"), "PNG", m, m, w, HEAD_MM);
    pdf.addImage(part.toDataURL("image/jpeg", 0.9), "JPEG", m, top, w, h / pxPerMm);
    pdf.addImage(band(c.width, FOOT_MM * pxPerMm, [meta.company || "ميزان ERP", `صفحة ${page + 1} من ${pages}`, stamp], false).toDataURL("image/png"), "PNG", m, ph - m - FOOT_MM, w, FOOT_MM);
  }
  pdf.save(safe(filename));
}

/** A one-line band drawn by the browser (so Arabic is shaped correctly): right · centre · left, with a hairline. */
function band(width: number, height: number, [right, centre, left]: string[], lineBelow: boolean) {
  const cv = document.createElement("canvas"); cv.width = Math.round(width); cv.height = Math.round(height);
  const g = cv.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = "#cbd5d4"; g.lineWidth = Math.max(1, cv.height / 28);
  const ly = lineBelow ? cv.height - g.lineWidth : g.lineWidth;
  g.beginPath(); g.moveTo(0, ly); g.lineTo(cv.width, ly); g.stroke();
  g.fillStyle = "#5b6b6a"; g.direction = "rtl"; g.textBaseline = "middle";
  g.font = `${Math.round(cv.height * 0.42)}px ${getComputedStyle(document.body).fontFamily}`;
  const y = cv.height / 2 + (lineBelow ? -g.lineWidth : g.lineWidth);
  g.textAlign = "right"; g.fillText(right || "", cv.width - 2, y);
  g.textAlign = "center"; g.fillText(centre || "", cv.width / 2, y);
  g.direction = "ltr"; g.textAlign = "left"; g.fillText(left || "", 2, y); // the print time is plain digits: drawn left-to-right so it is never re-ordered
  return cv;
}

const safe = (n: string) => (n || "document").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) + (n.endsWith(".pdf") ? "" : ".pdf");

/** Finds what to export for a button: an explicit target, the open modal body, a print document, or the page content. */
export function pdfTarget(from?: HTMLElement | null): HTMLElement | null {
  // a button inside a dialog exports that dialog only (e.g. a statement opened from an invoice page)
  const modal = from?.closest(".modal") || (!from ? Array.from(document.querySelectorAll(".modal")).pop() : null);
  if (modal) return (modal.querySelector(".print-doc") as HTMLElement) || (modal.querySelector(".m-b") as HTMLElement);
  const card = from?.closest(".card");
  if (card?.classList.contains("print-doc")) return card as HTMLElement;
  const own = card?.querySelector(".print-doc") as HTMLElement | null;
  const doc = document.querySelector(".content .print-doc") as HTMLElement | null;
  return own || doc || (card as HTMLElement) || (document.querySelector(".content") as HTMLElement);
}
