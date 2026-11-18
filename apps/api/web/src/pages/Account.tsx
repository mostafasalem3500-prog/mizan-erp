/** «حسابي والأمان»: change the password and turn on two-step sign-in. Also the public privacy and terms pages. */
import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CFG } from "../shared/country";
import { api, useFetch, Loading, Field, Input, useAction, fmtDT, confirmDlg } from "../lib";
import { LangToggle } from "../i18n/LangToggle";

export function AccountPage() {
  const { data: s, loading, reload } = useFetch<any>("/auth/security");
  const { run, busy } = useAction();
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [setup, setSetup] = useState<any>(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [offPw, setOffPw] = useState("");
  useEffect(() => { if (setup?.uri) QRCode.toDataURL(setup.uri, { margin: 1, width: 200 }).then(setQr).catch(() => setQr("")); }, [setup?.uri]);
  if (loading && !s) return <Loading />;
  if (!s) return null;
  const strong = pw.next.length >= 8 && /\d/.test(pw.next) && /[A-Za-z؀-ۿ]/.test(pw.next);
  const pwOk = !!pw.current && strong && pw.next === pw.again && pw.next !== pw.current;
  return (
    <div className="grid">
      <div className="card"><div className="card-h"><div><h3>حسابي والأمان</h3><div className="small muted">{s.fullName} — <span dir="ltr">{s.email}</span>{s.lastLoginAt && <> · آخر دخول {fmtDT(s.lastLoginAt)}</>}</div></div>
        <span className={"badge " + (s.twoFactor ? "green" : "amber")} data-2fa-state>{s.twoFactor ? "التحقق بخطوتين مفعّل" : "التحقق بخطوتين غير مفعّل"}</span></div>
        {s.showcase && <div className="card-b"><div className="alert info small">هذا حساب العرض التجريبي المشترك بين الزوار: لا تُغيَّر كلمة مروره ولا إعدادات دخوله من هنا.</div></div>}</div>

      <div className="grid cols-2">
        <div className="card"><div className="card-h"><h3>تغيير كلمة المرور</h3></div><div className="card-b grid" data-pw>
          <Field label="كلمة المرور الحالية"><Input type="password" dir="ltr" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="كلمة المرور الجديدة" hint={pw.next && !strong ? "8 أحرف على الأقل، وتجمع حروفاً وأرقاماً" : "8 أحرف على الأقل، حروف وأرقام"}><Input type="password" dir="ltr" autoComplete="new-password" className={pw.next && !strong ? "invalid" : ""} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="تأكيد كلمة المرور الجديدة" hint={pw.again && pw.again !== pw.next ? "غير مطابقة" : undefined}><Input type="password" dir="ltr" autoComplete="new-password" className={pw.again && pw.again !== pw.next ? "invalid" : ""} value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
          <div><button className="btn primary" disabled={busy || !pwOk || s.showcase} onClick={() => run(async () => { await api("/auth/change-password", { body: { current: pw.current, next: pw.next } }); setPw({ current: "", next: "", again: "" }); reload(); }, "تم تغيير كلمة المرور")}>تغيير كلمة المرور</button></div>
          {s.passwordChangedAt && <div className="small muted">آخر تغيير: {fmtDT(s.passwordChangedAt)}</div>}
        </div></div>

        <div className="card"><div className="card-h"><h3>التحقق بخطوتين</h3></div><div className="card-b grid" data-2fa>
          <div className="small muted">بعد كلمة المرور يُطلب رمز من 6 أرقام يولّده تطبيق المصادقة في جوالك (Google Authenticator، Microsoft Authenticator، Authy…). يحمي الحساب حتى لو عُرفت كلمة المرور.</div>
          {codes ? <div className="alert ok small" data-recovery><b>تم التفعيل.</b> احفظ رموز الاسترداد التالية في مكان آمن — كل رمز يُستعمل مرة واحدة إذا فقدت جوالك، ولن تُعرض مرة أخرى:
            <div className="num" dir="ltr" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, margin: "10px 0", fontWeight: 600 }}>{codes.map((c) => <span key={c}>{c}</span>)}</div>
            <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(codes.join("\n")).catch(() => undefined); }}>نسخ الرموز</button> <button className="btn sm" onClick={() => setCodes(null)}>حفظتها</button></div>
            : s.twoFactor ? <>
              <div className="alert ok small">✓ مفعّل. رموز الاسترداد المتبقية: <b>{s.recoveryLeft}</b>.</div>
              <Field label="للتعطيل أدخل كلمة المرور"><Input type="password" dir="ltr" autoComplete="current-password" value={offPw} onChange={(e) => setOffPw(e.target.value)} /></Field>
              <div><button className="btn danger" disabled={busy || !offPw} onClick={() => run(async () => { await api("/auth/2fa/disable", { body: { password: offPw } }); setOffPw(""); reload(); }, "تم تعطيل التحقق بخطوتين")}>تعطيل التحقق بخطوتين</button></div>
            </> : !setup ? <div><button className="btn primary" disabled={busy || s.showcase} onClick={() => run(async () => setSetup(await api("/auth/2fa/setup", { body: {} })))}>تفعيل التحقق بخطوتين</button></div>
              : <>
                <ol className="small" style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 4 }}><li>افتح تطبيق المصادقة في جوالك واختر «إضافة حساب».</li><li>امسح الرمز، أو أدخل المفتاح يدوياً.</li><li>اكتب الرمز الظاهر في التطبيق (6 أرقام) ثم «تأكيد».</li></ol>
                <div className="row" style={{ alignItems: "center", gap: 14, flexWrap: "wrap" }}>{qr && <img src={qr} width={160} height={160} alt="رمز QR لإضافة الحساب في تطبيق المصادقة" style={{ background: "#fff", borderRadius: 8, padding: 6 }} />}
                  <div className="grid" style={{ gap: 6 }}><span className="small muted">المفتاح اليدوي</span><code dir="ltr" data-secret style={{ wordBreak: "break-all", userSelect: "all" }}>{setup.secret}</code></div></div>
                <Field label="الرمز من التطبيق"><Input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" style={{ width: 140, letterSpacing: 4 }} /></Field>
                <div className="row"><button className="btn primary" disabled={busy || code.length !== 6} onClick={() => run(async () => { const r = await api("/auth/2fa/enable", { body: { code } }); setCodes(r.recoveryCodes); setSetup(null); setCode(""); reload(); }, "تم تفعيل التحقق بخطوتين")}>تأكيد وتفعيل</button><button className="btn" onClick={() => { setSetup(null); setCode(""); }}>إلغاء</button></div>
              </>}
        </div></div>
      </div>
      <Sessions />
    </div>
  );
}

