import { Money } from "./money"
import type { Product } from "./models/product"

// Catalog — the shop's starter products, keyed by SKU.

export function seedCatalog(): Map<string, Product> {
  const products: Product[] = [
    { sku: "ll-notebook-a5", title: "A5 Dotted Notebook", unitPrice: Money.fromMajor(9.5) },
    { sku: "ll-pen-gel", title: "Gel Pen 0.5mm", unitPrice: Money.fromMajor(2.8) },
    { sku: "ll-desk-mat", title: "Desk Mat Large", unitPrice: Money.fromMajor(24.0) },
    { sku: "ll-sticker-pack", title: "Sticker Pack", unitPrice: Money.fromMajor(4.25) },
  ]
  return new Map(products.map((p) => [p.sku, p]))
}
