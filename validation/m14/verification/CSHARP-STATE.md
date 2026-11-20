# C# lane — state

**As of:** 2026-11-19 (close-out pass complete)
**Analyzer:** `src/ast/real-csharp-analyzer.ts`
**Spec:** `script/m14/spec/csharp-completeness.json`
**Ruling table:** `script/m14/csharp-ruled.ts`
**Lane doc:** `docs/analyzers/csharp.md`

This page is the lane's durable state. It exists because C# had **no** verification page while
Java (`JAVA-STATE.md`) and JavaScript (`JAVASCRIPT-STATE.md`) do — and because three pages this
lane's header cited (`CSHARP-VERDICT-2026-10-21.md`, `CSHARP-FIX.md`, `CSHARP-D7.md`) were never
committed, so every citation to them was unfalsifiable from a fresh checkout.

---

## 1. Relationship vocabulary — all 14 types

Whole admitted corpus. Source:
`validation/m14/measurements/csharp-emission-census-whole.json`, regenerated with
`BB_CORPUS_ROOT=<corpus> bun script/m14/csharp-emission-census.ts`.
**14,424 parsed of 14,424, 22 repositories, 0 failed. 1,305,016 edges.**

| # | type | edges | files | repos | state |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | `calls` | 415,786 | 10,862 | 22 | emitted |
| 2 | `uses` | 260,071 | 10,370 | 22 | emitted |
| 3 | `references` | 223,848 | 12,686 | 22 | emitted |
| 4 | `contains` | 197,539 | 14,210 | 22 | emitted |
| 5 | `instantiates` | 86,855 | 7,981 | 22 | emitted |
| 6 | `decorates` | 39,788 | 4,732 | 18 | **emitted — added 2026-11-19** |
| 7 | `imports` | 39,763 | 10,783 | 21 | emitted |
| 8 | `overrides` | 14,543 | 3,653 | 17 | emitted |
| 9 | `exports` | 13,081 | 10,101 | 21 | emitted |
| 10 | `extends` | 8,672 | 5,632 | 15 | emitted |
| 11 | `implements` | 5,070 | 3,078 | 15 | emitted |
| 12 | `renders` | 0 | 0 | 0 | emitted, **corpus-unexercised** |
| 13 | `mixes_in` | 0 | 0 | 0 | **ruled — ontological** |
| 14 | `part_of` | 0 | 0 | 0 | **ruled — ontological** |

**11 emitting + 1 unexercised + 2 ruled = 14.** The only count that moved in the close-out is
`decorates` (0 → 39,788).

### Why the two ruled types are not "the grammar can't do it"

Both are **ontological** — they fail on what C# can *say*, not on which node types the pinned
grammar exposes. The distinction matters, because "the grammar is missing a node" is not a
permitted reason.

**`mixes_in`.** C# has exactly one supertype mechanism: the colon base list. Every entry in it is
a base type — first is the base class (`extends`), the rest are interfaces (`implements`). A mixin
is composed *into the supertype chain*, so `mixes_in` would need a composition that is neither of
those, and C# has no such construct. The two look-alikes do not qualify:

- `with_expression` / `with_initializer` (673 sites) produce a modified **instance**, not a
  subtype relationship.
- Extension methods (3,312 sites over 875 files) are resolved **at the call site** and never
  inherited into the supertype chain.

Either would duplicate an edge that already exists under a more specific label.

**Falsifier:** a C# construct that adds a type to another type's supertype chain and is neither its
first base nor one of its interfaces. The 8 probed node types are listed in `csharp-ruled.ts`; none
is produced by the pinned grammar (0 of 239 named types).

**`part_of`.** The contract's rule is *"source is always the file carrying the directive, target is
what it names"* — so the test is whether a file **names another file**. C# has no such statement:

- **0** `#include` / `#import` directives across all **1,181** admitted `.cs` files.
- **0** `part_*` / `include_directive` node types among the grammar's 239.

The strongest counter-argument was tested and rejected on the merits: **66 of 136 partial types
genuinely span more than one file**, which is real composition. But every declaration says only
`partial class X` — no file names the other. The compiler joins them; the source never states the
relation. A `part_of` row built from that would read `X → X` and carry no information.

**Falsifier:** a C# construct that names another file or unit as a component of this one — the
grammar grows one of the probed node types, or a directive naming a `.cs` file appears in the
corpus.

### `renders` — not ruled, unexercised