/** Devices signed in to this account; any of them can be signed out from here. */
function Sessions() {
  const { data, reload } = useFetch<any>("/auth/sessions");
  const { run, busy } = useAction();
  if (!data) return null;
  if (data.showcase) return null;
  const others = data.rows.filter((r: any) => !r.current).length;
  return (
    <div className="card" data-sessions><div className="card-h"><div><h3>الأجهزة المسجّل دخولها</h3><div className="small muted">كل جلسة تنتهي بعد 12 ساعة من آخر دخول. إن رأيت جهازاً لا تعرفه فأنهِ جلسته وغيّر كلمة المرور — تغيير كلمة المرور ينهي الجلسات الأخرى كلها.</div></div>
      {others > 0 && <button className="btn sm" disabled={busy} data-revoke-others onClick={() => confirmDlg("تسجيل الخروج من كل الأجهزة الأخرى؟") && run(async () => { await api("/auth/sessions/revoke-others", { body: {} }); reload(); }, "سُجّل الخروج من الأجهزة الأخرى")}>تسجيل الخروج من الأجهزة الأخرى ({others})</button>}</div>
      <div className="table-wrap"><table className="tbl compact"><thead><tr><th>الجهاز</th><th>عنوان IP</th><th>بداية الجلسة</th><th>آخر نشاط</th><th /></tr></thead>
        <tbody>{data.rows.map((r: any) => <tr key={r.id} data-session={r.current ? "current" : "other"}><td>{r.mobile ? "📱" : "💻"} {r.browser}{r.os ? ` · ${r.os}` : ""} {r.current && <span className="badge green">هذا الجهاز</span>}</td><td dir="ltr" className="num small">{r.ip || "—"}</td><td className="small">{fmtDT(r.createdAt)}</td><td className="small">{fmtDT(r.lastSeenAt)}</td>
          <td>{!r.current && <button className="btn sm ghost" disabled={busy} onClick={() => run(async () => { await api(`/auth/sessions/${r.id}`, { method: "DELETE" }); reload(); }, "انتهت الجلسة")}>إنهاء</button>}</td></tr>)}</tbody></table></div></div>
  );
}

