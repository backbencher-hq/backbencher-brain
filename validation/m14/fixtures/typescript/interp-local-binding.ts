// Template-literal interpolation: WHICH names it reads.
//
// The lane's contract (TSD2, R12) is not "every substituted identifier is a use".
// It is:
//   - a PARAMETER read publishes, because the graph records `${name}` inside
//     `greet` as a use of `name` and `interp-uses` pins exactly that; and
//   - a name bound by a LOCAL DECLARATOR does not, because the substitution
//     reads the local and not a same-named module or class symbol.
//
// The second half is the half that is easy to get wrong in either direction, and
// both wrong directions are pinned below. A read that appears in a SIBLING
// STATEMENT of the declarator is still a read of the local — that is the case a
// per-subtree binding test misses — and a read that appears BEFORE the
// declarator is a temporal-dead-zone reference that the language rejects, so the
// fixture does not assert anything about it and the doc records the choice.
//
// `topLevel` is a module-scope symbol, so a function-local `const topLevel`
// shadows it and the substitution must read the local, not the module symbol.
const topLevel = "module scope"

export function readsParameter(param: string): string {
  return `a ${param} b`
}

export function suppressesLocal(): string {
  const local = 1
  return `a ${local} b`
}

export function suppressesSiblingLocal(): string {
  const local = 2
  log(`a ${local} b`)
  return "done"
}

export function suppressesShadowingModuleSymbol(): string {
  const topLevel = 3
  return `a ${topLevel} b`
}

export function suppressesLoopVariable(items: string[]): string {
  for (const item of items) log(`a ${item} b`)
  return "done"
}

export function keepsLoopVariableCall(items: string[]): string {
  for (const item of items) item.trim()
  return "done"
}

export function destructuresThenReads(payload: { name: string; size: number }): string {
  const { name, size } = payload
  return `a ${name} b ${size}`
}
