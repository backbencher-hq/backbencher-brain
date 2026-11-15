# PROPOSAL (fsharp) — register the lane: ready-to-paste `LANG_CONFIG` + `GATED_LANGS` entry

**From:** fsharp lane owner · **date:** 2026-10-17 · **branch:** `analyzers/ontology-laptop-b`
**Touches:** `script/m14/completeness-inventory.ts` (Lead-owned — this lane may not edit it):
one `LANG_CONFIGS` entry and one name appended to `GATED_LANGS`.
**Evidence:** every line below is measured on this tree; the independent pre-check in §4 runs the gate's
own readers and reads all eight sections PASS.

## 0 · WHAT WAS DONE TO THE LANE (it is not just a config — three of the eight sections were red)

The lane had a spec, 13 expectation-paired fixtures, docs and a differential seat, but **no inventory
config**, so no gate had ever asked it the eight questions. Asking them found:

| section | state before | what fixed it |
|---|---|---|
| A structural | **RED (would be)**: `handled_verified.types` was a list of **OBJECTS** while the gate reads **strings** — every handled row invisible; and **115 of the 198** named node types were in NO bucket | spec reclassified from the measured census + the analyzer's own node-type constants: **61 handled / 127 silent / 19 decisions / 5 gaps, 0 unclassified, 0 stale** |
| B relationship-kinds | not askable (no config) | emitted = all ten ontology kinds over the 13 paired sources, every one pinned; contract row = the same ten |
| C payload-matrix | not askable | `payloads: {}` — and the emptiness is honest: no genuine Matrix 1b payload exists (see §2) |
| D evidence-tiers | **RED**: the analyzer stamped **NO `evidenceClass` at all** (0 of 394 edges) → 0 tiers pinned | added the fleet's tier pass (`classifyEvidenceTier`, mirroring `real-c-analyzer.ts`), 4 distinct tiers now emitted and **4 pinned by fixtures** |
| E differential | would PASS | floor row `fsharp:csharp` already exists (missing 0, unexplained 0) |
| F perf-budget | would PASS | same row, `avgMsPerFile 72.1` |
| G docs | PASS | `docs/analyzers/history/fsharp-lane-notes.md` + `fsharp.md` |
| H cross-language | PASS | `M14.CC1.json` 12 checks pass |

## 1 · THE CONFIG — COPY VERBATIM

```ts
  fsharp: {
    id: "fsharp",
    wasm: "tree-sitter-fsharp.wasm",
    classification: "fsharp-completeness.json",
    fixturesDir: "validation/m14/fixtures/fsharp",
    docs: ["docs/analyzers/fsharp.md", "docs/analyzers/history/fsharp-lane-notes.md"],
    // The F5 snapshot carries `differential-fsharp` (60 files, coverage 100%, unexplained 5%). No
    // code reads this field (measured repo-wide), so it is declared for the record, not for a check.
    differentialCheck: "differential-fsharp",
    // WHY `fsharp:csharp` AND NOT `fsharp:fsharp`: the pinned floor row is the lane's F5 seat, and
    // that seat is the F# lane diffed against the C#-family tree-truth oracle — the exact key
    // differential-baseline.json carries (`missing 0, unexplained 0, perf.avgMsPerFile 72.1`).
    // Inventing `fsharp:fsharp` would name a row no artifact answers.
    perfKey: "fsharp:csharp",
    // ALL TEN. The analyzer emits every ontology kind over its own fixture sources and the fixtures
    // pin every one (section B checks both directions now): contains, calls, exports, references,
    // imports, uses, overrides, implements, extends, instantiates. The analyzer's header said
    // "NO uses" until this inventory — it was true when the lane mirrored the C# family and stopped
    // being true when the exports/uses wave landed without updating the header (fixed in this branch).
    requiredKinds: ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"],
    // NO Matrix 1b payload row is declared, and that is a measurement rather than an omission: the
    // analyzer publishes exactly one payload-shaped value, `metadata.complexity = symbols.length`,
    // which is the SURROGATE the CLJ1 wave explicitly retired for clojure ("fabricated
    // cyclomaticComplexity = symbols.length"). Pinning it would enshrine a number that is not a
    // decision count. These fixtures pin symbols/edges/metadata rows; none pins a payload row.
    // A lane with no required payload declares none — the same shape as the empty-payload entries
    // already in this file (:314, :325, :950, :998, :1021).
    payloads: {},
    title: "fsharp functional wave (M60) — inventory closed 2026-10-17",
  },
```

and in `GATED_LANGS`:

```ts
const GATED_LANGS = [..., "clojure", "erlang", "fsharp"]
```

## 2 · SECTION A IN ONE PARAGRAPH (the number the Lead asked for)

**198 named node types** in the pinned wasm (+ ERROR/MISSING) — **61 `handled_verified` · 127
`internal_silent` · 19 `design_decision` rulings · 5 `gap` entries. 0 unclassified, 0 stale.**
The 115 node types that were in no bucket were classified from evidence, not prose: the 120-file
shape census (`validation/m14/results/fsharp-shape-census.json` — 298 node-type counts, 363,609 nodes)
for what the corpus actually produces, and the analyzer's own node-type constants for what it consumes
(`TYPE_WRAPPER_NODES` at `real-fsharp-analyzer.ts:111`, `TYPE_CLAUSE_TYPES` at :100, the declared-type
reference walk). The two findings that changed the split:

