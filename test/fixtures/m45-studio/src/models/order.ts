import { Money } from "../money"
import type { Clock } from "../clock"

// Order — an aggregate of lines with a priced total and a lifecycle status.

export type OrderStatus = "draft" | "placed" | "shipped" | "cancelled"

export interface OrderLine {
  sku: string
  quantity: number
  lineTotal: Money
}

export interface Order {
  id: string
  customerId: string
  status: OrderStatus
  lines: OrderLine[]
  total: Money
  placedAt: Date
}

export function newOrderAt(customerId: string, clock: Clock): Order {
  return {
    id: "",
    customerId,
    status: "draft",
    lines: [],
    total: Money.zero(),
    placedAt: clock.now(),
  }
}
