// A type mention is a USE of the type it names, from EVERY declaration that can
// write one — not only from a function body.
//
// The rule: the declaration that WRITES the mention owns it, and if the named type
// is declared in this file the mention is a `uses` edge from that owner. The gate
// is resolution, exactly as it has always been: a type the file does NOT declare
// (`Undeclared`) is a `references` row alone, because `uses` has always meant the
// target resolves to something here. That asymmetry is pinned in both directions —
// `Declared` is declared, `Undeclared` is not — so a change that dropped the
// resolution gate would add rows rather than merely move them.
//
// The four declaration-owned shapes below are the ones that were silent before this
// contract: an INTERFACE property type, a TYPE ALIAS's right-hand side, a
// MODULE-LEVEL variable annotation, and an ENUM is absent because a plain enum
// member writes no type. A function-scoped control is present at the end so a change
// that widened or narrowed the owner rule cannot pass by accident.
interface Declared {
  inner: number
}

interface Undeclared {
  inner: Declared
}

type Alias = Declared

const moduleScoped: Declared = { inner: 0 }

export function fromFunctionBody(x: Undeclared): Alias {
  return { inner: moduleScoped.inner }
}

export function fromReturnType(): Undeclared {
  return moduleScoped as Undeclared
}

// The other half of the gate, and the half a fixture that only pinned declared
// types could not see: a mention of a type this file does NOT declare gets a
// `references` row and NO `uses` row, because `uses` has always meant the target
// resolves to something here. `NotInThisFile` arrives by import, which is the
// ordinary way a real file meets a name it does not declare.
import type { NotInThisFile } from "./not-in-this-file"

export function fromAnImportedType(x: NotInThisFile): Declared {
  return moduleScoped
}
