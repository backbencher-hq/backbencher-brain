import test from 'node:test'
import assert from 'node:assert/strict'
import { discount, total } from '../src/cart.js'

test('10% discount applies when a line has qty >= 10', () => {
  const items = [{ price: 100, qty: 10 }]
  assert.equal(discount(items), 100)          // FAILS before the fix
})

test('no discount below the threshold', () => {
  const items = [{ price: 100, qty: 3 }]
  assert.equal(discount(items), 0)
})

test('total subtracts the discount', () => {
  const items = [{ price: 100, qty: 10 }]
  assert.equal(total(items), 900)             // FAILS before the fix
})
