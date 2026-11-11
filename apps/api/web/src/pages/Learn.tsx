/**
 * Learning centre («مركز التعلّم»), the per-screen «؟ شرح» drawer, follow-up tasks, favourites and the monthly sales target.
 */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, q, useFetch, useAction, useToast, useCompanyContext, useLocalState, useNewParam, Modal, Field, Input, Select, NumInput, Empty, Loading, today, fmtDate, money, normalizeAr, confirmDlg } from "../lib";
import { LESSONS, SECTIONS, Lesson } from "../help/lessons";
import { CFG } from "../shared/country";

const visible = (l: Lesson) => !(l.sa && CFG.country !== "SA") && !(l.eg && CFG.country !== "EG");
const ALL = LESSONS.filter(visible);

/** **bold** → <b> */
function Rich({ t }: { t: string }) { return <>{t.split("**").map((s, i) => (i % 2 ? <b key={i}>{s}</b> : <React.Fragment key={i}>{s}</React.Fragment>))}</>; }

/** The lesson that explains the open screen: exact route first, then the longest parent route. */
export function lessonFor(pathname: string): Lesson | null {
  let best: Lesson | null = null, len = -1;
  for (const l of ALL) for (const r of l.routes) {
    if (r === pathname) return l;
    if (r !== "/" && pathname.startsWith(r + "/") && r.length > len) { best = l; len = r.length; }
  }
  return best;
}

function useDone() {
  const [done, setDone] = useLocalState<string[]>("mz-lessons-done", []);
  const toggle = (id: string) => setDone(done.includes(id) ? done.filter((x) => x !== id) : [...done, id]);
  return { done, toggle };
}

function LessonBody({ l, onGo }: { l: Lesson; onGo?: () => void }) {
  const here = useLocation();
  const target = l.go && l.go.to.split("?")[0];
  return (
    <div className="lesson">
      <div className="lesson-goal">🎯 {l.goal}</div>
      <ol className="lesson-steps">{l.steps.map((s, i) => <li key={i}><Rich t={s} /></li>)}</ol>
      {l.entry && <div className="lesson-entry"><b>القيد المحاسبي الذي يُنشئه البرنامج:</b><div>{l.entry}</div></div>}
      {l.tips?.length ? <div className="lesson-tips">{l.tips.map((t, i) => <div key={i}>💡 <Rich t={t} /></div>)}</div> : null}
      {l.go && !(target === here.pathname && !l.go.to.includes("?")) && <Link className="btn primary sm" to={l.go.to} onClick={onGo}>{l.go.label} ←</Link>}
    </div>
  );
}

/** «؟ شرح» in the top bar: opens the lesson of the current screen in a side drawer. */
export function HelpButton() {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const { done, toggle } = useDone();
  const l = lessonFor(loc.pathname);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [open]);
  return (
    <>
      <button className="btn sm help-btn" title="شرح هذه الشاشة" onClick={() => setOpen(true)}>؟ شرح</button>
      {open && createPortal(<div className="drawer-bg no-print" onClick={() => setOpen(false)}>
        <aside className="drawer" role="dialog" aria-label="شرح الشاشة" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-h"><b>{l ? l.title : "شرح الشاشة"}</b><button className="btn sm ghost" onClick={() => setOpen(false)} aria-label="إغلاق">✕</button></div>
          <div className="drawer-b">
            {l ? <>
              <LessonBody l={l} onGo={() => setOpen(false)} />
              <label className="row small mt" style={{ gap: 6 }}><input type="checkbox" checked={done.includes(l.id)} onChange={() => toggle(l.id)} /> فهمت هذا الدرس</label>
            </> : <div className="muted">لا يوجد درس خاص بهذه الشاشة بعد. تصفّح مركز التعلّم أو اسأل المساعد الذكي.</div>}
            <div className="row mt" style={{ gap: 8 }}>
              <Link className="btn sm" to={l ? `/learn?s=${l.section}` : "/learn"} onClick={() => setOpen(false)}>🎓 دروس القسم كاملة</Link>
              <Link className="btn sm" to="/ai" onClick={() => setOpen(false)}>✨ اسأل المساعد</Link>
            </div>
            <details className="shortcuts mt"><summary>⌨ اختصارات لوحة المفاتيح</summary>{SHORTCUTS.map(([k, d]) => <div key={k}><kbd>{k}</kbd><span>{d}</span></div>)}</details>
          </div>
        </aside>
      </div>, document.body)}
    </>
  );
}