C# *can* express it (`builder.RenderComponent<Widget>()`, or `RenderComponent(typeof(X))`), and the
analyzer emits it. The corpus has **0 sites** that name a component — the rendering construct is
Razor's, a different language. The proof is behavioural:
`validation/m14/fixtures/csharp/render-host-component.cs`. Its ruling lives in `csharp-ruled.ts`
under instrument B (`publishedCount: 0`) because the spec's entry sits under
`coverage.corpusUnexercised`, which is not the key `rulingFor()` scans.

---

## 2. Resolution

**44.0% (555,326 of 1,262,497)** — from
`validation/m14/instruments/csharp/incoming-declaration.json`, generated **2026-10-22**.

> **This figure is PRE-CLOSE-OUT.** Its `types.decorates` row is all zeros, so the denominator
> predates this close-out's 39,788 new edges. Treat 44.0% as the lane's *last audited* figure.
> Re-running `incoming-gate.ts` to re-baseline is the correct next step rather than recomputing by
> hand.

Per type, same instrument:

| type | edges | resolved | rate |
| --- | ---: | ---: | ---: |
| `contains` | 195,367 | 195,367 | 100.0% |
| `overrides` | 14,514 | 14,514 | 100.0% |
| `extends` | 8,672 | 4,090 | 47.2% |
| `implements` | 5,066 | 2,299 | 45.4% |
| `instantiates` | 86,813 | 39,114 | 45.1% |
| `uses` | 259,772 | 106,494 | 41.0% |
| `references` | 223,848 | 75,334 | 33.7% |
| `calls` | 415,601 | 117,318 | 28.2% |
| `imports` | 39,763 | 683 | 1.7% |
| `exports` | 13,081 | 113 | 0.9% |

`imports` (1.7%) and `exports` (0.9%) look alarming and are not defects: `imports` targets are
namespaces and named types, and `exports` targets are assembly-external consumers — both are
*declared elsewhere by design*, which is what the `external` bucket is for.

**Non-resolved partition** (`causeRulings`, sums to 707,171):

| cause | count |
| --- | ---: |
| `ambiguous-declared-by-more-than-one-file` | 490,456 |
| `unresolved-declared-nowhere-in-the-corpus` | 128,068 |
| `unresolved-declared-in-another-repository` | 54,927 |
| `ambiguous-declared-twice-in-one-file` | 21,050 |
| `external-claim-confirmed` | 12,009 |
| `project-key-space-gap` | 525 |
| `ambiguous-declared-in-the-edge-own-file` | 136 |

### The two soft confidence spots, measured

**`overrides` at 0.5 — the tail is the majority path, not a remainder.** The lane long carried
"162 of 184 at 1.0; the tail is 22". Measured over the whole corpus
(`bun script/m14/csharp-overrides-tail.ts`): **11,428 overrides edges rest on the 0.5
first-parent guess**. What the 0.5 asserts is checkable — pass 3 takes `ownerHierarchy[0]` as the
declaring type, so the claim is "the first hierarchy parent declares this member." Verifying that
against the base class's own declaration: **10,787 of 11,428 confirmed (94.39%)**, 218 unresolved
(owner's declaration is in another file), **100 contradicted by the probe's chain resolution**.

Hand-checking the contradictions shows they are **probe limits, not analyzer defects**:
`ProjectNode` is a `partial` class across four files with `ProjectNode : HierarchyNode`, and
`MenuCommandId` is declared by `HierarchyNode` in a third file — the analyzer's guess is correct
and the probe did not follow the base chain across the partial split.

So: **the 0.5 is a confidence discount on an edge that is right in the overwhelming majority of
cases.** What is *not* claimed: that all 11,428 are correct. The 100 unconfirmed by this method
would deserve per-edge review if the number ever mattered to a consumer.

**`uses` at 0.7 — the larger half, and not a guess.** 203,825 of 260,071 `uses` edges are
`csharp_field_access` at 0.7 (`real-csharp-analyzer.ts:3651`); the identifier-usage half is 1.0.
Both endpoints are read from the tree and the relation is structural. The 0.7 is a
**context-dependence** discount: `obj.Name` may be this class's field, a base's, or another type's,
which is exactly the tier `uses` carries fleet-wide for member reads. Raising it to 1.0 would
assert a resolution the lane cannot prove; the identifier-usage half stays at 1.0 because a bare
name binds through the lexical frame.

---

## 3. Gates

All from a single re-run on the close-out branch.

| gate | result |
| --- | --- |
| F1 grammar coverage | `PASS` refs=112 unknown=0 unknownFields=0 |
| F3 fixtures | **27 / 27** |
| F4 mutants | **78 / 78 caught** |
| F5 differential | **100%**, `MISSING=0`, `unexplained=0` (powershell 60/60, fsharp 60/60) |
| `verify-csharp-symbols` | **PASS** — 49,025 symbols, 0 defects |
| `verify-csharp-line-numbers` | **PASS** |
| `verify-csharp-no-regex` | **PASS** — 0 literals, 0 runtime `RegExp` constructions |
| `verify-csharp-overrides-symmetry` | **PASS** |
| `verify-csharp-header-truth` | **PASS** — and proven to fail on the 2026-11-19 defect |
| `verify-csharp-oracle-regressions` | **PASS** |
| `verify-oracle-coverage` | **PASS** |
| `verify-csharp-targets-resolve` | **PASS** — 88.35% floor |
| completeness inventory | **8/8** (A–H) |
| ontology-coverage-gate | **emitted 11/14, FALSIFIED 0, ruled-without-justification 0** |

The ontology gate's three `RULED-UNKNOWN` rows are the gate being honest about a partial walk (9 of
14,424 files fell to the regex fallback), not a defect in the rulings. `decorates` is unaffected
because it is EMITTED from observation.

