import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useLocation } from "react-router-dom";

// ─── api ───────────────────────────────────────────────────────────────────
export const session = {
  get token() { return localStorage.getItem("mz_token"); },
  set token(v: string | null) { v ? localStorage.setItem("mz_token", v) : localStorage.removeItem("mz_token"); },
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api" + path, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, "لا يوجد اتصال بالخادم — تحقق من الإنترنت", "OFFLINE");
  }
  if (opts.raw) return res as any;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && session.token && !path.startsWith("/auth/login")) {
      session.token = null;
      window.dispatchEvent(new Event("mz-logout"));
    }
    throw new ApiError(res.status, data.message || `HTTP ${res.status}`, data.code);
  }
  return data;
}

export const q = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};

// ─── formatting ────────────────────────────────────────────────────────────
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });
export const money = (v: any, blankZero = false) => { const n = Number(v || 0); if (blankZero && n === 0) return ""; return nf.format(n); };
export const qty = (v: any) => nf0.format(Number(v || 0));
export const Money = ({ v, blankZero, sign }: { v: any; blankZero?: boolean; sign?: boolean }) => {
  const n = Number(v || 0);
  return <span className={"num" + (sign ? (n < 0 ? " neg-val" : n > 0 ? " pos-val" : "") : "")}>{blankZero && n === 0 ? "" : nf.format(n)}</span>;
};
export const today = () => { const d = new Date(Date.now() + 3 * 3600 * 1000); return d.toISOString().slice(0, 10); };
export const fmtDate = (d: any) => (d ? String(d).slice(0, 10) : "");
export const fmtDT = (d: any) => (d ? new Date(d).toLocaleString("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeStyle: "short" }) : "");
export const monthStart = () => today().slice(0, 7) + "-01";
/** Calendar month shift that clamps to the target month's last day (31 Jan + 1 → 28/29 Feb, never 3 Mar). */
export const addMonths = (s: string, n: number) => {
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)) - 1 + n, day = Number(s.slice(8, 10));
  const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(day, last))).toISOString().slice(0, 10);
};
export const yearStart = () => today().slice(0, 4) + "-01-01";

export const KIND_AR: Record<string, string> = { QUOTATION: "عرض سعر", ORDER: "أمر", INVOICE: "فاتورة", CREDIT_NOTE: "إشعار دائن", DEBIT_NOTE: "إشعار مدين" };
export const STATUS_AR: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", CANCELLED: "ملغى", CONVERTED: "محوّل", UNPAID: "غير مسدد", PARTIAL: "مسدد جزئياً", PAID: "مسدد", OPEN: "مفتوح", CLOSED: "مغلق", LOCKED: "مقفل", ACTIVE: "نشط", FULLY_DEPRECIATED: "مهلك بالكامل", DISPOSED: "مستبعد", FILED: "مقدَّم", SETTLED: "مسدد" };
export const ZATCA_AR: Record<string, string> = { NOT_REQUIRED: "مرحلة أولى (QR)", NOT_ONBOARDED: "بانتظار الربط", PENDING: "بانتظار الإرسال", REPORTED: "مُبلَّغ", CLEARED: "معتمد", WARNING: "مقبول بتحذير", REJECTED: "مرفوض", FAILED: "فشل الإرسال" };
export const JTYPE_AR: Record<string, string> = { MANUAL: "قيد يدوي", OPENING: "افتتاحي", CLOSING: "إقفال", SALES: "مبيعات", SALES_RETURN: "مرتجع مبيعات", PURCHASE: "مشتريات", PURCHASE_RETURN: "مرتجع مشتريات", RECEIPT: "سند قبض", PAYMENT: "سند صرف", EXPENSE: "مصروف", POS: "نقاط بيع", POS_CLOSE: "إغلاق وردية", STOCK: "مخزون", DEPRECIATION: "إهلاك", ASSET: "أصول", VAT_SETTLEMENT: "تسوية ضريبة", REVERSAL: "قيد عكسي", CHEQUE: "شيكات", PAYROLL: "رواتب" };
export const TAX_AR: Record<string, string> = { S: "خاضع 15%", Z: "نسبة صفر", X: "صادرات", E: "معفى", O: "خارج النطاق", IM: "استيراد (جمارك)", RC: "احتساب عكسي" };
export const TYPE_AR: Record<string, string> = { ASSET: "أصول", LIABILITY: "خصوم", EQUITY: "حقوق ملكية", REVENUE: "إيرادات", EXPENSE: "مصروفات" };
export const METHOD_AR: Record<string, string> = { CASH: "نقدي", CARD: "شبكة/بطاقة", BANK: "تحويل بنكي", CHEQUE: "شيك", CREDIT: "آجل" };

