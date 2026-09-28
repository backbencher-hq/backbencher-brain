import { PricingService } from "./services/pricing-service"
import { InventoryService } from "./services/inventory-service"
import { OrderService } from "./services/order-service"
import { SystemClock } from "./clock"
import { seedCatalog } from "./catalog"
import type { Product, StockLine } from "./models/product"

// App — the composition root. Every service in Ledgerline is instantiated
// exactly here; nothing news up its own dependencies.

export interface App {
  orders: OrderService
  catalog: Map<string, Product>
  clock: SystemClock
}

export function buildApp(): App {
  const clock = new SystemClock()
  const inventory = new InventoryService()
  const stock: StockLine[] = [
    { sku: "ll-notebook-a5", onHand: 120 },
    { sku: "ll-pen-gel", onHand: 500 },
    { sku: "ll-desk-mat", onHand: 40 },
    { sku: "ll-sticker-pack", onHand: 300 },
  ]
  inventory.seed(stock)
  const orders = new OrderService(new PricingService(), inventory)
  const catalog = seedCatalog()
  return { orders, catalog, clock }
}
