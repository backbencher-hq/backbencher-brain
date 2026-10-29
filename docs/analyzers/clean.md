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
24,738.** Released as **tree-sitter-clean v1.2.8** (`7dfe6d12`), published to npm,
crates.io and PyPI on 2026-09-30; the pin below records the release commit and
the two facts that govern how its hash may be used — a wasm build is not
byte-deterministic, and npm ships no wasm, so the reproducible contract is the
surface digests, not the file hash. 128 grammar tests and the repo's 312-file cache-free regression gate
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
  `qualifiedName`. Adopted from the haskell lane. **A module-level symbol rides it too,
  as `<module>.<name>`** (2026-10-29): a Clean module is DECLARED in `.dcl` and
  IMPLEMENTED in `.icl`, so one module-scope type/function/class/macro is one declaration
  in two files, and the module-qualified spelling is what lets the incoming gate's
  `--binding-collapse` read the pair as ONE declaration. Members keep `<owner>.<member>`,
  which is the spelling `overrides`/`implements` endpoints use.
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
- **The M14.0.F5 differential runs GREEN on this lane, with `overrides` DECLARED
  no-truth** (`script/m14/spec/clean-completeness.json` → `label_coverage.declared_no_truth`,
  2026-10-29). The oracle derives `references`, `implements`, `calls` and `instantiates` and
  has no `overrides` rule; an overrides oracle would re-encode the analyzer's own
  instance-member/class-member pairing, i.e. a mirror, and a mirror cannot adjudicate. The
  label's independent coverage is the fixture suite (20 `overrides` rows across 14 fixtures).
  The oracle still derives `instantiates` from every `constructor`-headed application, which
  is why a share of `instantiates` rows read as oracle disagreement — those are the measured
  19,430 declines above, and the shared oracle was not modified.
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
- **Grammar census**: 137/137 named types classified; 99 `handled_verified` and all
  99 now exercised by CORPUS code, not only by fixture.
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

## Coverage — the declared block, and why `extends` is `grammar-absence`

`script/m14/spec/clean-completeness.json` now carries a `coverage` block, so the board's contract
column derives from a declaration instead of the firing log:
`clean 9/9 from=spec coverage block`, arithmetic `applicable = 10 − 1 grammar-absence − 0
unclassified = 9`, and the block closes (9 implemented + 0 unexercised + 0 gaps). The gate
`script/m14/coverage-block-gate.ts` reads it directly and reports no problem.

**The one exclusion, and the class it earns.** `extends` is the lane's only silent type — 0 edges
on the corpus — and silence has two causes that a corpus count cannot separate. `extends` is
`grammar-absence`, not `zero-sites`, and the deciding measurement is the grammar inventory rather
than the corpus:

- **Instrument A — the pinned wasm's own tables.** 290 declared node types, 29 declared field
  names; **0 of 22** probed supertype node types and **0 of 17** probed supertype words appear in
  either, and **0 of 29** field names is a supertype slot. The control is a keyword probe: **22 of
  23** probed Clean keywords *are* present as declared types, so the negative is the grammar's and
  not a blind probe.
- **Instrument B — the arbiter's position census** (`countCleanExtendsConstruct`, the same function
  the ruling table exports): 2,181 files / 3,107,897 nodes, **5,567 declarations** walked (423
  `class_declaration`, 2,539 `instance_declaration`, 610 `derive_declaration`, 1,995
  `class_context`) with **0 direct named children UNCLASSIFIED**. UNCLASSIFIED is the only bucket a
  supertype clause could occupy. The 312-file tracked population agrees (1,430 declarations, 0).

**The counter-argument, measured and not waved away.** The grammar *does* build a class-level
`class_context` for `class Ord a | Eq a` — 0 ERROR, 0 MISSING, and the node is a direct child of
the `class_declaration` (control C1 of
[`extends-census.ts`](../../validation/m14/fixtures/clean/extends-census.ts); C2/C3 prove the same
tally does *not* fire for the signature and instance positions the corpus does contain). That slot
is Clean's **dictionary requirement**, published as `references` by ruling CL-G3 and pinned by
`extends-probe-roles.icl`, which forbids an `extends` edge on it: the grammar uses the same node and
the same fields for an instance's `with` composition and therefore records no supertype
distinction. Clean's `<=` superclass spelling is *silently lost* — `class_declaration` terminated at
`class Ord a`, then an `operator_definition` re-reading `<` `=` with 0 ERROR nodes to count.

**The corpus is thin, and says so.** Clyde has **109 files**, below the programme's 120 target, so
**the sample IS the population** — no stride was taken. `NFILES=120 bun
script/m14/firing-check.mjs CLEAN_B` reads `9 types fired, 109/109 parsed`; the census independently
walked the same 109 files at 0 failures and reproduced the same nine edge tallies
(`calls:2143 contains:3621 exports:2589 implements:69 imports:668 instantiates:122 overrides:14
references:5487 uses:1330`). The corpus zero therefore *corroborates*; the class rests on
instruments A+B, which measure the grammar.

**Two instrument defects found on the way, both recorded rather than smoothed over.**

1. The `<=` detector in `extends-census.ts` **could not fire on the shape it was written for**. It
   compared the `operator` child's text to `"<="`, but the grammar tokenises `<=` in that position
   as `operator("<")` immediately followed by an anonymous `=`. The committed artifact's
   `0 in 0 file(s)` was therefore a property of the detector, not a measurement of the corpus. The
   control `C4` (must fire) plus `C5`/`C6` (must not fire off the shape) caught it; the detector is
   fixed, the controls pass 6/6, and the re-run still reads **0 in 0 files** — the number survived,
   its provenance did not exist until now.
2. `script/m14/language-board.ts --coverage` renders rows and then exits *before* the `NOTES` map
   is printed, so a coverage block that does **not** close looks like an ordinary row in exactly
   the mode lanes are told to check it with. The closure note is visible only in `--json`/table
   mode. Demonstrated with a deliberately double-counted block; reported to the Lead. The board
   file is not this lane's to edit.

Evidence: [`extends-census-controls.txt`](../../validation/m14/fixtures/clean/extends-census-controls.txt),
[`extends-census-clyde.txt`](../../validation/m14/fixtures/clean/extends-census-clyde.txt),
[`extends-census-shapes.txt`](../../validation/m14/fixtures/clean/extends-census-shapes.txt),
[`firing-clean-b-109.txt`](../../validation/m14/fixtures/clean/firing-clean-b-109.txt),
[`fixtures-clean-summary.txt`](../../validation/m14/fixtures/clean/fixtures-clean-summary.txt),
[`board-row-clean.txt`](../../validation/m14/fixtures/clean/board-row-clean.txt),
[`extends-construct-probe.json`](../../validation/m14/fixtures/clean/extends-construct-probe.json).
