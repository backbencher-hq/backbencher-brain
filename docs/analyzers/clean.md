# Clean Analyzer

> **Every figure on this page is recomputed by `bun run script/m14/clean-census.ts
> --manifest script/m14/clean-wide-manifest.txt`** over the 2,179-file corpus
> (3,107,410 nodes). The full contract is
> [`real-clean-analyzer.md`](./real-clean-analyzer.md); the review with evidence is
> [`reviews/clean/m14-0-clean-completeness.md`](../../reviews/clean/m14-0-clean-completeness.md).
>
> **Read parse health first.** 1,656 of 2,179 files (76.0%) parse with no ERROR
> node; 523 files carry 24,738 ERROR nodes. Every percentage below is a percentage
> **of what parsed**, and that ceiling is the pinned grammar's, not the analyzer's.
> The grammar moved from 1,524 files (69.9%) on 2026-09-29 — see
> [The 2026-09-29 grammar wave](#the-2026-09-29-grammar-wave).

## The 2026-09-29 grammar wave

The lane's binding constraint is the grammar, so the work went into
`tree-sitter-clean` (master) with the corpus as the measuring instrument. A new
instrument, `scripts/parse_health.mjs` in that repo, reports how much of the
language the grammar reads **at all** — which the existing per-file regression gate
cannot answer, because a grammar can add no regressions and still fail to read a
quarter of real Clean.

Two properties of that instrument were found by being wrong first, and both are
worth more than the fixes they enabled:

- **A failing file is attributed to its TIGHTEST problem node, not its first.** One
  unreadable construct makes tree-sitter wrap a whole file in a single `ERROR`, and
  122 of the failing files are like that. Attributing by first node reported "module
  header" for **442 files whose `implementation module X;` headers parse
  perfectly** — the `ERROR` merely starts at line 1. The first round of work was
  aimed at a construct that is not broken.
- **A zero-width `ERROR` at a declaration boundary is the rift the PREVIOUS
  declaration left.** `GtkBoxP2GtkWidgetP gtk :== let { (GtkBoxP p) = gtk }` parses
  perfectly alone; the `let` group is what broke the file.

| Closed | Form | Files |
|---|---|---|
| Foreign code import | `import code from "a.o"`, `import code from library "L"` | 30 |
| Unique type variable in a synonym parameter list | `:: * Input *a = { ... }` | 25 |
| `let` brace group | `let { (GtkBoxP p) = gtk; }` | 53 |

The second was a **comment that lied**: `type_definition` has carried "Parameters
may carry uniqueness (`:: * Input *a = ...`)" while `type_variable` was a bare
`$.identifier`. Clyde's `PmParse.icl:17` has exactly that declaration, and that one
line wrapped the whole file in an `ERROR` spanning 1,328 lines.

**Result: 1,524 → 1,656 parse-clean files (69.9% → 76.0%), ERROR nodes 25,683 →
24,738.** 128 grammar tests and the repo's 312-file cache-free regression gate
back each step.

### The ceiling is real, and it is measured

`tree-sitter-clean` sits close to tree-sitter's 65,535 action-table limit, so a
change that is obviously correct can still fail to generate:

| Attempt | Actions | Result |
|---|---|---|
| `let_group` members separated by two independent optionals | 66,756 | **generate FAILED** |
| … as one separator choice | generates | +29 files |
| `let_group` members also separated by a comma | generates | but regressed 2 files |
| `where { cstate =: ...; }` (brace binding block) | 67,459 | **generate FAILED** |
| … with a required `;` separator | 65,583 | fails by 48 **and does not parse the form** |

The `where {` block is recorded as an open gap in the grammar's own
`GRAMMAR-GAPS.md §10` with these numbers, rather than attempted and forgotten. The
comma is excluded from `let_group` on evidence: no corpus `let_group` uses one, and
adding it changed LR states far from any `let_group` and regressed
`eastwood/.../Symbol.icl` (1 → 12 problem nodes, newly wrapped) and
`PmCleanSystem.icl` (3 → 6).

### What the wave cost, stated plainly

The `;` separator is **29 corpus files better and 2 files worse** overall, and the
two worse files were already failing. That trade is taken deliberately and recorded
in the grammar commit rather than discovered later.

The wave also made `Hanoi.icl` parse further, which exposed the one honesty-gate
violation listed above. Fixing the fabricated `where` symbol it first produced took
a **reserved-name guard** in the analyzer: tree-sitter's recovery re-lexes a keyword
as an identifier when its construct has already failed, and the lane published
`function` symbols named `where`. The guard is the grammar's own 32 alphabetic
reserved literals minus four that are context-reserved rather than reserved
(`E`, `apply`, `inline`, `library`), and it removed **169** such symbols
corpus-wide. The differential was checked for it: `F-unattributed` stayed at 0 on
Clyde, so no real declaration was declined.

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
- **Honesty gate**: 63,052 symbols, 237,598 relationships, **1 violation** (the
  single `Hanoi.icl` finding characterised under Known limitations), 0 unknown
  kinds, 0 empty names, 0 members without an owner, 0 crash files. The count FELL
  because the grammar wave removed 24,991 → 24,738 ERROR nodes and the reserved-name
  guard below dropped 169 fabricated function symbols corpus-wide.
- **M12 differential**: precision 1.000, recall 1.000, 0 FP, 0 FN against a
  134-row hand-audited ground truth extended from 68 rows this round.
  `script/m12/extend-clean-ground-truth.py` fails on line drift.
- **Fixtures**: 9, all passing. Three were added because 11 handled node types had no
  fixture behind them; `grammar-wave-2026-09` was added because the completeness
  gate REFUSED to accept `handled_verified` for the three node types the wave
  introduced without a fixture behind each one, which is the gate working.
- **Differential attribution**: 0 unattributed of 484 (Clyde), 0 of 654
  (clean-stdlib), 0 on clean-libraries, **6** on clean-ide — the residual is stated
  in the classifier's own bucket rather than forced into one.
- **Grammar census**: 141/141 named types classified (137 before the wave, plus
  `foreign_code_import`, `foreign_code_item`, `let_group`, `record_binding`); 102
  `handled_verified`, all exercised by CORPUS code and not only by fixture.
- **Hygiene**: **zero regex literals** by the TypeScript scanner, and all 25
  analyzers pass `verify-analyzer-hygiene.ts`.
- **M60 R6** (one line base for every line in the payload, 1-based and provably so)
  passes for this lane.
- **Performance**: analyzer-only, warm, best of 5, load disclosed — 2.64 → 5.60
  ms/Knode for 2.75× the relationships; **linear within 8%** across a 23× size range.
  Not a speedup, and not claimed as one.
