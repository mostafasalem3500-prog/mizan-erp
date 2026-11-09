/**
 * Promotions engine — pure functions, the same code runs in the POS (web/src/shared/promoEngine.ts is a copy) so
 * the cashier sees exactly the discount the server books. Keep both files identical.
 *
 * Kinds: PERCENT (x% off), FIXED_PRICE (special unit price), BUY_X_GET_Y (buy X, Y more free — given as a line %).
 * Only the best offer applies to a line (no stacking); a manual line discount and the ticket discount still combine.
 */
export type Promo = {
  id: string; name: string; kind: string; scope: string; productIds: string[]; categoryIds: string[];
  value: number | string; buyQty: number | string; getQty: number | string; minQty: number | string; minTotal: number | string;
  dateFrom?: string | null; dateTo?: string | null; days?: number[] | null; timeFrom?: string | null; timeTo?: string | null;
  channels?: string[] | null; priority?: number | null; isActive?: boolean;
};
export type PromoLine = { productId: string; categoryId?: string | null; qty: number; unitPrice: number };
export type PromoHit = { promotionId: string; name: string; pct: number } | null;

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Riyadh wall clock (UTC+3, no DST) for a moment. */
export function riyadhParts(at: Date) {
  const d = new Date(at.getTime() + 3 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), day: d.getUTCDay(), hm: d.toISOString().slice(11, 16) };
}

export function promoActive(p: Promo, at: Date, channel: string) {
  if (p.isActive === false) return false;
  if (p.channels && p.channels.length && !p.channels.includes(channel)) return false;
  const { date, day, hm } = riyadhParts(at);
  const df = p.dateFrom ? String(p.dateFrom).slice(0, 10) : null, dt = p.dateTo ? String(p.dateTo).slice(0, 10) : null;
  if (df && date < df) return false;
  if (dt && date > dt) return false;
  if (p.days && p.days.length && !p.days.map(Number).includes(day)) return false;
  if (p.timeFrom && p.timeTo) {
    const inside = p.timeFrom <= p.timeTo ? hm >= p.timeFrom && hm < p.timeTo : hm >= p.timeFrom || hm < p.timeTo; // overnight window
    if (!inside) return false;
  }
  return true;
}

export function promoCovers(p: Promo, l: PromoLine) {
  if (p.scope === "PRODUCTS") return (p.productIds || []).includes(l.productId);
  if (p.scope === "CATEGORIES") return !!l.categoryId && (p.categoryIds || []).includes(l.categoryId);
  return true;
}

/** Discount % the offer gives on this line (0 when not applicable). */
export function promoPct(p: Promo, l: PromoLine) {
  const qty = n(l.qty), price = n(l.unitPrice);
  if (qty <= 0 || price <= 0 || !promoCovers(p, l)) return 0;
  if (n(p.minQty) > 0 && qty < n(p.minQty)) return 0;
  if (p.kind === "PERCENT") return Math.max(0, Math.min(100, n(p.value)));
  if (p.kind === "FIXED_PRICE") return n(p.value) >= 0 && n(p.value) < price ? r4((1 - n(p.value) / price) * 100) : 0;
  if (p.kind === "BUY_X_GET_Y") {
    const x = n(p.buyQty), y = n(p.getQty);
    if (x <= 0 || y <= 0) return 0;
    const free = Math.floor(qty / (x + y)) * y;
    return free > 0 ? r4((free / qty) * 100) : 0;
  }
  return 0;
}

/** Best offer per line; «minimum invoice» offers are checked against the cart value before offers. */
export function applyPromotions(promos: Promo[], lines: PromoLine[], at: Date, channel: string): PromoHit[] {
  const live = promos.filter((p) => promoActive(p, at, channel)).sort((a, b) => n(b.priority) - n(a.priority)); // ties: higher priority wins
  const gross = lines.reduce((a, l) => a + n(l.qty) * n(l.unitPrice), 0);
  return lines.map((l) => {
    let best: PromoHit = null;
    for (const p of live) {
      if (n(p.minTotal) > 0 && gross < n(p.minTotal)) continue;
      const pct = promoPct(p, l);
      if (pct > 0 && (!best || pct > best.pct)) best = { promotionId: p.id, name: p.name, pct };
    }
    return best;
  });
}

/** Manual line %, offer % and ticket % combine multiplicatively (the same rule as the POS ticket discount). */
export const combinePct = (...pcts: number[]) => r4(100 - pcts.reduce((rest, p) => (rest * (100 - Math.max(0, Math.min(100, n(p))))) / 100, 100));
