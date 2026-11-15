// ─────────────────────────────────────────────────────────────────────────────
// PIN CORRECTED 2026-10-17 (Lead-authorised pin-change set, iteration 2d).
// Contract: a type MENTION emits a `uses` row and drops the DUPLICATE `references`
// row (one-label ruling, direction corrected). This fixture pinned the old
// `references` behaviour, so its pin moved with the contract:
//   expected `references X -> T`  ->  expected `uses X -> T`, and
//   forbid the duplicate `references X -> T`.
// Stated only where this fixture's own rows changed (see each row's note).
// ─────────────────────────────────────────────────────────────────────────────
// A type mention inside a TYPE ALIAS was attributed to a symbol named `global`,
// which is not a symbol in the file — so the edge dangled at the source end.
//
// `extractDeclaredTypeRefs` walks up from a type mention looking for the
// declaration that owns it, and used to answer the literal string `"global"`
// when the walk found none. A type alias is a declaration and a symbol, and it
// was missing from that walk's list, so every mention inside
// `type AutoIndexState = { index: IndexDetection }` produced a SECOND row
// alongside the correct `AutoIndexState->IndexDetection` that the main reference
// pass had already emitted — the same edge twice, disagreeing about its owner.
//
// Measured over 700 tracked files: 212 such rows, and `global` was never once a
// real symbol in any of them, so every one was unresolvable at the source end.
// The main reference pass had already recorded the mention correctly in 163 of
// them; 62 named a target that no declaration in the file owned (`Error` and
// other builtins), so those dangled at BOTH ends; and the remaining 3 sit in
// files that do not parse, where ownership is not recoverable.
//
// The fix has two halves and the second is the one that makes the first safe.
// Widening the walk to cover type aliases would attach every mention to a real
// owner, but two passes cover type mentions and NEITHER could see the other's
// rows, so widening it on its own converted 212 wrong-source duplicates into 212
// right-source duplicates: `AutoIndexState->IndexDetection` went from one row to
// two. The owner is now resolved properly AND the pass checks the shared
// relationship array before publishing, so the overlap is dropped instead of
// doubled. That check also removed 409 pre-existing duplicate rows corpus-wide.
//
// Authored BEFORE the analyzer run.
interface IndexDetection {
  present: boolean;
  projectId: string;
}

interface ScaleEstimate {
  files: number;
}

type RunnerResult = {
  code: number;
  signal: AbortSignal;
};

// The alias owns the mentions its body makes.
export type AutoIndexState = {
  index: IndexDetection;
  scale: ScaleEstimate;
};

// A union alias, the shape that produced the most `global` rows.
export type IndexRunner = {
  runner: (signal: AbortSignal) => Promise<RunnerResult>;
};

// A class body mentions a type too, and that path was already correct.
export class Registry {
  current: IndexDetection;
  constructor(current: IndexDetection) {
    this.current = current;
  }
}

// A function's return type is owned by the function.
export function detect(): IndexDetection {
  return { present: false, projectId: "" };
}
