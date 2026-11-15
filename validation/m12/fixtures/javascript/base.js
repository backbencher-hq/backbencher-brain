// base.js — base class + helper for the Features override test.

export class BaseService {
  constructor(prefix) {
    this.prefix = prefix
  }

  format(value) {
    return this.prefix + String(value)
  }
}

export function helper(value) {
  return value.trim()
}
