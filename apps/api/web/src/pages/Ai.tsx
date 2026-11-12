/** AI accounting assistant: chat, attachments, a plan card with the real journal entry, confirm before posting. */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CUR } from "../shared/country";
import { api, session, useFetch, money, Loading, Field, Input, useToast, useCompanyContext, fmtDT, confirmDlg } from "../lib";

const SUGGEST = (): [string, string, string[]][] => [
  ["📝", "سجّل عملية", [`فاتورة مياه المكتب بقيمة 200 ${CUR()} شامل الضريبة من المورد شركة المياه الوطنية، دُفعت نقداً`, "إيداع نقدي في البنك 10,000"]],
  ["📊", "اسأل عن أرقامك", ["ملخص هذا الشهر", "قارن هذا الشهر بالشهر الماضي", "من لم يسدد؟"]],
  ["🧠", "تحليل وتقارير", ["حلّل الوضع المالي", "اكتب تقريراً للإدارة", "افحص الدفاتر"]],
  ["🎓", "تعلّم واسأل", ["كيف أعالج المصروفات المدفوعة مقدماً؟", "ماذا تستطيع أن تفعل؟"]],
];
/** ZATCA tax-invoice QR (base64 TLV: 1 seller, 2 VAT number, 3 timestamp, 4 total, 5 VAT) read from the image in the browser. */
async function readZatcaQr(file: File): Promise<any | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    const { default: jsQR } = await import("jsqr");
    const bmp = await createImageBitmap(file);
    for (const max of [1600, 1000, 2400]) {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      const cx = cv.getContext("2d")!; cx.drawImage(bmp, 0, 0, cv.width, cv.height);
      const code = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
      if (!code?.data) continue;
      const bytes = Uint8Array.from(atob(code.data.trim()), (c) => c.charCodeAt(0));
      const out: Record<number, string> = {}; const dec = new TextDecoder("utf-8");
      for (let i = 0; i + 2 <= bytes.length;) { const tag = bytes[i], len = bytes[i + 1]; out[tag] = dec.decode(bytes.slice(i + 2, i + 2 + len)); i += 2 + len; }
      if (!out[4] || isNaN(Number(out[4]))) return null;
      return { seller: out[1] || "", vat: out[2] || "", date: (out[3] || "").slice(0, 10), total: Number(out[4]), vatAmount: Number(out[5] || 0) };
    }
  } catch { /* not a ZATCA QR */ }
  return null;
}
const readB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
async function openFile(id: string) {
  const r = await fetch(`/api/attachments/file/${id}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new Error("تعذّر فتح المرفق");
  const url = URL.createObjectURL(await r.blob()); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
/** The assistant's answer: **bold**, [text](/in-app-link), «- » and «1. » lists, and | tables |. Only in-app links are made clickable. */
const inline = (ln: string) => ln.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(\/[^)\s]*\))/).map((p, j) => { const m = p.match(/^\[([^\]]+)\]\((\/[^)\s]*)\)$/); return m ? <Link key={j} to={m[2]}>{m[1]}</Link> : p.startsWith("**") && p.endsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : p; });
const cells = (ln: string) => ln.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const Rich = ({ text }: { text: string }) => {
  const lines = String(text || "").split("\n"); const out: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*\|.*\|\s*$/.test(ln)) { // a table: header, separator, rows
      const rows: string[][] = []; let j = i; while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[j])) rows.push(cells(lines[j])); j++; }
      const [head, ...body] = rows; const numeric = (v: string) => /^[−\-+▲▼]?\s?[\d,.]+(%| .{0,8})?$/.test(v) || v === "—";
      out.push(<div key={i} className="table-wrap ai-tbl"><table className="tbl compact"><thead><tr>{head.map((c, k) => <th key={k} className={k ? "n" : ""}>{inline(c)}</th>)}</tr></thead><tbody>{body.map((r, k) => <tr key={k}>{r.map((c, q) => <td key={q} className={q && numeric(c) ? "n num" : q ? "n" : ""}>{/^[−\-+]?[\d,.]+%?$/.test(c) ? <span dir="ltr">{c}</span> : inline(c)}</td>)}</tr>)}</tbody></table></div>);
      i = j - 1; continue;
    }
    const li = ln.match(/^(\s*)(-|•|\d+\.)\s+(.*)$/);
    if (li) { out.push(<div key={i} className="ai-li"><span className="ai-bul">{/\d/.test(li[2]) ? li[2] : "•"}</span><span>{inline(li[3])}</span></div>); continue; }
    out.push(<div key={i} style={{ minHeight: ln ? undefined : 8 }}>{inline(ln)}</div>);
  }
  return <>{out}</>;
};
/** Copy / PDF under an answer (shown for the longer, report-like ones). */
function AnswerTools({ text, box }: { text: string; box: React.RefObject<HTMLDivElement | null> }) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const plain = text.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\(\/[^)\s]*\)/g, "$1").replace(/^\s*\|[\s:|-]+\|\s*$/gm, "").replace(/\n{3,}/g, "\n\n");
  return <div className="ai-tools no-print">
    <button className="btn sm ghost" onClick={async () => { try { await navigator.clipboard.writeText(plain); toast("نُسخ الرد", "ok"); } catch { toast("تعذّر النسخ", "err"); } }}>📋 نسخ</button>
    <button className="btn sm ghost" disabled={busy} onClick={async () => { if (!box.current) return; setBusy(true); try { const { elementToPdf } = await import("../shared/pdf"); box.current.classList.add("ai-print"); await elementToPdf(box.current, `تقرير المساعد ${new Date().toISOString().slice(0, 10)}.pdf`); } catch (e: any) { toast(e.message || "تعذّر إنشاء الملف", "err"); } finally { box.current?.classList.remove("ai-print"); setBusy(false); } }}>⬇ طباعة / PDF</button>
  </div>;
}
function Answer({ m, children }: { m: any; children?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const long = m.role === "assistant" && (String(m.text || "").length > 350 || /^\s*\|/m.test(m.text || ""));
  return <div className="bubble"><div ref={box}>{children}<Rich text={m.text} /></div>{long && <AnswerTools text={m.text} box={box} />}</div>;
}

function PlanCard({ plan, live, busy, onConfirm, onCancel }: { plan: any; live: boolean; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ST: Record<string, [string, string]> = { pending: ["بانتظار تأكيدك", "amber"], done: ["تم الترحيل", "green"], cancelled: ["ملغاة", "gray"], superseded: ["استُبدلت", "gray"] };
  const [label, color] = ST[plan.status] || ST.pending;
  return (
    <div className={"ai-plan " + plan.status}>
      <div className="row between"><b>📋 {plan.summary || "الخطة المقترحة"}</b><span className={"badge " + color}>{label}</span></div>
      {(plan.preview || []).map((p: any, i: number) => (
        <div key={i} className="ai-act">
          <div><span className="ai-n">{i + 1}</span> {p.title}{p.number && <> — <b className="num">{p.number}</b></>}{p.link && plan.status === "done" && <> · <Link to={p.link}>فتح</Link></>}</div>
          {p.total !== undefined && p.type === "expense" && <div className="small muted">الصافي <b className="num">{money(p.net)}</b> · الضريبة <b className="num">{money(p.vat)}</b> · الإجمالي <b className="num">{money(p.total)}</b> {CUR()} · التاريخ <span className="num">{p.date}</span></div>}
          {p.lines?.length > 0 && <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الحساب</th><th>البيان</th><th className="n">مدين</th><th className="n">دائن</th></tr></thead>
            <tbody>{p.lines.map((l: any, j: number) => <tr key={j}><td><span className="num muted">{l.code}</span> {l.account}{l.partner && <span className="small muted"> — {l.partner}</span>}</td><td className="small">{l.description}</td><td className="n num">{l.debit ? money(l.debit) : ""}</td><td className="n num">{l.credit ? money(l.credit) : ""}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2}>الإجمالي</td><td className="n num">{money(p.lines.reduce((a: number, l: any) => a + l.debit, 0))}</td><td className="n num">{money(p.lines.reduce((a: number, l: any) => a + l.credit, 0))}</td></tr></tfoot></table></div>}
        </div>))}
      {plan.status === "pending" && live && <div className="row" style={{ marginTop: 10 }}><button className="btn primary" disabled={busy} onClick={onConfirm}>✓ تأكيد وترحيل</button><button className="btn" disabled={busy} onClick={onCancel}>إلغاء</button><span className="small muted">لن يُرحَّل شيء قبل تأكيدك. للتعديل اكتب المطلوب في رسالة جديدة.</span></div>}
    </div>
  );
}

export function AiAssistantPage() {
  const { can } = useCompanyContext();
  const toast = useToast();
  const st = useFetch<any>("/ai/status");
  const list = useFetch<any[]>("/ai/conversations");
  const [conv, setConv] = useState<any>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  const [adv, setAdv] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [conv?.view?.length, busy]);
  const addFiles = (fl: FileList | File[]) => { const ok = Array.from(fl).filter((f) => { if (!/^(image\/|application\/pdf|text\/)/.test(f.type)) { toast(`«${f.name}»: المساعد يقرأ الصور وPDF والنص فقط`, "err"); return false; } if (f.size > 5 * 1048576) { toast(`«${f.name}» أكبر من 5 ميجابايت`, "err"); return false; } return true; }); setFiles((x) => [...x, ...ok].slice(0, 5)); };
  const open = async (id: string) => { try { setConv(await api(`/ai/conversations/${id}`)); } catch (e: any) { toast(e.message, "err"); } };
  const send = async (msg?: string) => {
    const t = (msg ?? text).trim();
    if ((!t && !files.length) || busy) return;
    const fs = files; setBusy(true); setText(""); setFiles([]);
    const optimistic = { ...(conv || { view: [] }), view: [...(conv?.view || []), { role: "user", text: t, files: fs.map((f) => ({ name: f.name })) }] };
    setConv(optimistic);
    try {
      const r = await api("/ai/chat", { body: { conversationId: conv?.id, text: t, engine: adv ? "advanced" : undefined, files: await Promise.all(fs.map(async (f) => ({ name: f.name, mime: f.type, data: await readB64(f), qr: await readZatcaQr(f) }))) } });
      setConv(r); if (!conv?.id) list.reload(); st.reload();
    } catch (e: any) { toast(e.message, "err"); setConv(conv); setText(t); setFiles(fs); if (e.code === "AI_PLAN" || e.code === "AI_NOT_CONFIGURED") st.reload(); } finally { setBusy(false); }
  };
  const act = async (what: "confirm" | "cancel") => { setBusy(true); try { const r = await api(`/ai/conversations/${conv.id}/${what}`, { body: {} }); setConv(r); list.reload(); if (what === "confirm") toast("تم التنفيذ والترحيل", "ok"); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };

  if (st.loading && !st.data) return <Loading />;
  const s = st.data || {};
  if (!s.entitled) return (
    <div className="card" style={{ maxWidth: 720, margin: "30px auto" }}><div className="card-b" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 44 }}>✨</div><h2>المساعد المحاسبي الذكي</h2>
      <p className="muted">ميزة باقة <b>المؤسسات (ENTERPRISE)</b>: اكتب العملية بكلامك أو صوّر الفاتورة، والمساعد المدمج يجهّز القيد وفق قواعد المحاسبة والضريبة السعودية، يتحقق من المورد وينشئه إن لم يكن موجوداً، ويعرض عليك ما سيُرحَّل قبل التنفيذ — دون أي خدمة خارجية.</p>
      <p>باقتك الحالية: <span className="badge">{s.plan}</span></p>
      <Link className="btn primary" to="/settings/license">ترقية الاشتراك</Link>
    </div></div>);
  const view: any[] = conv?.view || [];
  const lastPlan = [...view].reverse().find((v) => v.plan)?.plan;
  return (
    <div className="ai-wrap">
      <aside className="ai-side card">
        <button className="btn primary block" onClick={() => { setConv(null); setText(""); }}>＋ محادثة جديدة</button>
        <div className="ai-list">{(list.data || []).map((c) => <div key={c.id} className={"ai-conv" + (conv?.id === c.id ? " on" : "")} onClick={() => open(c.id)}><div className="t">{c.hasPending && "⏳ "}{c.title}</div><div className="small muted">{fmtDT(c.updatedAt)}</div>
          <button className="x" title="حذف" onClick={async (e) => { e.stopPropagation(); if (!confirmDlg("حذف المحادثة؟ (المستندات المرحّلة لا تتأثر)")) return; await api(`/ai/conversations/${c.id}`, { method: "DELETE" }); if (conv?.id === c.id) setConv(null); list.reload(); }}>✕</button></div>)}</div>
        <div className="ai-eng small">
          <div>⚡ <b>المساعد المدمج</b>: يعمل دائماً، بلا إنترنت وبلا حدّ.</div>
          <div>✨ <b>النموذج المتقدم</b>: {s.advanced ? <>مفعّل{s.provider === "gemini" ? " (Google Gemini)" : s.provider === "anthropic" ? " (Anthropic)" : ""} — {s.used} / {s.limit} رسالة {s.trial ? "(تجربة)" : "هذا الشهر"}</> : "غير مفعّل"}</div>
          {can("settings.write") && s.keySource !== "server" && (s.keySource === "company"
            ? <button className="btn sm ghost" onClick={async () => { if (!confirmDlg("إزالة مفتاح API من المنشأة؟")) return; await api("/ai/key", { method: "PUT", body: { apiKey: null } }); st.reload(); }}>إزالة مفتاح API</button>
            : <button className="btn sm ghost" onClick={() => setKeyOpen((x) => !x)}>{keyOpen ? "إخفاء" : "تفعيل النموذج المتقدم (اختياري)"}</button>)}
          {keyOpen && !s.advanced && <div style={{ display: "grid", gap: 6 }}><div className="muted">للعمليات المركّبة وقراءة نص الفواتير وملفات PDF. الصق أحد المفتاحين (يحتاج اتصالاً بالإنترنت):<br />• <b>Google Gemini</b> — مجاني بحدّ يومي، من <span dir="ltr">aistudio.google.com</span> (يبدأ بـ <span dir="ltr">AIza</span>)<br />• <b>Anthropic</b> — مدفوع، من <span dir="ltr">console.anthropic.com</span> (يبدأ بـ <span dir="ltr">sk-ant-</span>)</div><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza… أو sk-ant-…" dir="ltr" type="password" autoComplete="off" />
            <button className="btn sm primary" disabled={!key.trim() || busy} onClick={async () => { setBusy(true); try { const r = await api("/ai/key", { method: "PUT", body: { apiKey: key.trim() } }); setKey(""); setKeyOpen(false); st.reload(); toast(r.note || (r.provider === "gemini" ? `تم التحقق من مفتاح Gemini وتفعيله (${r.model})` : "تم تفعيل النموذج المتقدم"), r.note ? "err" : "ok"); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } }}>{busy ? "جارٍ التحقق…" : "حفظ وتحقق"}</button>
            <div className="muted">عند استخدام النموذج المتقدم تُرسل رسالتك وبيانات السؤال إلى مزوّد المفتاح. المساعد المدمج لا يرسل شيئاً خارج البرنامج.</div></div>}
        </div>
      </aside>
      <section className="ai-main card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
        <div className="ai-msgs">
          {!view.length && <div className="ai-empty">
            <div style={{ fontSize: 40 }}>✨</div><h2>المساعد المحاسبي الذكي</h2>
            <p className="muted">سجّل العمليات بكلامك، اسأل عن أرقام منشأتك، واطلب تحليلاً مالياً أو تقريراً للإدارة. لا يُرحَّل شيء قبل تأكيدك.</p>
            <div className="ai-cats">{SUGGEST().map(([ic, t, xs]) => <div key={t} className="ai-cat"><div className="ai-cat-h">{ic} {t}</div>{xs.map((x) => <button key={x} className="btn" onClick={() => send(x)}>{x}</button>)}</div>)}</div>
          </div>}
          {view.map((m, i) => m.role === "system" ? (
            <div key={i} className="ai-sys">{m.text}{m.results?.map((r: any, j: number) => <div key={j} className="small">{r.title}{r.number && <> — <b className="num">{r.number}</b></>} {r.link && <Link to={r.link}>فتح ←</Link>}</div>)}</div>
          ) : (
            <div key={i} className={"ai-msg " + m.role}>
              <div className="who">{m.role === "user" ? "أنت" : m.engine === "advanced" ? "✨ النموذج المتقدم" : "⚡ المساعد المدمج"}</div>
              <Answer m={m}>{m.files?.length > 0 && <div className="row" style={{ gap: 6, marginBottom: 6 }}>{m.files.map((f: any, j: number) => <span key={j} className="badge blue" style={{ cursor: f.id ? "pointer" : undefined }} onClick={() => f.id && openFile(f.id).catch((e) => toast(e.message, "err"))}>📎 {f.name}{f.qr ? " · QR ✓" : ""}</span>)}</div>}</Answer>
              {m.plan && <div className="bubble" style={{ marginTop: 6 }}><PlanCard plan={m.plan} live={m.plan === lastPlan && !!conv?.pending} busy={busy} onConfirm={() => act("confirm")} onCancel={() => act("cancel")} /></div>}
              {m.suggest?.length > 0 && i === view.length - 1 && !busy && <div className="ai-next">{m.suggest.map((x: string) => <button key={x} className="chip" onClick={() => send(x)}>{x}</button>)}</div>}
            </div>))}
          {busy && <div className="ai-msg assistant"><div className="who">{adv ? "✨ النموذج المتقدم" : "⚡ المساعد المدمج"}</div><div className="bubble"><span className="spinner" /> يفكّر…</div></div>}
          <div ref={end} />
        </div>
        <div className="ai-compose">
          {files.length > 0 && <div className="row" style={{ gap: 6 }}>{files.map((f, i) => <span key={i} className="badge blue">📎 {f.name} <a style={{ cursor: "pointer", marginInlineStart: 4 }} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>✕</a></span>)}</div>}
          <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
            <button className="btn" title="إرفاق فاتورة أو إيصال (صورة / PDF)" onClick={() => inp.current?.click()}>📎</button>
            <input ref={inp} type="file" hidden multiple accept="image/*,application/pdf,.csv,.txt" onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
            <textarea className="input grow" rows={2} value={text} placeholder="اكتب عملية لتسجيلها، أو سؤالاً: «حلّل الوضع المالي»، «قارن هذا الشهر بالماضي»، «كم الضريبة المستحقة؟»…" onChange={(e) => setText(e.target.value)}
              onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn primary" disabled={busy || (!text.trim() && !files.length)} onClick={() => send()}>إرسال</button>
          </div>
          <div className="row between small muted"><span>راجع الخطة قبل التأكيد. Enter للإرسال، Shift+Enter لسطر جديد.</span>{s.advanced && <label className="check" title="يُحسب من رصيد رسائل النموذج المتقدم"><input type="checkbox" checked={adv} onChange={(e) => setAdv(e.target.checked)} /> ✨ استخدم النموذج المتقدم لهذه الرسالة</label>}</div>
        </div>
      </section>
    </div>
  );
}