export function LearnPage() {
  const loc = useLocation(); const nav = useNavigate();
  const sp = new URLSearchParams(loc.search);
  const sec = sp.get("s") || ""; const openId = sp.get("l") || "";
  const [s, setS] = useState("");
  const { done, toggle } = useDone();
  const set = (k: string, v: string) => { const n = new URLSearchParams(loc.search); if (v) n.set(k, v); else n.delete(k); if (k === "s") n.delete("l"); nav({ pathname: "/learn", search: n.toString() ? `?${n}` : "" }, { replace: true }); };
  const nq = normalizeAr(s.trim());
  const list = useMemo(() => ALL.filter((l) => (nq ? normalizeAr([l.title, l.goal, ...l.steps, ...(l.tips || [])].join(" ")).includes(nq) : !sec || l.section === sec)), [nq, sec]);
  const pct = Math.round((ALL.filter((l) => done.includes(l.id)).length / ALL.length) * 100);
  const secs = SECTIONS.filter((x) => ALL.some((l) => l.section === x.key));
  return (
    <div className="grid learn">
      <div className="card"><div className="card-b">
        <div className="row" style={{ gap: 12 }}>
          <div className="grow"><h2 style={{ margin: 0 }}>🎓 مركز التعلّم</h2><div className="muted small">{ALL.length} درساً قصيراً تشرح كل شاشة خطوة بخطوة، مع القيد المحاسبي الذي ينشئه البرنامج. زر «؟ شرح» أعلى أي شاشة يفتح درسها مباشرة.</div></div>
          <input className="input" style={{ maxWidth: 280 }} value={s} onChange={(e) => setS(e.target.value)} placeholder="ابحث: مرتجع، رصيد افتتاحي، إقرار…" aria-label="بحث في الدروس" />
        </div>
        <div className="learn-prog mt"><div style={{ width: pct + "%" }} /></div>
        <div className="small muted">أنجزت {ALL.filter((l) => done.includes(l.id)).length} من {ALL.length} ({pct}%)</div>
      </div></div>
      {!nq && <div className="learn-secs">
        <button className={"learn-sec" + (!sec ? " active" : "")} onClick={() => set("s", "")}><span className="ic">📚</span><b>كل الدروس</b><span className="small muted">{ALL.length} درساً</span></button>
        {secs.map((x) => { const ls = ALL.filter((l) => l.section === x.key); const n = ls.filter((l) => done.includes(l.id)).length; return (
          <button key={x.key} className={"learn-sec" + (sec === x.key ? " active" : "")} onClick={() => set("s", x.key)}><span className="ic">{x.ic}</span><b>{x.label}</b><span className="small muted">{x.desc}</span><span className="small">{n === ls.length ? "✓ مكتمل" : `${n}/${ls.length}`}</span></button>); })}
      </div>}
      {!list.length ? <Empty text="لا يوجد درس مطابق — جرّب كلمة أخرى أو اسأل المساعد الذكي" /> : (nq || !sec ? secs : secs.filter((x) => x.key === sec)).map((x) => {
        const ls = list.filter((l) => l.section === x.key);
        if (!ls.length) return null;
        return (
          <div className="card" key={x.key}><div className="card-h"><h3>{x.ic} {x.label}</h3></div><div className="card-b" style={{ padding: 0 }}>
            {ls.map((l) => { const open = openId === l.id; return (
              <div key={l.id} className={"learn-item" + (open ? " open" : "")}>
                <button className="learn-item-h" aria-expanded={open} onClick={() => set("l", open ? "" : l.id)}>
                  <span className={"learn-check" + (done.includes(l.id) ? " on" : "")}>{done.includes(l.id) ? "✓" : ""}</span>
                  <span className="grow"><b>{l.title}</b><span className="small muted"> — {l.goal}</span></span>
                  <span className="small muted">{l.mins} د</span><span className="chev">‹</span>
                </button>
                {open && <div className="learn-item-b"><LessonBody l={l} /><label className="row small mt" style={{ gap: 6 }}><input type="checkbox" checked={done.includes(l.id)} onChange={() => toggle(l.id)} /> فهمت هذا الدرس</label></div>}
              </div>); })}
          </div></div>);
      })}
    </div>
  );
}

