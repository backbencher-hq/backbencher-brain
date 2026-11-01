import { basePrice, applyDiscount } from "./pricing.js"

/** TS checkout — calls INTO the JS module. */
export function total(item: { price?: number }, discountPct: number): number {
  // latency
  const price = basePrice(item)
  return applyDiscount(price, discountPct)
}
