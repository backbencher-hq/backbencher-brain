// A cart with an intentional, fixable pricing bug used by the W0 fixture task.
export function subtotal(items) {
  return items.reduce((sum, it) => sum + it.price * it.qty, 0)
}

// BUG (W0 fixture): ignores quantity discounts entirely.
export function discount(items) {
  return 0
}

export function total(items) {
  return subtotal(items) - discount(items)
}