// ─── favourites ──────────────────────────────────────────────────────────
export type Fav = { to: string; label: string };
const FAV_KEY = "mz-favs";
const readFavs = (): Fav[] => { try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); return Array.isArray(v) ? v.filter((f) => f && typeof f.to === "string" && f.to.startsWith("/") && typeof f.label === "string").slice(0, 12) : []; } catch { return []; } };
export function useFavs(): [Fav[], (f: Fav) => void] {
  const [favs, setFavs] = useState<Fav[]>(readFavs);
  useEffect(() => { const h = () => setFavs(readFavs()); window.addEventListener("mz-favs", h); return () => window.removeEventListener("mz-favs", h); }, []);
  const toggle = (f: Fav) => { const cur = readFavs(); const next = cur.some((x) => x.to === f.to) ? cur.filter((x) => x.to !== f.to) : [...cur, f].slice(-12); try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch {} window.dispatchEvent(new Event("mz-favs")); };
  return [favs, toggle];
}
/** ☆ in the top bar: pins the open screen to «المفضلة» at the top of the menu. */
export function FavStar({ to, label }: { to: string | null; label: string }) {
  const [favs, toggle] = useFavs();
  if (!to || !label) return null;
  const on = favs.some((f) => f.to === to);
  return <button className={"btn sm ghost fav-star" + (on ? " on" : "")} title={on ? "إزالة من المفضلة" : "إضافة للمفضلة"} aria-pressed={on} onClick={() => toggle({ to, label })}>{on ? "★" : "☆"}</button>;
}

// ─── tasks ───────────────────────────────────────────────────────────────
const PRIO: Record<string, string> = { HIGH: "عاجلة", NORMAL: "عادية", LOW: "منخفضة" };

/** Counter of my tasks due today or overdue, in the top bar. */
export function TasksBadge() {
  const loc = useLocation();
  const [n, setN] = useState<{ due: number; open: number } | null>(null);
  useEffect(() => { let on = true; const load = () => api("/tasks?status=OPEN&mine=1").then((r) => on && setN(r.mine)).catch(() => undefined); load(); const h = () => load(); window.addEventListener("mz-tasks", h); return () => { on = false; window.removeEventListener("mz-tasks", h); }; }, [loc.pathname === "/tasks"]);
  return <Link to="/tasks" className="btn sm ghost tasks-badge" title={n?.due ? `${n.due} مهمة مستحقة` : "المهام والمتابعات"}>☑{n?.due ? <span className="dot">{n.due}</span> : null}</Link>;
}

