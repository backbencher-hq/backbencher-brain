import type { StockLine } from "../models/product"

// InventoryService — tracks on-hand stock and guards against overselling.

export class InventoryService {
  private stock = new Map<string, number>()

  seed(lines: StockLine[]): void {
    for (const line of lines) this.stock.set(line.sku, line.onHand)
  }

  canFulfill(sku: string, quantity: number): boolean {
    return (this.stock.get(sku) ?? 0) >= quantity
  }

  reserve(sku: string, quantity: number): boolean {
    if (!this.canFulfill(sku, quantity)) return false
    this.stock.set(sku, (this.stock.get(sku) ?? 0) - quantity)
    return true
  }

  release(sku: string, quantity: number): void {
    this.stock.set(sku, (this.stock.get(sku) ?? 0) + quantity)
  }
}
