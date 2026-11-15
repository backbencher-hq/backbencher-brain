// Negative.js — constructs that must NOT appear as symbols/relationships:
// locals, params, lambda params, destructured params, template-string call
// targets, console/Object builtins, phantom this-access uses.

export function LocalsAreNotSymbols() {
  const local = 1
  let mutable = 2
  return local + mutable
}

export function ParamsAreNotSymbols(a, b) {
  return a + b
}

export function DestructuredParamsAreNotSymbols({ id, name }, [first, second]) {
  return id + name + first + second
}

export function LambdaParamsAreNotSymbols(items) {
  return items.map((item) => item.toFixed(2)).join(",")
}

export function TemplateStringsAreNotCallTargets(value) {
  const key = `key_${value}`
  return LocalsAreNotSymbols[key]()
}

export function BuiltinsAreFiltered() {
  console.log("noise")
  const text = "x"
  return text.toString()
}

class Counter {
  constructor() {
    this.value = 0
  }

  increment() {
    this.value += 1
    return this.value
  }
}

export { Counter }
