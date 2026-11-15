// Features.js — inheritance, overrides, accessors, static, async, generator.
import { BaseService } from "./base"

const localConstant = 42

export class User extends BaseService {
  constructor(name) {
    super(name)
    this.name = name
  }

  get current() {
    return this.name
  }

  set current(value) {
    this.name = value
  }

  async save(payload) {
    const normalized = helper(payload)
    const result = await this.store.save(normalized)
    return result
  }

  format(value) {
    return super.format(value) + "!"
  }

  *entries() {
    yield this.name
  }

  static create(name) {
    return new User(name)
  }
}

export function normalize(value) {
  return value.trim()
}

function helper(value) {
  return value
}

export const createService = (name) => new User(name)
