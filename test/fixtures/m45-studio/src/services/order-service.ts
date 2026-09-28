import { Money } from "../money"
import { generateId } from "../ids"
import { newOrderAt, type Order, type OrderLine } from "../models/order"
import type { Product } from "../models/product"
import type { PricingService } from "./pricing-service"
import type { InventoryService } from "./inventory-service"
import { err, ok, type Result } from "../result"

// OrderService — the domain heart: validates a cart, prices every line,
// reserves stock, and emits a placed Order. All failure paths return a
// Result so callers never try/catch domain rules.

export interface CartLine {
  product: Product
  quantity: number
}

export class OrderService {
  constructor(
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
  ) {}

  place(cart: CartLine[], customerId: string): Result<Order> {
    if (cart.length === 0) return err("cart is empty")

    for (const line of cart) {
      if (!this.inventory.canFulfill(line.product.sku, line.quantity)) {
        return err("insufficient stock for " + line.product.sku)
      }
    }

    const priced: OrderLine[] = cart.map((line) => ({
      sku: line.product.sku,
      quantity: line.quantity,
      lineTotal: this.pricing.lineTotal(line.product, line.quantity),
    }))

    const order = newOrderAt(customerId, { now: () => new Date() })
    order.id = generateId("ord")
    order.status = "placed"
    order.lines = priced
    order.total = this.pricing.orderTotal(priced.map((l) => l.lineTotal))

    for (const line of cart) {
      this.inventory.reserve(line.product.sku, line.quantity)
    }
    return ok(order)
  }

  cancel(order: Order): Result<Order> {
    if (order.status !== "placed") return err("cannot cancel from " + order.status)
    for (const line of order.lines) {
      this.inventory.release(line.sku, line.quantity)
    }
    order.status = "cancelled"
    return ok(order)
  }

  totalOf(order: Order): Money {
    return order.total
  }
}
