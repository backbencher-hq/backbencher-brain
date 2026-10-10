# TypeScript Analyzer

## What it extracts
- **Symbols**: classes, interfaces, enums, type aliases, functions, methods,
  constructors, properties, accessors (get/set pair = one property), abstract members
- **Relationships**: extends, implements, instantiates, calls, uses (field access),
  contains, exports, overrides, references (imports + declared types: interface
  members, fields, params, returns, locals; as-casts, instanceof checks)
- **Payloads**: qualified_calls, JSDoc comments, complexity (per-symbol cyclomatic),
  decorators, visibility, genericParameters, isMappedType, isConditionalType

## Evidence tiers
Same rules as JVM family. Heritage edges structural. Calls usage_contextual.

## Type-reference semantics
- Every `type_annotation` emits references to its named types (primitives and
  builtin wrappers excluded); generics expand; nullable/union/readonly descend
- Return annotations directly on functions/methods after the parameter list
  are labelled `return_type`
- `x as T` → cast_target; `y instanceof T` → instanceof_check (target lexes
  as plain identifier in expression position — handled)

## Known limitations
- Decorator variants: class, property, method, constructor and parameter
  decorators are all covered and pinned (`decorators`, `decorator-lines-860`,
  `decorator-exact`, `decorator-declaration-lines-861`, `controller-base`)
- Grammar surface is enumerated in `script/m14/spec/typescript-completeness.json`
  (handled_verified / internal_silent / closed gaps / 30 design decisions), with
  a tsx-dialect annex for the JSX node types
- A class EXPRESSION assigned to a variable (`const A = class Inner { m() {} }`)
  yields the variable symbol but not the class's members: the variable path
  suppresses descent for every non-`object` initializer, so only an
  `export default class` (which the export statement pushes directly) keeps
  them. The ledger lists `class` as handled_verified, and the coverage gate
  validates that by node-type OCCURRENCE in fixtures, not by emission — which is
  how this shape stayed invisible. Unfixed: recorded, not pinned.
- `linesOfCode` counts all lines to match the javascript twin; both over-count a
  trailing newline by one (family-level, left alone)

## Verification
- Fixtures: **102** (`validation/m14/fixtures/typescript/`) — **96 pass, 6 fail**, and the six
  are already recorded per-lane in `validation/m14/fixture-baseline.json`, so the fixture gate
  reports *no regressions* rather than a clean lane: `calls-callee-shape-reduction`,
  `heritage-parameterized-leaves`, `re-export-empty-clause`, `re-export-module-dependency`,
  `type-predicate-and-constraint-refs`, `type-reference-uses-surfaces`. Measured
  2026-10-10 with `bun run script/m14/run-fixtures.ts --lang typescript` at `04b89f377`.
- Corpus: `vue-core@f8975657` differential 100% coverage / 0.9% unexplained — **not
  reproducible in this checkout**: there is no `vue-core` directory under the corpus root
  (the Vue core clone here is named `vuejs`, at a different commit), the pinned revision is
  not in it, and this machine has no network (`git fetch` → `Proxy CONNECT aborted`). The
  lane's scoped differential therefore runs on the corpus that IS present —
  `bun script/m14/differential.ts --repo element-plus --lang typescript` → **exit 0**, 90.3%
  coverage, `unexplained 23 (2%)` naming only `references` and `uses`. Restoring the pin is a
  corpus-registry job: clone vuejs/core at `f8975657d7451d8e4291406427e6a8ae5e50c8d5` as
  `<corpus root>/vue-core` (per `validation/m11/corpus-manifest.json`), then re-run unscoped.
- Grammar audit: PASS (union oracle: TS + TSX + JS)

## Relationship-type coverage — all ten, registered (2026-10-09)
- **Firing (production `parseFile`, rxjs 200 files): 10/10**, every type fired,
  `imports[]` 704 in 195 files — `bun script/m14/firing-check-v2.mjs TYPESCRIPT`
- **Audited: 10/10** — the differential admits every type the lane emits, and
  `bun script/m14/ts-deriv-oracle-audit.ts --files 60 --repo rxjs` measures all
  ten: `imports` 501/501 and `exports` 61/61 at 100%, `calls` 563/563,
  `contains` 376/376, `references` 83.1% and `uses` 64.8% with triaged families
- **Incoming: declared, PASS** — `npx tsx script/m14/ts-incoming-gate.ts`, 37
  classes in `validation/m14/instruments/typescript/incoming-baseline.json`;
  **31.4% bind / 52.0% bind+declared-external** of 84,111 edges, and the residue
  (28,417 ambiguous · 4,626 by-design · 7,335 not provable) is declared with a
  ceiling per class. "All ten types covered" is measured; "all edges resolve" is
  not the claim — the gate prints the backlog on every run.
- **Arbiter (emission): 10/10 EMITTED** — `npx tsx script/m14/ontology-coverage-gate.ts
  typescript` → **exit 0**, `emitted 10/10  FALSIFIED 0  ruled-without-justification 0`,
  **over the 2,167 files that pass parsed** while the walk stood at 10,328/10,328 across
  resumes. Both numbers are the claim: the walk's 100% is checkpoint coverage, the table is
  a count over the files the pass parsed. This used to exit 2 with "no RULING SOURCE" — the
  lane has no un-emitted type to rule, and the guard read that absence as missing evidence.
  It now says which verdict it gives: *all 10 EMITTED, this run adjudicates EMISSION, not
  rulings*; the walk line prints the population its counts cover; and a run that parsed no
  file at all refuses to report (`NOTHING MEASURED`, exit 2) instead of printing `0/10`
  off a 100% walk. **A whole-corpus verdict is still out of reach**: three passes that
  re-walked every file died mid-walk (exit 1, the 120s hang guard, ~4 min in), so 10,328
  files cannot be parsed in one process — the counts have to travel per file in the
  checkpoint (open work).
- The sweep's measurements live in `docs/analyzers/typescript-ambiguity-sweep.md`;
  the fleet-level registration is in `docs/analyzers/ONTOLOGY-PROGRESS.md`.

## The walk that would not finish (fixed 2026-10-10)
Full-corpus TS runs kept dying at **4,230/10,328 files** and re-running always resumed
into the same death. It is not a bad file: the file named in both the trap and the hang
(`metabase/…/HighlightExpression/utils.ts`, 32 lines) parses clean **alone** in 1.2 s with
16 relationships. A WASM trap (`memory access out of bounds`) corrupts the tree-sitter
module, the next parse hangs, and the 120 s guard answers a hang with `process.exit()` —
which cannot flush a checkpoint. The walk recorded a file only after its parse succeeded,
so the killer was never recorded and every re-run re-walked it.
`script/m14/resumable-walk.ts` now appends an **in-flight marker before each parse**; a kill
leaves `?<path>` behind, the next run abandons that path (reported as
`ABANDONED-AFTER-KILL`, never retried) and carries on. The walk now covers all 10,328 files
in the checkpoint (from 4,230 in two days), and the arbiter above is the verdict that was
previously unreachable — scoped to the files its pass parsed, which is the only population a
single process can honestly report.
`script/m14/resumable-walk-selftest.ts` drives the path with a real child-process kill
(7/7 checks); cost, stated rather than hidden: a kill sacrifices up to `concurrency`
in-flight files, and they are named in the checkpoint.
