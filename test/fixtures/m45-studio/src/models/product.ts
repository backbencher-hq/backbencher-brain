import { Money } from "../money"

// Product — a sellable item and its unit price.

export interface Product {
  sku: string
  title: string
  unitPrice: Money
}

export interface StockLine {
  sku: string
  onHand: number
}
