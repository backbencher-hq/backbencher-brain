// THE IMPORTED VALUE RECEIVER (2026-11-25).
//
// A receiver root that this file binds through `import` names a VALUE whose type the DECLARING
// file states. This pass sees the binding but not the declaration, so it has no member set to
// resolve `run` inside — the honest answer is to WITHDRAW the row (`typescriptUnresolvedReceiver`),
// which makes the store drop the name binding entirely.
//
// Without the withdrawal the row fell to the store's tie-break and bound to a SAME-NAMED member
// in a THIRD file. MEASURED on a three-file repro: `workerInstance.run()` — imported from a file
// where the value is a `Worker` — bound to `other.ts:run`, a class the caller never imports and
// whose `run` the value cannot be.
//
// The import here resolves to nothing on disk (the declaring file is the repro's, not this
// fixture's), which is exactly the shape under test: a binding whose type is NOT in this file.
import { workerInstance } from "./somewhere-else";

// `Other` is load-bearing: it makes `run` genuinely ambiguous in this file's own symbol table,
// so a name-model tie-break has something wrong to pick.
class Other {
  run() {
    return "other";
  }
}

export function viaImportedValue() {
  return workerInstance.run();
}

export { Other };