export const badgeColor = (s: string) => ({ POSTED: "green", PAID: "green", REPORTED: "green", CLEARED: "green", ACTIVE: "green", OPEN: "green", SETTLED: "green", DONE: "green", IGNORED: "gray", DRAFT: "gray", UNPAID: "red", REJECTED: "red", FAILED: "red", CANCELLED: "red", PARTIAL: "amber", PENDING: "amber", WARNING: "amber", NOT_ONBOARDED: "amber", CONVERTED: "blue", CLOSED: "blue", LOCKED: "blue", NOT_REQUIRED: "teal", FILED: "blue" } as any)[s] || "gray";

// ─── toast ─────────────────────────────────────────────────────────────────
type Toast = { id: number; msg: string; kind: "ok" | "err" | "info" };
const ToastCtx = createContext<(msg: string, kind?: Toast["kind"]) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = (msg: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, msg, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === "err" ? 6000 : 3200);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{list.map((t) => <div key={t.id} className={"toast " + t.kind}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** runs an async action with toast on error */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg, "ok");
      return r;
    } catch (e: any) {
      toast(e.message || "حدث خطأ", "err");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

export function useFetch<T = any>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api<T>(path).then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [path, tick, ...deps]);
  return { data, loading, error, reload: () => setTick((t) => t + 1), setData };
}

// ─── UI primitives ─────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, wide, narrow }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; narrow?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, []);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "") + (narrow ? " narrow" : "")}>
        <div className="m-h"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose}>✕</button></div>
        <div className="m-b">{children}</div>
        {footer && <div className="m-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, span2, span3, hint }: { label?: string; children: React.ReactNode; span2?: boolean; span3?: boolean; hint?: string }) {
  return <div className={"field" + (span2 ? " span2" : "") + (span3 ? " span3" : "")}>{label && <label>{label}</label>}{children}{hint && <span className="hint">{hint}</span>}</div>;
}

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={"input " + (p.className || "")} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={"input " + (p.className || "")} />;
export const NumInput = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input type="number" step="any" {...p} className={"input num " + (p.className || "")} onFocus={(e) => e.target.select()} />;

export function Badge({ s, map }: { s: string; map?: Record<string, string> }) {
  return <span className={"badge " + badgeColor(s)}>{(map || STATUS_AR)[s] || s}</span>;
}

export function Empty({ text = "لا توجد بيانات" }: { text?: string }) { return <div className="empty">{text}</div>; }
export function Loading() { return <div className="empty"><span className="spinner" /></div>; }

