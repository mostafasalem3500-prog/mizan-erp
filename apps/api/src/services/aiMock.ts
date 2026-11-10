/** Scripted stand-in for the model (AI_MOCK=1): exercises the same tool loop in tests without calling the API. */
export async function mockLlm(body: any): Promise<{ content: any[]; stop_reason: string; usage: { input_tokens: number; output_tokens: number } }> {
  const usage = { input_tokens: 100, output_tokens: 20 };
  const msgs: any[] = body.messages;
  const last = msgs[msgs.length - 1];
  const sys: string = body.system?.[0]?.text || "";
  const text = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage });
  const use = (name: string, input: any) => ({ content: [{ type: "tool_use", id: `tu_${Date.now()}_${Math.round(Math.random() * 1e6)}`, name, input }], stop_reason: "tool_use", usage });
  const userText = () => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") { const b = [...msgs[i].content].reverse().find((x: any) => x.type === "text" && !x.text.startsWith("[النظام]") && !x.text.startsWith("[مرفق")); if (b) return b.text as string; } return ""; };
  const q = userText();
  const tr = last.content.find((b: any) => b.type === "tool_result");
  if (tr) {
    const prev = msgs[msgs.length - 2].content.find((b: any) => b.type === "tool_use");
    const res = JSON.parse(tr.content);
    if (prev.name === "propose") return text(res.error ? `تعذّر تجهيز الخطة: ${res.error}` : "جهّزت الخطة: مصروف مع ضريبة المدخلات. راجعها ثم اضغط تأكيد.");
    const chart = sys.split("## دليل الحسابات")[1]?.split("## حسابات النقدية")[0] || "";
    const rows = chart.split("\n").map((l) => l.split("|")).filter((r) => r.length >= 4);
    const exp = rows.filter((r) => r[2] === "EXPENSE");
    const account = exp.find((r) => /مياه|كهرباء|منافع/.test(r[1])) || exp[0];
    const cash = (sys.split("## حسابات النقدية")[1] || "").split("\n").map((l) => l.split("|")).filter((r) => r.length === 3 && /^[0-9a-f-]{36}$/.test(r[2]))[0];
    const amount = Number((q.match(/(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const credit = /آجل|اجل/.test(q);
    const name = (q.match(/المورد\s+([^،,.\n]+)/) || [])[1]?.trim() || "مورد عام";
    const found = res.partners?.[0];
    const actions: any[] = [];
    if (!found) actions.push({ type: "create_partner", ref: "p1", role: "SUPPLIER", name });
    actions.push({ type: "expense", description: /مياه/.test(q) ? "فاتورة مياه المكتب" : "مصروف", accountId: account[account.length - 1], amount, amountIncludesVat: /شامل/.test(q), taxCode: "S", payAccountId: credit ? undefined : cash?.[2], ...(found ? { partnerId: found.id } : { partnerRef: "p1" }) });
    return use("propose", { summary: `تسجيل مصروف بمبلغ ${amount}`, actions });
  }
  if (/اشرح|كيف|لماذا/.test(q)) return text("شرح: من ح/ المصروف + ح/ ضريبة المدخلات إلى ح/ الصندوق.");
  if (!/\d/.test(q)) return text("كم مبلغ الفاتورة؟ وهل هو شامل الضريبة؟");
  return use("search_partners", { query: (q.match(/المورد\s+([^،,.\n]+)/) || [])[1]?.trim() || "مورد عام", role: "SUPPLIER" });
}
