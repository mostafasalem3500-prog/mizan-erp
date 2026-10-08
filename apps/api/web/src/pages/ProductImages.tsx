/** Product images manager — upload / replace / remove / download images for the selected products (single or bulk, drag-and-drop, camera, paste). */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, Modal, useToast, fileToDataUrl, normalizeAr, matches, SearchBox, confirmDlg } from "../lib";

type Pending = Record<string, string | null>; // productId → new data URL, or null = remove

const baseName = (f: File) => normalizeAr(f.name.replace(/\.[a-z0-9]+$/i, "")).replace(/[_\-.]+/g, " ").trim();

/** Best product match for a file name: exact SKU / barcode first, then exact name, then name containment. */
function matchFile(file: File, products: any[]) {
  const n = baseName(file);
  const compact = n.replace(/\s+/g, "");
  const norm = (v: any) => normalizeAr(v).replace(/[_\-.\s]+/g, "");
  return (
    products.find((p) => p.sku && norm(p.sku) === compact) ||
    products.find((p) => p.barcode && norm(p.barcode) === compact) ||
    products.find((p) => (p.uoms || []).some((u: any) => u.barcode && norm(u.barcode) === compact)) ||
    products.find((p) => normalizeAr(p.name) === n) ||
    (n.length >= 3 ? products.find((p) => normalizeAr(p.name).includes(n) || n.includes(normalizeAr(p.name))) : undefined)
  );
}