export function Tabs({ tabs, value, onChange }: { tabs: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return <div className="tabs">{tabs.map((t) => <button key={t.key} className={value === t.key ? "active" : ""} onClick={() => onChange(t.key)}>{t.label}</button>)}</div>;
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const set = (f: string, t: string) => onChange(f, t);
  const td = today();
  return (
    <div className="row">
      <Input type="date" value={from} onChange={(e) => set(e.target.value, to)} style={{ width: 150 }} />
      <span className="muted">إلى</span>
      <Input type="date" value={to} onChange={(e) => set(from, e.target.value)} style={{ width: 150 }} />
      <button className="btn sm ghost" onClick={() => set(monthStart(), td)}>هذا الشهر</button>
      <button className="btn sm ghost" onClick={() => set(addMonths(monthStart(), -1), addMonths(monthStart(), 0).slice(0, 8) + "01" > td ? td : addMonths(monthStart(), 0))}>الشهر السابق</button>
      <button className="btn sm ghost" onClick={() => set(yearStart(), td)}>هذه السنة</button>
    </div>
  );
}

export function exportExcel(rows: any[], name: string, sheet = "Sheet1") {
  const ws = XLSX.utils.json_to_sheet(rows);
  if (!ws["!views"]) ws["!views"] = [{ rightToLeft: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, `${name}.xlsx`);
}

export function ExportBtn({ rows, name }: { rows: any[] | (() => any[]); name: string }) {
  return <button className="btn sm" onClick={() => exportExcel(typeof rows === "function" ? rows() : rows, name)}>⬇ Excel</button>;
}
export function PrintBtn() { return <button className="btn sm" onClick={() => window.print()}>🖨 طباعة</button>; }

/** searchable picker (partners / products / accounts) */
export function Picker<T extends { id: string }>({ value, onChange, fetcher, label, placeholder, renderItem, allowClear = true, autoFocus, onCreate }: { value: T | null; onChange: (v: T | null) => void; fetcher: (q: string) => Promise<T[]>; label: (t: T) => string; placeholder?: string; renderItem?: (t: T) => React.ReactNode; allowClear?: boolean; autoFocus?: boolean; onCreate?: () => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<T[]>([]);
  const [hl, setHl] = useState(0);
  const timer = useRef<any>(null);
  useEffect(() => { if (!open) return; clearTimeout(timer.current); timer.current = setTimeout(() => fetcher(text).then(setList).catch(() => setList([])), 150); }, [text, open]);
  if (value && !open) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <div className="input" style={{ flex: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }} onClick={() => { setOpen(true); setText(""); }}>
          <span>{label(value)}</span>
          {allowClear && <span className="muted" onClick={(e) => { e.stopPropagation(); onChange(null); }}>✕</span>}
        </div>
      </div>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <input className="input" autoFocus={autoFocus || open} placeholder={placeholder || "ابحث..."} value={text} onChange={(e) => { setText(e.target.value); setOpen(true); setHl(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") setHl((h) => Math.min(h + 1, list.length - 1)); if (e.key === "ArrowUp") setHl((h) => Math.max(h - 1, 0)); if (e.key === "Enter" && list[hl]) { e.preventDefault(); onChange(list[hl]); setOpen(false); } }} />
      {open && (
        <div className="suggest">
          {list.map((t, i) => <div key={t.id} className={i === hl ? "hl" : ""} onMouseDown={() => { onChange(t); setOpen(false); }}>{renderItem ? renderItem(t) : label(t)}</div>)}
          {!list.length && <div className="muted">لا نتائج</div>}
          {onCreate && <div style={{ borderTop: "1px solid var(--border)", color: "var(--primary)" }} onMouseDown={onCreate}>＋ إضافة جديد</div>}
        </div>
      )}
    </div>
  );
}

export const partnerFetcher = (role?: "CUSTOMER" | "SUPPLIER") => (s: string) => api(`/partners${q({ q: s, role, limit: 20 })}`);
export const productFetcher = (s: string) => api(`/products${q({ q: s, limit: 20 })}`);
export const accountFetcher = (filter?: (a: any) => boolean) => async (s: string) => { const r = await api("/accounts"); return r.rows.filter((a: any) => !a.isGroup && a.isActive && (!filter || filter(a)) && (!s || a.code.includes(s) || a.nameAr.includes(s))).slice(0, 30); };

export function useCompanyContext() { return useContext(AppCtx); }
export const AppCtx = createContext<{ me: any; reload: () => void; can: (p: string) => boolean }>({ me: null, reload: () => undefined, can: () => false });

export function useDebounce<T>(v: T, ms = 300) { const [d, setD] = useState(v); useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v]); return d; }

export function confirmDlg(msg: string) { return window.confirm(msg); }

export function BarChart({ data, keys, labels, colors }: { data: any[]; keys: string[]; labels: (d: any) => string; colors?: string[] }) {
  const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => Math.abs(Number(d[k] || 0)))));
  return (
    <div className="bar-chart bars2">
      {data.map((d, i) => (
        <div className="bar" key={i} title={keys.map((k) => `${k}: ${money(d[k])}`).join(" | ")}>
          {keys.map((k, j) => <div key={k} style={{ height: `${(Math.abs(Number(d[k] || 0)) / max) * 100}%`, background: colors?.[j] || (j ? "var(--accent)" : "var(--primary)"), opacity: Number(d[k]) < 0 ? 0.4 : 1 }} />)}
          <span className="lbl">{labels(d)}</span>
        </div>
      ))}
    </div>
  );
}

export const useLocalState = <T,>(key: string, init: T) => {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : init; } catch { return init; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }, [v]);
  return [v, setV] as const;
};

export function fileToDataUrl(file: File, maxPx = 512): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    const r = new FileReader();
    r.onload = () => { img.src = r.result as string; };
    r.onerror = rej;
    img.onerror = () => rej(new Error("تعذّر قراءة الصورة — تأكد أنها JPG أو PNG أو WEBP"));
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // transparent PNGs → white, not black, in JPEG
      g.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", 0.82));
    };
    r.readAsDataURL(file);
  });
}

export function useMemoOnce<T>(f: () => T) { return useMemo(f, []); }

/** Search box state that can be pre-filled from ?q= (used by the global search to land on a filtered list). */
export function useUrlSearch(): [string, (v: string) => void] {
  const loc = useLocation();
  const [v, setV] = useState(() => new URLSearchParams(loc.search).get("q") || "");
  useEffect(() => { const x = new URLSearchParams(loc.search).get("q"); if (x !== null) setV(x); }, [loc.search]);
  return [v, setV];
}

// ─── list filtering, sorting & search helpers (shared by every list screen) ──
/** Arabic-insensitive normalisation: hamza forms, taa marbuta, alef maqsura, tatweel, diacritics, Arabic-Indic digits. */
export const normalizeAr = (v: any) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .trim();

