/** Client-side PDF export (true PDF file download) of any on-screen element — keeps Arabic shaping by rasterising via the browser. */
const A4W = 210, A4H = 297;

function filter(node: HTMLElement) {
  if (!(node instanceof HTMLElement)) return true;
  if (node.classList?.contains("no-print") || node.classList?.contains("no-pdf") || node.classList?.contains("toasts")) return false;
  if (node.tagName === "BUTTON") return false;
  return true;
}

async function canvasOf(el: HTMLElement, width?: number) {
  const { toCanvas } = await import("html-to-image");
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
  const landscape = !!opts.landscape || el.scrollWidth > el.clientHeight * 1.6 && el.scrollWidth > 1100;
  const pw = landscape ? A4H : A4W, ph = landscape ? A4W : A4H, m = opts.margin ?? 8;
  const c = await canvasOf(el);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: landscape ? "landscape" : "portrait" });
  const w = pw - 2 * m;
  const pxPerMm = c.width / w;
  const sliceH = Math.floor((ph - 2 * m) * pxPerMm);
  let y = 0, page = 0;
  while (y < c.height) {
    const h = Math.min(sliceH, c.height - y);
    const part = document.createElement("canvas");
    part.width = c.width; part.height = h;
    const g = part.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, part.width, part.height);
    g.drawImage(c, 0, y, c.width, h, 0, 0, c.width, h);
    if (page) pdf.addPage();
    pdf.addImage(part.toDataURL("image/jpeg", 0.9), "JPEG", m, m, w, h / pxPerMm);
    pdf.setFontSize(8); pdf.setTextColor(150);
    pdf.text(`${page + 1}`, pw / 2, ph - 3, { align: "center" });
    y += h; page++;
  }
  pdf.save(safe(filename));
}

const safe = (n: string) => (n || "document").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) + (n.endsWith(".pdf") ? "" : ".pdf");

/** Finds what to export for a button: an explicit target, the open modal body, a print document, or the page content. */
export function pdfTarget(from?: HTMLElement | null): HTMLElement | null {
  const modal = from?.closest(".modal");
  if (modal) return (modal.querySelector(".print-doc") as HTMLElement) || (modal.querySelector(".m-b") as HTMLElement);
  const card = from?.closest(".card");
  const doc = document.querySelector(".content .print-doc") as HTMLElement | null;
  return doc || (card as HTMLElement) || (document.querySelector(".content") as HTMLElement);
}
