import { generateId } from "../ids"

// Customer — a registered buyer.

export interface Customer {
  id: string
  name: string
  email: string
  registeredAt: Date
}

export function registerCustomer(name: string, email: string): Customer {
  return { id: generateId("cus"), name, email, registeredAt: new Date() }
}
