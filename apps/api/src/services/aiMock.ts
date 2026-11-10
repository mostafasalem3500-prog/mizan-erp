/** Test stand-in for the advanced model (AI_MOCK=1): proves a turn was routed to it, without calling the API. */
export async function mockLlm(_body: any) {
  return { content: [{ type: "text", text: "[النموذج المتقدم — وضع الاختبار] استلمت الطلب." }], stop_reason: "end_turn", usage: { input_tokens: 50, output_tokens: 10 } };
}
