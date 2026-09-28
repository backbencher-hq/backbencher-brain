import { registerCustomer, type Customer } from "../models/customer"

// CustomersRouter — registration and lookup handlers.

const registry = new Map<string, Customer>()

export function handleRegisterCustomer(name: string, email: string): string {
  const customer = registerCustomer(name, email)
  registry.set(customer.id, customer)
  return JSON.stringify({ id: customer.id })
}

export function handleGetCustomer(id: string): string {
  const customer = registry.get(id)
  return customer
    ? JSON.stringify({ id: customer.id, name: customer.name })
    : JSON.stringify({ error: "unknown customer" })
}