export function TasksPage() {
  const { me } = useCompanyContext();
  const toast = useToast();
  const { run, busy } = useAction();
  const [status, setStatus] = useState("OPEN");
  const [mine, setMine] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const { data, loading, reload } = useFetch<any>(`/tasks${q({ status: status || undefined, mine: mine ? 1 : undefined })}`, [status, mine]);
  useNewParam(() => setEdit({ title: "", dueDate: today(), priority: "NORMAL", assignedTo: "" }));
  const changed = () => { reload(); window.dispatchEvent(new Event("mz-tasks")); };
  const save = () => run(async () => {
    const body = { title: edit.title, notes: edit.notes || "", dueDate: edit.dueDate || null, priority: edit.priority, assignedTo: edit.assignedTo || null, link: edit.link || null };
    if (edit.id) await api(`/tasks/${edit.id}`, { method: "PUT", body }); else await api("/tasks", { body });
    setEdit(null); toast("تم الحفظ"); changed();
  });
  const t0 = today();
  const rows: any[] = data?.rows || [];
  return (
    <div className="grid">
      <div className="card"><div className="card-b row" style={{ gap: 8 }}>
        {[["OPEN", "المفتوحة"], ["DONE", "المنجزة"], ["", "الكل"]].map(([k, l]) => <button key={k} className={"btn sm" + (status === k ? " primary" : "")} onClick={() => setStatus(k)}>{l}</button>)}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> مهامي فقط</label>
        <div className="grow" />
        {data?.mine && <span className="small muted">لك {data.mine.open} مفتوحة{data.mine.due ? <> · <b className="neg-val">{data.mine.due} مستحقة</b></> : null}</span>}
        <button className="btn primary sm" onClick={() => setEdit({ title: "", dueDate: t0, priority: "NORMAL", assignedTo: "" })}>＋ مهمة جديدة</button>
      </div></div>
      <div className="card"><div className="card-b" style={{ padding: 0 }}>
        {loading && !data ? <Loading /> : !rows.length ? <Empty text={status === "OPEN" ? "لا توجد مهام مفتوحة ✓" : "لا توجد مهام"} /> : rows.map((t) => { const late = t.status === "OPEN" && t.dueDate && fmtDate(t.dueDate) < t0; const due = t.status === "OPEN" && fmtDate(t.dueDate) === t0; return (
          <div key={t.id} className={"task-row" + (t.status === "DONE" ? " done" : "")}>
            <input type="checkbox" aria-label="منجزة" checked={t.status === "DONE"} disabled={busy} onChange={() => run(async () => { await api(`/tasks/${t.id}`, { method: "PUT", body: { status: t.status === "DONE" ? "OPEN" : "DONE" } }); changed(); })} />
            <div className="grow">
              <div className="task-title">{t.title}{t.priority === "HIGH" && <span className="badge red" style={{ marginInlineStart: 6 }}>عاجلة</span>}</div>
              {t.notes && <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{t.notes}</div>}
              <div className="small muted">
                {t.dueDate && <span className={late ? "neg-val" : due ? "pos-val" : ""}>{late ? "متأخرة منذ " : due ? "اليوم " : "تستحق "}<span className="num">{fmtDate(t.dueDate)}</span> · </span>}
                {t.assignedName ? `على ${t.assignedName}` : `أنشأها ${t.createdName || ""}`}
                {t.link && <> · <Link to={t.link}>فتح الشاشة المرتبطة</Link></>}
              </div>
            </div>
            <button className="btn sm ghost" onClick={() => setEdit({ ...t, dueDate: fmtDate(t.dueDate), assignedTo: t.assignedTo || "" })}>تعديل</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => { if (confirmDlg("حذف المهمة؟")) run(async () => { await api(`/tasks/${t.id}`, { method: "DELETE" }); changed(); }); }}>حذف</button>
          </div>); })}
      </div></div>
      {edit && <Modal narrow title={edit.id ? "تعديل المهمة" : "مهمة جديدة"} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>إلغاء</button><button className="btn primary" disabled={busy || !edit.title?.trim()} onClick={save}>حفظ</button></>}>
        <div className="grid">
          <Field label="المهمة"><Input autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="مثال: متابعة سداد فاتورة شركة …" /></Field>
          <Field label="تاريخ الاستحقاق"><Input type="date" value={edit.dueDate || ""} onChange={(e) => setEdit({ ...edit, dueDate: e.target.value })} /></Field>
          <Field label="الأولوية"><Select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>{Object.entries(PRIO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="المسؤول"><Select value={edit.assignedTo || ""} onChange={(e) => setEdit({ ...edit, assignedTo: e.target.value })}><option value="">أنا ({me.user.fullName})</option>{(data?.members || []).filter((m: any) => m.id !== me.user.id).map((m: any) => <option key={m.id} value={m.id}>{m.fullName}</option>)}</Select></Field>
          <Field label="ملاحظات"><textarea className="input" rows={3} value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}

// ─── monthly sales target ────────────────────────────────────────────────
export function TargetCard() {
  const { can } = useCompanyContext();
  const { data: t, reload } = useFetch<any>("/targets");
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<string | null>(null);
  if (!t) return null;
  const pct = t.pct ?? 0; const ahead = t.expectedByNow !== null && t.actual >= t.expectedByNow;
  return (
    <div className="card target-card"><div className="card-h"><h3>🎯 هدف مبيعات الشهر</h3>{can("settings.write") && <button className="btn sm ghost" onClick={() => setEdit(String(t.monthlySales || ""))}>{t.monthlySales ? "تعديل الهدف" : "تحديد هدف"}</button>}</div>
      <div className="card-b">
        {!t.monthlySales ? <div className="muted">لم يُحدَّد هدف بعد. مبيعات الشهر حتى الآن <b className="num">{money(t.actual)}</b>، والمتوقع بنهايته بالمعدل الحالي <b className="num">{money(t.projected)}</b>.</div> : <>
          <div className="row" style={{ alignItems: "baseline", gap: 10 }}><b className="num" style={{ fontSize: 26 }}>{pct}%</b><span className="muted"><span className="num">{money(t.actual)}</span> من <span className="num">{money(t.monthlySales)}</span></span><div className="grow" /><span className={"badge " + (ahead ? "green" : "orange")}>{ahead ? "متقدم على الخطة" : "متأخر عن الخطة"}</span></div>
          <div className="target-bar"><div style={{ width: Math.min(100, pct) + "%" }} className={ahead ? "ok" : ""} /><i style={{ insetInlineStart: Math.min(100, (t.day / t.daysInMonth) * 100) + "%" }} title="موضع اليوم من الشهر" /></div>
          <div className="small muted">اليوم {t.day} من {t.daysInMonth} · المفترض حتى اليوم <span className="num">{money(t.expectedByNow)}</span> · المتوقع بنهاية الشهر <span className="num">{money(t.projected)}</span>{t.dailyNeeded !== null && t.actual < t.monthlySales ? <> · المطلوب يومياً لبلوغ الهدف <b className="num">{money(t.dailyNeeded)}</b></> : null}</div>
        </>}
      </div>
      {edit !== null && <Modal narrow title="هدف المبيعات الشهري" onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>إلغاء</button><button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("/targets", { method: "PUT", body: { monthlySales: Number(edit) || 0 } }); setEdit(null); reload(); })}>حفظ</button></>}>
        <Field label="المبيعات المستهدفة شهرياً (قبل الضريبة)" hint="اكتب 0 لإلغاء الهدف"><NumInput autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} /></Field>
      </Modal>}
    </div>
  );
}

