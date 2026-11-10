/** AI accounting assistant: chat, attachments, a plan card with the real journal entry, confirm before posting. */
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CUR } from "../shared/country";
import { api, session, useFetch, money, Loading, Field, Input, useToast, useCompanyContext, fmtDT, confirmDlg } from "../lib";

const SUGGEST = [
  "فاتورة مياه المكتب بقيمة 200 ريال شامل الضريبة من المورد شركة المياه الوطنية، دُفعت نقداً",
  "سجّل إيجار المكتب 5,000 ريال + ضريبة، آجل على المورد مؤسسة العقار المتحد",
  "اشرح لي قيد شراء أثاث بالتقسيط وهل أسجله مصروفاً أم أصلاً؟",
  "كيف أعالج فاتورة ضيافة عملاء ضريبياً؟",
];
const readB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
async function openFile(id: string) {
  const r = await fetch(`/api/attachments/file/${id}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!r.ok) throw new Error("تعذّر فتح المرفق");
  const url = URL.createObjectURL(await r.blob()); window.open(url, "_blank"); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
/** **bold** and line breaks only — the model answers in short plain Arabic. */
const Rich = ({ text }: { text: string }) => <>{String(text || "").split("\n").map((ln, i) => <div key={i} style={{ minHeight: ln ? undefined : 8 }}>{ln.split(/(\*\*[^*]+\*\*)/).map((p, j) => (p.startsWith("**") && p.endsWith("**") ? <b key={j}>{p.slice(2, -2)}</b> : p))}</div>)}</>;

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
      const r = await api("/ai/chat", { body: { conversationId: conv?.id, text: t, files: await Promise.all(fs.map(async (f) => ({ name: f.name, mime: f.type, data: await readB64(f) }))) } });
      setConv(r); if (!conv?.id) list.reload(); st.reload();
    } catch (e: any) { toast(e.message, "err"); setConv(conv); setText(t); setFiles(fs); if (e.code === "AI_PLAN" || e.code === "AI_NOT_CONFIGURED") st.reload(); } finally { setBusy(false); }
  };
  const act = async (what: "confirm" | "cancel") => { setBusy(true); try { const r = await api(`/ai/conversations/${conv.id}/${what}`, { body: {} }); setConv(r); list.reload(); if (what === "confirm") toast("تم التنفيذ والترحيل", "ok"); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };

  if (st.loading && !st.data) return <Loading />;
  const s = st.data || {};
  if (!s.entitled) return (
    <div className="card" style={{ maxWidth: 720, margin: "30px auto" }}><div className="card-b" style={{ textAlign: "center" }}>
      <div style={{ fontSize: 44 }}>✨</div><h2>المساعد المحاسبي الذكي</h2>
      <p className="muted">ميزة باقة <b>المؤسسات (ENTERPRISE)</b>: اكتب العملية بكلامك أو أرفق الفاتورة، والمساعد يجهّز القيد وفق قواعد المحاسبة والضريبة السعودية، يتحقق من المورد وينشئه إن لم يكن موجوداً، ويعرض عليك ما سيُرحَّل قبل التنفيذ.</p>
      <p>باقتك الحالية: <span className="badge">{s.plan}</span></p>
      <Link className="btn primary" to="/settings/license">ترقية الاشتراك</Link>
    </div></div>);
  if (!s.configured) return (
    <div className="card" style={{ maxWidth: 720, margin: "30px auto" }}><div className="card-h"><h3>✨ تهيئة المساعد الذكي</h3></div><div className="card-b">
      <p className="muted">المساعد يعمل عبر خدمة Claude من Anthropic ويحتاج مفتاح API واتصالاً بالإنترنت. أنشئ مفتاحاً من حسابك في console.anthropic.com ثم ألصقه هنا. يُحفظ المفتاح في بيانات منشأتك ولا يُعرض بعد الحفظ.</p>
      {can("settings.write") ? <><Field label="مفتاح Anthropic API"><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" dir="ltr" type="password" /></Field>
        <button className="btn primary mt" disabled={!key.trim()} onClick={async () => { try { await api("/ai/key", { method: "PUT", body: { apiKey: key.trim() } }); setKey(""); st.reload(); toast("تم حفظ المفتاح", "ok"); } catch (e: any) { toast(e.message, "err"); } }}>حفظ وتفعيل</button></> : <div className="alert warn">اطلب من مدير النظام إضافة المفتاح.</div>}
    </div></div>);

  const view: any[] = conv?.view || [];
  const lastPlan = [...view].reverse().find((v) => v.plan)?.plan;
  return (
    <div className="ai-wrap">
      <aside className="ai-side card">
        <button className="btn primary block" onClick={() => { setConv(null); setText(""); }}>＋ محادثة جديدة</button>
        <div className="ai-list">{(list.data || []).map((c) => <div key={c.id} className={"ai-conv" + (conv?.id === c.id ? " on" : "")} onClick={() => open(c.id)}><div className="t">{c.hasPending && "⏳ "}{c.title}</div><div className="small muted">{fmtDT(c.updatedAt)}</div>
          <button className="x" title="حذف" onClick={async (e) => { e.stopPropagation(); if (!confirmDlg("حذف المحادثة؟ (المستندات المرحّلة لا تتأثر)")) return; await api(`/ai/conversations/${c.id}`, { method: "DELETE" }); if (conv?.id === c.id) setConv(null); list.reload(); }}>✕</button></div>)}</div>
        <div className="small muted">{s.trial ? "تجربة" : "هذا الشهر"}: {s.used} / {s.limit} رسالة{s.model === "mock" ? " · وضع الاختبار" : ""}</div>
        {s.keySource === "company" && can("settings.write") && <button className="btn sm ghost" onClick={async () => { if (!confirmDlg("إزالة مفتاح API من المنشأة؟")) return; await api("/ai/key", { method: "PUT", body: { apiKey: null } }); st.reload(); }}>إزالة مفتاح API</button>}
      </aside>
      <section className="ai-main card" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
        <div className="ai-msgs">
          {!view.length && <div className="ai-empty">
            <div style={{ fontSize: 40 }}>✨</div><h2>المساعد المحاسبي الذكي</h2>
            <p className="muted">اكتب العملية بكلامك أو أرفق صورة الفاتورة. أجهّز القيد وأعرضه عليك، ولا يُرحَّل شيء قبل تأكيدك.</p>
            <div className="ai-sug">{SUGGEST.map((x) => <button key={x} className="btn" onClick={() => send(x)}>{x}</button>)}</div>
          </div>}
          {view.map((m, i) => m.role === "system" ? (
            <div key={i} className="ai-sys">{m.text}{m.results?.map((r: any, j: number) => <div key={j} className="small">{r.title}{r.number && <> — <b className="num">{r.number}</b></>} {r.link && <Link to={r.link}>فتح ←</Link>}</div>)}</div>
          ) : (
            <div key={i} className={"ai-msg " + m.role}>
              <div className="who">{m.role === "user" ? "أنت" : "✨ المساعد"}</div>
              <div className="bubble">
                {m.files?.length > 0 && <div className="row" style={{ gap: 6, marginBottom: 6 }}>{m.files.map((f: any, j: number) => <span key={j} className="badge blue" style={{ cursor: f.id ? "pointer" : undefined }} onClick={() => f.id && openFile(f.id).catch((e) => toast(e.message, "err"))}>📎 {f.name}</span>)}</div>}
                <Rich text={m.text} />
                {m.plan && <PlanCard plan={m.plan} live={m.plan === lastPlan && !!conv?.pending} busy={busy} onConfirm={() => act("confirm")} onCancel={() => act("cancel")} />}
              </div>
            </div>))}
          {busy && <div className="ai-msg assistant"><div className="who">✨ المساعد</div><div className="bubble"><span className="spinner" /> يفكّر…</div></div>}
          <div ref={end} />
        </div>
        <div className="ai-compose">
          {files.length > 0 && <div className="row" style={{ gap: 6 }}>{files.map((f, i) => <span key={i} className="badge blue">📎 {f.name} <a style={{ cursor: "pointer", marginInlineStart: 4 }} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>✕</a></span>)}</div>}
          <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-end" }}>
            <button className="btn" title="إرفاق فاتورة أو إيصال (صورة / PDF)" onClick={() => inp.current?.click()}>📎</button>
            <input ref={inp} type="file" hidden multiple accept="image/*,application/pdf,.csv,.txt" onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
            <textarea className="input grow" rows={2} value={text} placeholder="مثال: فاتورة كهرباء 460 ريال شامل الضريبة من الشركة السعودية للكهرباء، دُفعت من البنك…" onChange={(e) => setText(e.target.value)}
              onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addFiles(fs); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn primary" disabled={busy || (!text.trim() && !files.length)} onClick={() => send()}>إرسال</button>
          </div>
          <div className="small muted">المساعد قد يخطئ — راجع الخطة قبل التأكيد. Enter للإرسال، Shift+Enter لسطر جديد.</div>
        </div>
      </section>
    </div>
  );
}
