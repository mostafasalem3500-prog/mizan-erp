/** Outgoing email (optional). Configured through env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE=true|false. */
import nodemailer from "nodemailer";
import { bad } from "../lib/core";

export function mailStatus() {
  const host = process.env.SMTP_HOST;
  return { configured: !!host, from: process.env.SMTP_FROM || process.env.SMTP_USER || null, host: host || null };
}

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (transport) return transport;
  const { configured } = mailStatus();
  if (!configured) throw bad("خدمة البريد غير مفعّلة — اضبط متغيرات SMTP_HOST وSMTP_USER وSMTP_PASS وSMTP_FROM على الخادم");
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text?: string; replyTo?: string; fromName?: string }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.to || "")) throw bad("عنوان البريد غير صحيح");
  const t = getTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const info = await t.sendMail({ from: opts.fromName ? `"${opts.fromName.replace(/"/g, "")}" <${from}>` : from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, replyTo: opts.replyTo });
  return { messageId: info.messageId };
}

/** Simple RTL email shell. */
export function emailLayout(company: any, title: string, bodyHtml: string) {
  return `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#f3f6f5;font-family:Tahoma,Arial,sans-serif;color:#0f1f1e">
  <div style="max-width:640px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8e7">
    <div style="background:#0f4c47;color:#fff;padding:16px 22px"><div style="font-size:18px;font-weight:700">${company.nameAr}</div>${company.vatNumber ? `<div style="font-size:12px;opacity:.85">الرقم الضريبي: ${company.vatNumber}</div>` : ""}</div>
    <div style="padding:22px"><h2 style="margin:0 0 12px;font-size:17px">${title}</h2>${bodyHtml}</div>
    <div style="padding:12px 22px;background:#f8fafa;font-size:12px;color:#556">${[company.phone, company.email, company.city].filter(Boolean).join(" · ")}</div>
  </div></body></html>`;
}