const SEC: Record<string, { title: string; body: [string, string][] }> = {
  privacy: { title: "سياسة الخصوصية", body: [
    ["ما البيانات التي نحفظها", "بيانات حسابك (الاسم، البريد، الجوال)، وبيانات منشأتك المحاسبية التي تدخلها أنت: العملاء والموردون والأصناف والفواتير والقيود والموظفون. كلمات المرور تُحفظ مشفّرة باتجاه واحد ولا يمكن قراءتها."],
    ["لماذا نحفظها", "لتشغيل النظام المحاسبي لك فقط: إصدار المستندات والتقارير والربط الضريبي الذي تفعّله بنفسك. لا نبيع بياناتك ولا نستخدمها للإعلان."],
    ["من يطّلع عليها", "مستخدمو منشأتك حسب الصلاحيات التي يحددها مالك المنشأة، وكل عملية حساسة تُسجَّل في سجل التدقيق. لا تُرسَل البيانات إلى جهات خارجية إلا ما تفعّله أنت: منصة الفوترة الإلكترونية الضريبية، أو مزوّد الذكاء الاصطناعي إذا أضفت مفتاحه."],
    ["أين تُحفظ", "في قاعدة بيانات الخادم السحابي، أو على جهازك بالكامل في النسخة المكتبية. الاتصال بالخادم مشفّر (HTTPS)."],
    ["حقوقك", "تستطيع تصدير بياناتك (نسخة احتياطية كاملة وملفات Excel) من الإعدادات، وتصحيحها متى شئت، وطلب حذف حسابك وبيانات منشأتك بمراسلة الدعم. السجلات المحاسبية والضريبية قد يلزم نظاماً الاحتفاظ بها مدة محددة."],
    ["ملفات الارتباط", "لا نستخدم ملفات تتبّع أو إعلانات. يُحفظ في متصفحك رمز الدخول وتفضيلات العرض فقط."],
  ] },
  terms: { title: "شروط الاستخدام", body: [
    ["الخدمة", "ميزان ERP نظام محاسبة ونقاط بيع. تُقدَّم الخدمة كما هي، ونعمل على استمرارها ودقتها، دون ضمان خلوّها من كل خطأ."],
    ["مسؤوليتك", "صحة البيانات التي تدخلها، وحفظ كلمة المرور وتفعيل التحقق بخطوتين، ومراجعة مخرجات النظام مع محاسبك قبل تقديمها للجهات الرسمية. الإقرارات الضريبية والزكوية مسؤولية المنشأة."],
    ["الاستخدام المقبول", "لا يجوز استخدام النظام في نشاط مخالف للأنظمة، ولا محاولة الوصول إلى بيانات منشآت أخرى أو تعطيل الخدمة."],
    ["النسخ الاحتياطي", "نأخذ نسخاً احتياطية للخدمة السحابية، وننصحك بتنزيل نسختك الدورية من الإعدادات. في النسخة المكتبية النسخ الاحتياطي مسؤوليتك."],
    ["الاشتراك والإيقاف", "تستطيع إيقاف اشتراكك وتصدير بياناتك في أي وقت. قد نوقف حساباً يخالف هذه الشروط بعد إشعاره."],
    ["التعديل", "قد تُحدَّث هذه الشروط، ويُعلن التحديث داخل النظام قبل سريانه."],
  ] },
};

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const d = SEC[kind];
  useEffect(() => { document.title = `${d.title} — ${CFG.appName || "ميزان ERP"}`; }, [kind]);
  return (
    <main className="legal" style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px", lineHeight: 1.9 }}>
      <div className="row" style={{ justifyContent: "space-between" }}><a href="/login">→ العودة إلى الدخول</a><LangToggle className="btn sm" /></div>
      <h1 style={{ marginTop: 12 }}>{d.title}</h1>
      <p className="muted small">{CFG.appName || "ميزان ERP"} — هذا النص وصف عام لطريقة عمل النظام، وعلى مشغّل الخدمة مراجعته واعتماده قانونياً قبل الاعتماد عليه تجارياً.</p>
      {d.body.map(([h, t]) => <section key={h}><h2 style={{ fontSize: "1.1rem", marginBottom: 4 }}>{h}</h2><p style={{ marginTop: 0 }}>{t}</p></section>)}
      <p className="small muted"><a href={kind === "privacy" ? "/terms" : "/privacy"}>{kind === "privacy" ? "شروط الاستخدام" : "سياسة الخصوصية"}</a></p>
    </main>
  );
}
