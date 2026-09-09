import { buildApp } from "./app"
import { handleCreateOrder } from "./routing/orders-router"

// Entry point — boot the app and simulate one checkout flow end to end.

const app = buildApp()

const body = {
  customerId: "cus_demo",
  lines: [
    { sku: "ll-notebook-a5", quantity: 12 },
    { sku: "ll-pen-gel", quantity: 3 },
  ],
}

const response = handleCreateOrder(app.orders, app.catalog, body)
console.log("checkout:", response)
