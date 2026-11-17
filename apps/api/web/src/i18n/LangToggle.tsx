/** The language switch: one button that reloads the app in the other language. Hidden in editions without an English interface. */
import React from "react";
import { I18N, setLang } from "./index";

export function LangToggle({ className = "btn sm ghost" }: { className?: string }) {
  if (!I18N.allowed) return null;
  const en = I18N.on;
  // on a phone the top bar keeps only the short form (EN / ع)
  return <button type="button" className={className + " lang-toggle"} lang={en ? "ar" : "en"} data-lang-toggle title={en ? "عرض الواجهة بالعربية" : "Show the interface in English"} aria-label={en ? "العربية" : "English"} onClick={() => setLang(en ? "ar" : "en")}><span className="lt-long">{en ? "العربية" : "English"}</span><span className="lt-short" aria-hidden="true">{en ? "ع" : "EN"}</span></button>;
}
