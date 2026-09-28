import { Money } from "../money"
import type { Product } from "../models/product"

// PricingService — the single source of truth for line totals and order
// totals, including the volume-discount rule.

const VOLUME_DISCOUNT_THRESHOLD = 10
const VOLUME_DISCOUNT_RATE = 0.95

export class PricingService {
  lineTotal(product: Product, quantity: number): Money {
    const base = product.unitPrice.multiply(quantity)
    return quantity >= VOLUME_DISCOUNT_THRESHOLD
      ? base.multiply(VOLUME_DISCOUNT_RATE)
      : base
  }

  orderTotal(lines: Money[]): Money {
    const currency = lines.length > 0 ? lines[0].currency : "USD"
    return lines.reduce((sum, line) => sum.add(line), Money.zero(currency))
  }
}
