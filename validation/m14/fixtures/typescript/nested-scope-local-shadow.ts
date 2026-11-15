// nested-scope-local-shadow — an ENCLOSING function's local is shadowed inside a nested function.
//
// Not a stylistic edge: before this fix the usage pass RESET its local-binding set on every
// function entry, so a nested function reading its enclosing function's `let` published a
// name-resolved `references` edge (the differential classified those as UNEXPLAINED: e.g.
// `compileCode -> lastSuccessfulCode`, 196 rows over two draws). Lexical scope is inherited.
//
// THE CONTROL IS THE SECOND HALF: a module-level name read inside a function MUST still resolve to
// its declaration — the fix must not over-suppress real references.

const moduleConst = 42

export function outer(): number {
  let lastCode: string = ""

  function inner(): string {
    return lastCode
  }

  lastCode = `${inner()}-done`
  return moduleConst
}
