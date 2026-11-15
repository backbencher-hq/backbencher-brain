// local-binding-spellings — names the family never publishes carry the family binding spelling.
//
// A parameter, a type parameter, a catch binding and a declaration in a nested scope are names no
// symbol table can own. Emitting them bare makes the resolver look them up by name, and the
// measured cost on this lane (cap-50 classification, 2026-10-18) was 69 rows reading unresolved or
// AMBIGUOUS against an unrelated same-named declaration. The family mechanism is
// `<caller><BINDING_SEP><binding>` + `metadata.localBinding`, which no declaration can answer and
// which `verifyBindingClaim` verifies from the target's own spelling.
//
// THE GUARDS ARE HALF THIS FIXTURE: a name is re-spelled ONLY when it is declared in this file as a
// binding, NOT published as one of this file's symbols, and NOT an import binding. `helper` below
// is a NESTED function that IS published as a symbol — so it must stay a bare resolution target;
// re-spelling it would MASK a resolution, which is why the forbid rows name its binding spelling.
function outer(cb: () => number): number {
  const local = cb()

  function helper(): number {
    return local + 1
  }

  return helper()
}

class Box<T> {
  value: T | null = null

  set(v: T): void {
    this.value = v
  }
}
