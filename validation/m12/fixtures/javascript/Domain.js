// Domain.js — ESM module: types, classes, functions, exports.
// Mirrors the C#/TS family Domain fixture (Example.Domain namespace shape).

export class UserId {
  constructor(value) {
    this.value = value
  }

  toString() {
    return String(this.value)
  }
}

export const Status = {
  None: 0,
  Active: 1,
  Inactive: 2,
}

export class Customer {
  constructor(id, name) {
    this.id = id
    this.name = name
  }

  describe() {
    return `${this.id}:${this.name}`
  }
}

export class Repository {
  constructor(store) {
    this.store = store
  }

  findById(id) {
    return this.store.get(id)
  }

  save(customer) {
    this.store.set(customer.id, customer)
  }
}

export function findById(repo, id) {
  return repo.findById(id)
}

export function findAll(repo) {
  return repo.store.values()
}