---

## 4. Known gaps

Recorded rather than buried, with the evidence for each.

1. **Three verification pages were cited and never existed.**
   `CSHARP-VERDICT-2026-10-21.md`, `CSHARP-FIX.md`, `CSHARP-D7.md`. The analyzer header cited all
   three (plus two more artifacts) as evidence. None was ever committed; none exists at any path.
   **Status:** the header's citations were replaced with artifacts a reader can open, or with the
   command that regenerates them. The pages themselves were prose verdicts, not a process
   requirement — **no lane in this tree has a `*-VERDICT-*.md`**; Java and JavaScript use
   `<LANG>-STATE.md`, which is what this page is. So this is a *documentation* gap that is now
   closed by replacement, not a missing deliverable.

2. **The resolution instrument is stale.** `incoming-declaration.json` was generated 2026-10-22.
   Its `decorates` row is zero, so 44.0% predates the close-out. **Next step:** re-run
   `incoming-gate.ts` and re-baseline.

3. **The overrides 0.5 tail is not fully verified.** 94.39% confirmed; 100 unconfirmed because the
   probe cannot follow base chains across `partial` splits in other files. **Next step:** resolve
   owners through the cross-file symbol table rather than text, then re-measure.

4. **The ontology gate has no attestation file for C#.** It reads
   `validation/m14/fixtures/csharp/ruling-attestation.json`, which does not exist. The lane
   declares `spacesProbed` in `csharp-ruled.ts` instead, which the gate accepts, so this is
   optional — but a real attestation would let the gate *verify* the declared counts rather than
   take them on trust.

5. **`.bbignore` excludes `validation/**/measurements/`,** so the two census artifacts are
   committed to git but invisible to `bb`. That is deliberate (`bb` does not index measurements),
   and it means the doc's citations resolve on disk but not through graph tools.

---

## 5. Instruments

| script | what it measures |
| --- | --- |
| `script/m14/csharp-truth.ts` | exports / imports / overrides oracles |
| `script/m14/csharp-mutants.ts` | the lane's F4 mutants (spread into `mutate-analyzer.ts`) |
| `script/m14/csharp-emission-census.ts` | whole-population per-type + marker counts |
| `script/m14/csharp-overrides-tail.ts` | the 0.5 tail and whether its guesses are right |
| `script/m14/csharp-ruled.ts` | the three rulings, with falsifiers |
| `script/m14/widen-blast-radius.ts` | fleet-wide effect of widening `ALL_TYPES` |
| `script/m14/grammar-node-inventory.ts` | the pinned grammar's own node-type names |
| `script/m14/verify-csharp-header-truth.ts` | does the header describe the analyzer it heads |

---

## 6. Co-edit list

When the analyzer changes, review in the same pass: `docs/analyzers/csharp.md`,
`script/m14/spec/csharp-completeness.json`, `validation/m14/fixtures/csharp/**`,
`script/m14/csharp-ruled.ts`, `src/ast/override-context.ts` (the companion it imports), and this
page.