// ─── shell helpers: activity bar, offline notice, keyboard shortcuts ─────
/** A thin bar while any request is in flight (shown only if it lasts, so quick screens do not flicker). */
export function NetBar() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let t: any = null;
    const h = (e: Event) => { const n = (e as CustomEvent).detail as number; if (n > 0) { if (!t) t = setTimeout(() => setOn(true), 250); } else { clearTimeout(t); t = null; setOn(false); } };
    window.addEventListener("mz-net", h); return () => { window.removeEventListener("mz-net", h); clearTimeout(t); };
  }, []);
  return <div className={"netbar" + (on ? " on" : "")} aria-hidden="true" />;
}
export function OfflineNote() {
  const [off, setOff] = useState(!navigator.onLine);
  useEffect(() => { const a = () => setOff(false), b = () => setOff(true); window.addEventListener("online", a); window.addEventListener("offline", b); return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); }; }, []);
  return off && !CFG.desktop ? <div className="offline-note no-print" role="status">⚠ لا يوجد اتصال بالإنترنت — ما تراه آخر ما حُمّل، والحفظ يتوقف حتى يعود الاتصال (نقطة البيع تواصل العمل وترحّل لاحقاً).</div> : null;
}
export const SHORTCUTS: [string, string][] = [["Ctrl + K", "بحث شامل في المستندات والعملاء والأصناف"], ["Alt + N", "جديد: فاتورة / مصروف / قيد حسب القسم المفتوح"], ["Alt + H", "شرح الشاشة المفتوحة"], ["Alt + L", "مركز التعلّم"], ["Alt + T", "المهام والمتابعات"], ["Alt + A", "المساعد الذكي"], ["Alt + D", "لوحة المؤشرات"], ["Esc", "إغلاق النافذة المفتوحة"], ["F2 · F5 · F8", "في نقطة البيع: بحث · دفع · تعليق"]];
/** Alt-key shortcuts; `newTo` is the «＋ جديد» entry of the open module. */
export function useShortcuts(newTo: string | null) {
  const nav = useNavigate();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const go = (to: string) => { e.preventDefault(); nav(to); };
      switch (e.code) {
        case "KeyN": if (newTo) go(newTo); break;
        case "KeyH": e.preventDefault(); (document.querySelector(".help-btn") as HTMLElement | null)?.click(); break;
        case "KeyL": go("/learn"); break;
        case "KeyT": go("/tasks"); break;
        case "KeyA": go("/ai"); break;
        case "KeyD": go("/"); break;
      }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [newTo]);
}