/** True when every word of `query` appears in at least one of the given fields. */
export function matches(row: any, query: string, keys: (string | ((r: any) => any))[]) {
  const words = normalizeAr(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = keys.map((k) => normalizeAr(typeof k === "function" ? k(row) : row?.[k])).join(" | ");
  return words.every((w) => hay.includes(w));
}

export type SortState = { key: string; dir: 1 | -1 } | null;
/** Client-side sorting; numeric-aware, Arabic collation for text. */
export function useSorted<T>(rows: T[] | null | undefined, initial: SortState = null) {
  const [sort, setSort] = useState<SortState>(initial);
  const sorted = useMemo(() => {
    if (!rows) return [] as T[];
    if (!sort) return rows;
    const col = new Intl.Collator("ar", { numeric: true });
    const get = (r: any) => r?.[sort.key];
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === "") return 1;
      if (y === null || y === undefined || y === "") return -1;
      const nx = Number(x), ny = Number(y);
      if (!Number.isNaN(nx) && !Number.isNaN(ny) && typeof x !== "boolean") return (nx - ny) * sort.dir;
      return col.compare(String(x), String(y)) * sort.dir;
    });
  }, [rows, sort]);
  const toggle = (key: string) => setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  return { sorted, sort, toggle };
}

/** Sortable header cell. */
export function Th({ k, s, children, n }: { k: string; s: { sort: SortState; toggle: (k: string) => void }; children: React.ReactNode; n?: boolean }) {
  const on = s.sort?.key === k;
  return <th className={"sortable" + (n ? " n" : "") + (on ? " on" : "")} onClick={() => s.toggle(k)} title="فرز">{children}<span className="sort-ic">{on ? (s.sort!.dir === 1 ? "▲" : "▼") : "↕"}</span></th>;
}

export function SearchBox({ value, onChange, placeholder = "بحث", autoFocus, width }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; width?: number }) {
  return (
    <div className="search" style={width ? { minWidth: width } : undefined}>
      <span className="ic">🔍</span>
      <Input placeholder={placeholder} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }} />
      {value && <button type="button" className="search-x" title="مسح" onClick={() => onChange("")}>✕</button>}
    </div>
  );
}

/** "Showing n of m" + clear-filters link shown when any filter is active. */
export function FilterInfo({ shown, total, active, onClear }: { shown: number; total: number; active: boolean; onClear: () => void }) {
  if (!active) return <span className="muted small">{total} سجل</span>;
  return <span className="filter-info small"><b className="num">{shown}</b>{shown !== total ? <> من <span className="num">{total}</span></> : " نتيجة"} <button type="button" className="link-btn" onClick={onClear}>مسح الفلاتر ✕</button></span>;
}

/** Simple text-filter state for client-side lists; returns filtered rows + helpers. */
export function useListSearch<T>(rows: T[] | null | undefined, keys: (string | ((r: any) => any))[], extra?: (r: T) => boolean, deps: any[] = []) {
  const [text, setText] = useState("");
  const filtered = useMemo(() => (rows || []).filter((r) => matches(r, text, keys) && (!extra || extra(r))), [rows, text, ...deps]);
  return { text, setText, filtered, total: rows?.length || 0 };
}

/** Where a journal line came from → in-app link (documents, vouchers, expenses…). */
export function sourceLink(r: { sourceType?: string; sourceId?: string; srcNumber?: string; srcDir?: string }): string | null {
  switch (r.sourceType) {
    case "INVOICE": return r.sourceId ? `/doc/${r.sourceId}` : null;
    case "PAYMENT": return r.srcNumber ? `/${r.srcDir === "OUT" ? "vouchers" : "receipts"}?q=${encodeURIComponent(r.srcNumber)}` : null;
    case "EXPENSE": return r.srcNumber ? `/expenses?q=${encodeURIComponent(r.srcNumber)}` : null;
    default: return null;
  }
}

/** Optional period filter (empty = all dates) with quick presets. */
export function PeriodFilter({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const td = today();
  return (
    <div className="row" style={{ gap: 6 }}>
      <Input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} style={{ width: 145 }} title="من تاريخ" />
      <span className="muted">—</span>
      <Input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} style={{ width: 145 }} title="إلى تاريخ" />
      <Select value="" onChange={(e) => { const v = e.target.value; if (v === "m") onChange(monthStart(), td); if (v === "pm") { const s = addMonths(monthStart(), -1); onChange(s, new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0)).toISOString().slice(0, 10)); } if (v === "q") onChange(addMonths(td, -3), td); if (v === "y") onChange(yearStart(), td); if (v === "all") onChange("", ""); }} style={{ width: 120 }}>
        <option value="">فترة سريعة…</option><option value="m">هذا الشهر</option><option value="pm">الشهر السابق</option><option value="q">آخر 3 أشهر</option><option value="y">هذه السنة</option><option value="all">كل التواريخ</option>
      </Select>
    </div>
  );
}
