# Clean Analyzer

> **Every figure on this page is recomputed by `bun run script/m14/clean-census.ts
> --manifest script/m14/clean-wide-manifest.txt`** over the 2,179-file corpus
> (3,107,410 nodes). The full contract is
> [`real-clean-analyzer.md`](./real-clean-analyzer.md); the review with evidence is
> [`reviews/clean/m14-0-clean-completeness.md`](../../reviews/clean/m14-0-clean-completeness.md).
>
> **Read parse health first.** 1,524 of 2,179 files (69.9%) parse with no ERROR
> node; 655 files carry 25,683 ERROR nodes. Every percentage below is a percentage
> **of what parsed**, and that ceiling is the pinned grammar's, not the analyzer's.

## What it extracts
- **Symbols**: modules, ADT types, data constructors, records + record fields,
  classes, instances, class/instance methods, generics, generic case functions,
  type synonyms, operators, **macros**, `foreign export`s, fixity declarations, and
  `where`/`with`/`let` locals
- **Relationships**: `calls` (incl. class-dictionary calls and source-spelled
  qualified targets), `instantiates` (declared data constructors only), `uses`
  (record-field read/construct/update + constructor patterns), `implements`
  (instances and `derive`), `references` (the type spine + imported modules),
  `imports` (per-item, `Module:item`), `contains`, `exports`
- **Payloads**: `parameters` (one per `pattern` field, paired with the signature's
  domain types), `returnType` (the third child of `type_function`),
  `genericParameters`, `comments` + `docstring`, `qualified_calls`, per-symbol
  complexity, `fixity`, `classContext`, `isAbstract`, `evidenceClass`,
  `targetIsInFile`

## Evidence tiers
The shared five-value vocabulary, on every relationship
(`script/m14/clean-diff-classify.ts` is the instrument that keeps the attribution
honest):

| kind | tier |
| --- | --- |
| `contains`, `exports`, `instantiates`, `uses` | `structural` — both endpoints are names this file publishes |
| `imports` | `import_based` |
| `references` | `reference_qualified` |
| `implements` | `structural` when the class is in-file, `reference_qualified` when imported |
| `calls` | `usage_contextual` for a bare in-file name, `reference_qualified` for a source-spelled qualified target |

`targetIsInFile` is the lane's own bit, which the shared vocabulary cannot express:
**33% of all relationships have an external-by-nature target** (66,171 `references`,
1,485 `implements`). A consumer wanting only provable edges can filter on it.

## Clean-specific semantics
- **A `type_definition`'s name is a `constructor`-typed node.** The grammar gives a
  record type, an ADT type and a data constructor the same node type, so an
  `instantiates` edge keyed off node type cannot tell them apart. Of the 24,986
  uppercase applied sites that are NOT an in-file data constructor, **78.31% (19,566)
  name something no file in the corpus declares at all** and 21.69% (5,420) name
  something in-file — of which **zero** are data constructors, by construction, and
  82.5% are functions. `instantiates` therefore fires only for a `data_constructor`
  this file declares; 19,430 declines are published as
  `metadata.declinedInstantiations`.
- **`instance_declaration` has no `constructor` child**, and its argument list is
  `constraint* Type`, not `Class Type`. **683 of 2,539 instances** across 203 files
  take their target from the `argument` field, and the TYPE is the *last* argument
  that names one — a bare uniqueness constraint names none. Reading a child dropped
  those instances, their `implements` edges, and every member scope inside them.
- **Applications are left-nested.** Only the innermost `application` carries the
  callee, in its `function` field.
- **A function type's domain is a `type_application` whose children ARE the
  parameters**, so domain types pair positionally with `pattern` fields. No arrow
  scan over source text is needed.
- **`where`/`with`/`let` binders are real callables** — 13,665 binder occurrences
  publishing 12,026 scoped symbols — with a `<frame>.<local>` identity that rides
  `qualifiedName`. Adopted from the haskell lane.
- **Clean has no `export` keyword**: a `.dcl`'s definition list IS the interface.

## Known limitations — every one measured
- **30.1% of real Clean files do not parse** (655 of 2,179; 25,683 ERROR nodes), from
  the `<<@` compiler directive, the `import code from` FFI form, `*`-parameter
  synonyms, mixed-arity class contexts, several names before one `::`, a
  tuple-destructuring `where` binding, and four further sampled shapes. A **grammar**
  limitation, and the binding constraint on the whole lane.
- **`index_access` emits nothing** — 2,823 sites. Spec gap `CL-G1`, recorded not ruled.
- **19,430 uppercase applied names emit no edge**, the population above.
- **Cross-file resolution is impossible by architecture**: the analyzer receives
  `(rootNode, content, path)` with no project context, so a reference to a name
  declared in another file cannot be resolved. This is a cross-lane architecture
  question, not a Clean defect.
- **The M14.0.F5 differential is red on this lane** — the shared oracle derives
  `instantiates` from every `constructor`-headed application, so satisfying it means
  asserting a data construction for ≥97% of the sites above. Deliberate, written up,
  and the shared oracle was not modified.
- `?Just 0` in a body is an ERROR in the pinned grammar, so the unboxed BUILD
  direction is unreachable (ruling `CL-D8`).
- An imported OPERATOR cannot be written as the shared `<module>:<item>` edge form —
  every Clean operator contains a colon and the resolver splits on the last one — so
  those emit no edge and are counted as `metadata.operatorImports`.
- A tuple-destructuring `where` binding is unreadable, and the resulting ERROR
  subtree detaches the rest of the function from its frame: 7 locals fall back to
  module ownership, counted as `metadata.detachedLocals`.

## Verification
- **Corpus**: 2,179 files, 3,107,410 nodes, content-deduplicated
  (`script/m14/clean-wide-manifest.txt`) because iTasks vendors StdEnv.
- **Honesty gate**: 63,161 symbols, 237,266 relationships, **0 violations**, 0
  unknown kinds, 0 empty names, 0 members without an owner, 0 crash files.
- **M12 differential**: precision 1.000, recall 1.000, 0 FP, 0 FN against a
  134-row hand-audited ground truth extended from 68 rows this round.
  `script/m12/extend-clean-ground-truth.py` fails on line drift.
- **Fixtures**: 8, all passing. Three were added because 11 handled node types had no
  fixture behind them.
- **Differential attribution**: 0 unattributed of 484 (Clyde), 0 of 654
  (clean-stdlib), 0 on clean-libraries, **6** on clean-ide — the residual is stated
  in the classifier's own bucket rather than forced into one.
- **Grammar census**: 137/137 named types classified; 99 `handled_verified` and all
  99 now exercised by CORPUS code, not only by fixture.
- **Hygiene**: **zero regex literals** by the TypeScript scanner, and all 25
  analyzers pass `verify-analyzer-hygiene.ts`.
- **M60 R6** (one line base for every line in the payload, 1-based and provably so)
  passes for this lane.
- **Performance**: analyzer-only, warm, best of 5, load disclosed — 2.64 → 5.60
  ms/Knode for 2.75× the relationships; **linear within 8%** across a 23× size range.
  Not a speedup, and not claimed as one.
