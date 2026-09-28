# Clean Analyzer

Full contract: [`real-clean-analyzer.md`](./real-clean-analyzer.md). Review with
evidence: [`reviews/clean/m14-0-clean-completeness.md`](../../reviews/clean/m14-0-clean-completeness.md).

## What it extracts
- **Symbols**: modules, ADT types, data constructors, records + record fields,
  classes, instances, class/instance methods, generics (`generic_declaration`),
  generic case functions (`generic_case_definition`), type synonyms, operators,
  **macros** (`macro_definition`), `foreign export`s, fixity declarations, and
  `where`/`with`/`let` locals
- **Relationships**: `calls` (incl. class-dictionary calls and source-spelled
  qualified targets), `instantiates` (declared data constructors only), `uses`
  (record-field read/construct/update + constructor patterns), `implements`
  (instances and `derive`), `references` (the whole type spine + imported
  modules), `imports` (per-item, `Module:item`), `contains`, `exports`
- **Payloads**: `parameters` (real: one per `pattern` field, paired with the
  signature's domain types), `returnType` (the third child of `type_function`),
  `genericParameters`, `comments` + `docstring`, `qualified_calls`, per-symbol
  complexity, `fixity`, `classContext`, `isAbstract` members

## Evidence tiers
`contains` and `exports` structural. `instantiates`, `uses` and in-file `calls`
**in-file-proven**: the target must be a name this file publishes (a local
resolves by its scoped identity, a module callable by its bare name). `implements`,
`references` and qualified `calls` survive an external target because their
MEANING does not depend on what the target is. Full table in the contract doc.

## Clean-specific semantics
- **A `type_definition`'s name is a `constructor`-typed node.** The grammar gives
  a record type, an ADT type and a data constructor the same node type, so an
  `instantiates` edge keyed off node type cannot tell them apart. Over the
  1,923 corpus sites that are uppercase applied names and NOT an in-file data
  constructor, **49.19% are declared in-file as a function, macro, class or type**
  and 50.81% are declared nowhere, so at most 2.96% could be a data constructor.
  `instantiates` is therefore emitted only for names declared by a
  `data_constructor`, and the declined count is published as
  `metadata.declinedInstantiations`.
- **`instance_declaration` has no `constructor` child** — 253 of 741 instances
  take their target from the `argument` field (`array_type`, `list_type`,
  `type_variable`, …). Reading a child dropped those instances, their
  `implements` edges, and 1,009 member scopes.
- **Applications are left-nested.** Only the innermost `application` carries the
  callee, in its `function` field; the nest is not a head.
- **A function type's domain is a `type_application` whose children ARE the
  parameters**, so signature domain types pair positionally with the
  definition's `pattern` fields. No arrow scan over source text is needed.
- **`where`/`with`/`let` binders are real callables** with a scoped identity
  (`<frame>.<name>`) that rides `qualifiedName`, so a call resolves to the local
  while the symbol keeps the bare declared name. Adopted from the haskell lane.
- **Clean has no `export` keyword** — a `.dcl`'s definition list IS the interface,
  so the export surface is a first-class `exports` edge, not only an array.

## Known limitations
- `index_access` emits nothing (307 corpus sites) — the indexed value's type is
  unknown, and naming the receiver would be a `uses` edge to a value, which is
  the FP family. Spec gap `CL-G1`, recorded not ruled.
- An uppercase applied name that is not an in-file data constructor emits no edge
  (1,049 declined of a 1,923-site population) — see the row above.
- The **M14.0.F5 differential is red on this lane** (527 MISSING on the Clyde
  draw, 49 on clean-stdlib): the shared oracle derives `instantiates` from every
  `constructor`-headed application. The divergence is deliberate and written up
  in the review; the shared oracle was not modified.
- `?Just 0` in a body is an ERROR in the pinned grammar, so the unboxed BUILD
  direction is unreachable (ruling `CL-D8`); the unboxed PATTERN direction works.
- `from M import :: (Ok)` — a subset with no name in front of it — is unreadable:
  the grammar ends the declaration at the `::` and emits an `identifier` with
  EMPTY text (`CL-G5`).
- A `where` block's extent runs to the next DECLARATION and absorbs a column-0
  comment written after an indented body. A blank line does not close it.

## Verification
- Fixtures: **8**, all passing (`validation/m14/fixtures/clean/`) — three of them
  new this round (`declaration-forms`, `qualified-names`,
  `type-and-expression-shapes`), added because 11 handled node types had no
  fixture behind them.
- Census: every figure in this file and in the review is recomputed by
  `bun run script/m14/clean-census.ts`, which is how several of them were found to
  be wrong and corrected.
- **M12 differential: precision 1.000, recall 1.000, 0 FP, 0 FN** against a
  134-row hand-audited ground truth (`validation/m12/ground-truth/clean.json`),
  extended from 68 rows this round with 67 audited additions and 1 documented
  withdrawal. `script/m12/extend-clean-ground-truth.py` re-audits it and fails on
  line drift.
- **Corpus: 312 files, 331,079 nodes → 8,336 symbols, 30,558 relationships**, 0
  unknown kinds, 0 empty names, 0 ownerless members, 0 crash files, and every one
  of the 30,558 relationships on a positive line.
- Honesty gate: every edge endpoint resolves under the store's own three
  resolution strategies; every edge type is 100% provable except the 322
  `implements` edges whose class is imported (`script/m14/clean-honesty-gate.ts`).
- Grammar census: all **137** distinct named types classified in
  `script/m14/spec/clean-completeness.json` (99 `handled_verified` and
  fixture-backed, 29 `internal_silent`, 1 `gap`, 8 `design_decision`).
  Gate: `script/m14/clean-completeness-gate.ts`, proven to fail on 4 defect classes.
- Hygiene: **zero regex literals** in the analyzer, and all 25 analyzers pass
  `script/m14/verify-analyzer-hygiene.ts`.
- Performance: analyzer-only, warm, best of 5, load disclosed — 2.64 → 5.60
  ms/Knode for 2.75× the relationships; **linear within 8%** across a 23× size
  range (Q2 6.19 → Q4 6.71 ms/Knode).