export function ProductImagesModal({ products, onClose }: { products: any[]; onClose: (changed?: boolean) => void }) {
  const toast = useToast();
  const [pending, setPending] = useState<Pending>({});
  const [text, setText] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [over, setOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(products.length === 1 ? products[0].id : null);
  const [fillOrder, setFillOrder] = useState(true);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const changes = Object.keys(pending).length;

  const list = useMemo(() => products.filter((p) => matches(p, text, ["name", "sku", "barcode", "category"]) && (!onlyMissing || (!p.image && !pending[p.id]))), [products, text, onlyMissing, pending]);
  const current = (p: any) => (p.id in pending ? pending[p.id] : p.image);

  const setOne = async (id: string, file: File | Blob | null | undefined) => {
    if (!file) return;
    try { const url = await fileToDataUrl(file as File, 600); setPending((x) => ({ ...x, [id]: url })); }
    catch (e: any) { toast(e.message || "تعذّر قراءة الصورة", "err"); }
  };

  /** Many files at once: match by SKU / barcode / name; optionally hand the rest, in order, to products still without an image. */
  const addMany = async (files: FileList | File[]) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return toast("لم تُختر صور", "err");
    if (products.length === 1) return setOne(products[0].id, imgs[0]);
    const used = new Set<string>(Object.keys(pending));
    const next: Pending = {};
    const left: File[] = [];
    for (const f of imgs) {
      const m = matchFile(f, products.filter((p) => !used.has(p.id)));
      if (m) { used.add(m.id); next[m.id] = await fileToDataUrl(f, 600).catch(() => null as any); } else left.push(f);
    }
    const miss: string[] = [];
    if (fillOrder) {
      const targets = products.filter((p) => !used.has(p.id) && !p.image);
      for (const f of left) { const t = targets.shift(); if (!t) { miss.push(f.name); continue; } used.add(t.id); next[t.id] = await fileToDataUrl(f, 600).catch(() => null as any); }
    } else miss.push(...left.map((f) => f.name));
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    setPending((x) => ({ ...x, ...next }));
    setUnmatched(miss);
    toast(`تم تجهيز ${Object.keys(next).length} صورة${miss.length ? ` — ${miss.length} بدون صنف مطابق` : ""}`, miss.length ? "info" : "ok");
  };

  // paste an image (Ctrl+V) into the focused / only product
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      const id = activeId || (list.length === 1 ? list[0].id : null);
      if (!id) return toast("اختر صنفاً أولاً (اضغط على بطاقته) ثم الصق الصورة", "info");
      e.preventDefault(); setOne(id, file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [activeId, list]);

  const save = async () => {
    const items = Object.entries(pending).map(([productId, image]) => ({ productId, image }));
    if (!items.length) return onClose(false);
    setBusy(true);
    let ok = 0; const errs: string[] = [];
    try {
      for (let i = 0; i < items.length; i += 15) {
        setProgress(`${Math.min(i + 15, items.length)} / ${items.length}`);
        const r = await api("/products/images", { body: { items: items.slice(i, i + 15) } });
        ok += r.updated; errs.push(...r.errors.map((e: any) => `${products.find((p) => p.id === e.productId)?.name || e.productId}: ${e.message}`));
      }
      toast(`تم حفظ ${ok} صورة`, "ok");
      if (errs.length) toast(errs.slice(0, 3).join(" · "), "err");
      onClose(true);
    } catch (e: any) { toast(e.message, "err"); setBusy(false); setProgress(""); if (ok) onClose(true); }
  };

  const download = (p: any) => {
    const src = current(p);
    if (!src) return;
    const a = document.createElement("a");
    a.href = src; a.download = `${p.sku || p.name}.jpg`; document.body.appendChild(a); a.click(); a.remove();
  };

  const close = () => { if (changes && !confirmDlg("لديك صور لم تُحفظ — إغلاق دون حفظ؟")) return; onClose(false); };

  return (
    <Modal wide title={`صور الأصناف — ${products.length === 1 ? products[0].name : `${products.length} صنف`}`} onClose={close} footer={<>
      <span className="grow muted small">{changes ? <>تغييرات بانتظار الحفظ: <b>{changes}</b></> : "اختر صوراً أو اسحبها إلى البطاقات"}{progress && <> · جارٍ الحفظ {progress}</>}</span>
      {changes > 0 && <button className="btn ghost" disabled={busy} onClick={() => setPending({})}>تراجع</button>}
      <button className="btn" disabled={busy} onClick={close}>إلغاء</button>
      <button className="btn primary" disabled={busy || !changes} onClick={save}>{busy ? "جارٍ الحفظ…" : `حفظ الصور${changes ? ` (${changes})` : ""}`}</button></>}>
      <div className={"dropzone mb" + (over ? " over" : "")} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); addMany(e.dataTransfer.files); }}>
        <div><b>اسحب الصور هنا</b> أو <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>اختر عدة صور من الجهاز</button></div>
        <div className="small" style={{ marginTop: 4 }}>{products.length > 1 ? "تُطابق تلقائياً باسم الملف مع الرمز (SKU) أو الباركود أو اسم الصنف — مثال: FD-006.jpg" : "أو الصق صورة (Ctrl+V)، أو التقطها بالكاميرا من الجوال"}</div>
        {products.length > 1 && <label className="check small" style={{ justifyContent: "center", marginTop: 6 }}><input type="checkbox" checked={fillOrder} onChange={(e) => setFillOrder(e.target.checked)} /> الصور غير المطابقة تُوزَّع بالترتيب على الأصناف التي بلا صورة</label>}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addMany(e.target.files); e.target.value = ""; }} />
      </div>
      {unmatched.length > 0 && <div className="alert warn small">لم يُعثر على صنف لهذه الملفات: {unmatched.join("، ")} — أفلتها على بطاقة الصنف مباشرة.</div>}
      {products.length > 6 && <div className="toolbar"><SearchBox value={text} onChange={setText} placeholder="بحث في الأصناف المحددة" /><label className="check"><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> بدون صورة فقط</label><span className="muted small">{list.length} صنف</span></div>}
      <div className="img-grid">
        {list.map((p) => {
          const src = current(p);
          const changed = p.id in pending;
          return (
            <div key={p.id} className={"img-card" + (activeId === p.id ? " sel" : "") + (dragId === p.id ? " drag" : "")} onClick={() => setActiveId(p.id)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragId(p.id); }} onDragLeave={() => setDragId(null)}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragId(null); setOne(p.id, [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"))); }}>
              <div className="ph">{src ? <img src={src} alt="" /> : "🖼"}{changed && <span className={"badge new " + (pending[p.id] ? "green" : "red")}>{pending[p.id] ? "جديدة" : "ستُحذف"}</span>}</div>
              <div className="nm" title={p.name}>{p.name}</div>
              <div className="sku num">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}</div>
              <div className="acts">
                <label className="btn sm" title="رفع صورة">⬆ رفع<input type="file" accept="image/*" hidden onChange={(e) => { setOne(p.id, e.target.files?.[0]); e.target.value = ""; }} /></label>
                <label className="btn sm" title="التقاط بالكاميرا">📷<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { setOne(p.id, e.target.files?.[0]); e.target.value = ""; }} /></label>
                {src && <button type="button" className="btn sm" title="تنزيل الصورة" onClick={(e) => { e.stopPropagation(); download(p); }}>⬇</button>}
                {(src || changed) && <button type="button" className="btn sm ghost" title={changed ? "تراجع" : "حذف الصورة"} onClick={(e) => { e.stopPropagation(); setPending((x) => { const n = { ...x }; if (p.id in n) delete n[p.id]; else n[p.id] = null; return n; }); }}>{changed ? "↺" : "✕"}</button>}
              </div>
            </div>
          );
        })}
        {!list.length && <div className="muted">لا أصناف مطابقة</div>}
      </div>
    </Modal>
  );
}