1. **The written-type wrapper family EMITS.** Thirteen types moved into `handled_verified`:
   `atomic_type, paren_type, function_type, compound_type, struct_type, list_type, byref_type,
   static_type, flexible_type, types, nullable_type, postfix_type` (they are `TYPE_WRAPPER_NODES`: the
   outermost wrapper emits the `declared_type` `references` edge) + `type_declaration` (forward
   declarations / type-clause groups). The old list named only `simple_type`/`generic_type` of the 14.
   Measured: a `:? Foo` type test emits `references -> Foo` with `nodeType: atomic_type`.
2. **Builtin-type spellings are LITERALS, not type nodes.** `int`/`string`/`bool`/… are literal node
   types (`const` children in the tree); a type POSITION is `simple_type -> long_identifier ->
   identifier`. The analyzer's `BUILTIN_TYPE` table at :3545 classifies the TEXT of a written type; it
   does not emit from these nodes. They are `internal_silent` with that reason recorded.

Five decisions were added (each with its measured count in the 120-file draw): record
construction/pattern labels (`named_field` 376, `named_field_pattern` 249, `field_pattern` 11,
`record_pattern` 6 — a label is a system member, never a project reference), primary-constructor
arguments (107 — parameters are not published by the symbol contract), `preproc_inactive` (24 — code the
compiler does not see must emit nothing), interpolation holes (`format_string_eval` 90), and extern
bindings (0 — P/Invoke surface outside the symbol contract, reopens if a corpus case appears).

**Two stale-name corrections are part of the record, not swept under it:** `source_file` → the root
node type is **`file`**; and the rows `block` / `match` / `prefixed_expression (except the `new`
prefix, FSD8)` named node types this wasm never produces (`block_comment`, `match_expression`, and a
prose sentence inside a type list). `prefixed_expression` is `handled_verified`; its `new`-only rule is
FSD8 and stays there.

## 3 · SECTION D — THE TIER PASS (the one analyzer change)

The analyzer stamped **no `evidenceClass` on any of 394 edges**, so section D ("≥2 distinct tiers
pinned") could only fail. Added `classifyEvidenceTier()` (called at the end of `analyze()`), the same
post-pass shape as `real-c-analyzer.ts::classifyEvidenceTier` and `real-bash-analyzer.ts`'s
`evidenceClassFor`:
`contains/exports/extends/implements/instantiates → structural` · `imports → import_based` ·
`references`: `declared_type → reference_qualified`, open directives → `import_based` ·
`overrides → reference_qualified` · fallback `usage_contextual`.

Measured over the 13 paired sources: **structural 284 · usage_contextual 53 · reference_qualified 39 ·
import_based 18**. Four rows now pin one tier each (`open-scope` import_based, `override-target`
reference_qualified, `one-char-calls` usage_contextual, `type-extension-and-containment` structural).
Fixture suite before AND after every change: `{"fsharp":{"pass":15,"fail":0}}`, `fixture baseline gate:
no regressions`.

## 4 · INDEPENDENT PRE-CHECK (the gate cannot run until the config is applied)

```
A structural           PASS  198 types, 61 handled, 127 silent, 5 gaps, 19 decisions; unclassified=0 stale=0
B relationship-kinds   PASS  emitted [calls, contains, exports, extends, implements, imports, instantiates, overrides, references, uses]; required 10; unpinned=[]; emitted-not-required=[]
C payload-matrix       PASS  0 payload rows declared (see §1)
D evidence-tiers       PASS  4 tier(s) pinned: import_based, reference_qualified, structural, usage_contextual
E differential         PASS  floor fsharp:csharp missing=0 unexplained=0
F perf-budget          PASS  fsharp:csharp 72.1 ms/file
G docs                 PASS  fsharp.md, fsharp.md
H cross-language       PASS  12 checks pass
```

## 5 · THE TWO ITEMS THE LANE'S OWN RECORD NAMES — both still OPEN, neither fabricated

1. **`targetResolution` vs the arbiter's cause key.** Measured: **394 of 394 edges (100%)** carry
   `metadata.targetResolution` with 19 classes (`published-identity` 268, `in-file-declaration` 33,
   `bare-external` 28, `external-type` 21, …). The gate's cause channel reads a DIFFERENT key —
   `CAUSE_CLAIM_KEY = "baseBeyondRunScope"` (`script/m14/incoming-rule.ts:296`) — so the lane's cause
   column is provably silent for a mechanical reason, not an analytic one. **Making `targetResolution`
   the cause key would be a contract change with its own measurement** (a cause claim is refuted when
   the project key space answers the name; many of these classes say the opposite — e.g.
   `published-identity` means the file itself declares it). Not done: the ruling is the Lead's, and the
   lane must not fabricate 394 run-falsifiers.
2. **Clause 3 vacuity.** 513 causes carry counts and none carries a ruling — the previous owner
   refused to invent run-falsifiers from a 400-file cap, correctly. Nothing in this lane's sections
   A/B turned up cause-like rows, so the ruling question is **open, not settled**; the spec now records
   the cause-like classes honestly (gap FS-A1's dead branches, FS-A4's prefixed_expression, and the
   `targetResolution` table above) rather than asserting a ruling.

## 6 · WHAT I DID NOT DO

No `--update-baseline` (E/F already green and the fleet sweep is the Lead's). No edit to
`completeness-inventory.ts`, `GATED_LANGS`, another lane, or the firing log. No fabricated cause
rulings. The analyzer change is additive metadata (one post-pass) and the fixture suite is unchanged in
outcome (15/0 before and after).
