import type { OrderService, CartLine } from "../services/order-service"
import type { Order } from "../models/order"

// OrdersRouter — HTTP-shaped handlers over the domain. Deliberately thin:
// every rule lives in OrderService, the router only translates shapes.

export interface CreateOrderBody {
  customerId: string
  lines: { sku: string; quantity: number }[]
}

export function handleCreateOrder(
  service: OrderService,
  catalog: Map<string, CartLine["product"]>,
  body: CreateOrderBody,
): string {
  const cart = body.lines
    .map((line) => ({ product: catalog.get(line.sku), quantity: line.quantity }))
    .filter((l): l is CartLine => Boolean(l.product))

  const result = service.place(cart, body.customerId)
  return result.ok
    ? JSON.stringify({ orderId: result.value.id, total: result.value.total.format() })
    : JSON.stringify({ error: result.error })
}

export function handleCancelOrder(service: OrderService, order: Order): string {
  const result = service.cancel(order)
  return result.ok
    ? JSON.stringify({ status: result.value.status })
    : JSON.stringify({ error: result.error })
}
