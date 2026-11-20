# C# close-out — the complete prioritized work list

**Status: READ-ONLY analysis complete. No source edited. Awaiting approval.**
Branch `main`, HEAD `be4c0ef25`. Prepared 2026-11-19.

This is the whole remaining C# close-out, ordered by what must be true before the lane
can be called finished. Every item states its measurement, its evidence, and the exact
acceptance test. Items are ordered **P0 → P3**; P0 items are the ones that make a claim
in the tree *false today*.

---

## The one-sentence verdict

The C# lane's **mechanisms are sound** (all behavioural gates green, 26/26 fixtures,
2,136/2,136 mutants, 8/8 completeness, 4/4 M60, regex PASS, symbols PASS at the
attributed-property level) — but **three of its "ruled" relationships are ruled on
reasons the tree itself contradicts**, its ruling table is **absent from the arbiter**
so the lane reads as unadjudicated, and **five artifacts its rulings cite were never
committed**, so the rulings are unfalsifiable from this checkout.

---

## P0 — claims that are false today

### P0-1. `decorates` ruling is FALSE — C# has the construct and the analyzer already computes it

**The ruling says** (`script/m14/spec/csharp-completeness.json`, `excluded[decorates]`):
ontological exclusion — C# attributes are "passive metadata", not an applied callable;
"grammar-absence" reasoning is used to support it.

**What the tree says** — measured with the fleet's own generator
(`bun script/m14/grammar-node-inventory.ts csharp`), now written to
`validation/m14/measurements/csharp-grammar-nodes.json`, **239 named / 533 ids**:

| node type the ruling's own argument needs | in C#'s grammar |
|---|---|
| `attribute` | **PRESENT** |
| `attribute_list` | **PRESENT** |
| `attribute_argument` | **PRESENT** |

A ruling whose instrument is "the grammar does not have this node type" cannot stand when
the node types are present. The exclusion's own text cites grammar absence; that citation
is now demonstrably false.

**The precedent that settles it.** `script/m14/real-rust-analyzer.ts:2383-2400` emits
`decorates` for Rust's `#[derive(...)]`/`#[path(...)]` attributes — attributes are
*applied callables* — and splits them into `builtin_directive` vs
`applied_callable_candidate` so the candidate class is countable. C#'s attribute is the
same construct: an attribute **names a callable type and applies it to a declaration**.

**Measured population** (repo `powershell`, `src/`, 1,181 `.cs` files):

- **7,769 attribute sites** across **655 files**
- **6,024 of them carry arguments** (the applied-callable shape):
  `[Parameter]` ×646, `[ValidateNotNullOrEmpty]` ×347, `[MarshalAs(...)]` ×126,
  `[StructLayout(...)]` ×120, `[Flags]` ×96, `[FieldOffset(0)]` ×86, …
- grammar probe confirms attributes attach to declarations exactly as Rust's do:
  `[Serializable] class` → `class_declaration`, `[Obsolete] prop` → `property_declaration`,
  `[return: NotNull] M()` → `method_declaration`

**The mechanism already exists and is free.** `extractAttributes()` at
`src/ast/real-csharp-analyzer.ts:4587-4629` already walks `attribute_list` →
`attribute` and publishes the cleaned name (`csharpCleanTypeLeaf(csharpTypeNameText(...))`)
with `alias_qualified_name` and `generic_name` both handled. It is called on every
declaration; the names a `decorates` edge needs are already computed.

**Decision (recommendation): IMPLEMENT `decorates`.** Reasons:
1. The ruling's stated instrument is falsified by the tree — this is not a judgement call.
2. The Rust precedent is the same construct with the same shape and is already shipped.
3. Population is large and real (7,769 / 655 files), not a corner case.
4. Cost is one emission site reusing an existing helper — no grammar change, no new walker.
5. Leaving it ruled leaves a false claim in the tree, which is exactly the class of defect
   this close-out exists to remove.

**Acceptance test:**
- `decorates` moves from `coverage.excluded` to `coverage.implemented` in
  `script/m14/spec/csharp-completeness.json`, with the `attribute_argument`-vs-`attribute`
  split published as a metadata key (`attributeKind: "applied_callable" | "marker"`)
  so the candidate class is countable — Rust's shape.
- A fixture `validation/m14/fixtures/csharp/decorates-attribute.cs` pinning
  `Class -> Serializable`, `Class -> Obsolete`, and a **negative** for a bare marker
  (`[Flags]`) if the lane decides markers stay unemitted.
- `completeness-inventory.ts --lang csharp` reports **9 implemented / 2 excluded**.
- A mutant that deletes the attribute walk is **CAUGHT**.
- `docs/analyzers/csharp.md` ontology section restated.

---

### P0-2. `mixes_in` ruling is UNJUSTIFIED as written — its grammar claim is true but its conclusion is not

**The ruling says** (`excluded[mixes_in]`): "R1 UNAVAILABLE … 0 of 239 mixin node types";
R2 "NOT APPLICABLE: a mixin is composed into the supertype chain"; R3 extension methods are
resolved at the call site.

**What is actually true:**

| claim | verdict |
|---|---|
| no `part_*`/`*mixin*` node type in C# | **TRUE** (verified: `[]`) |
| C#'s only supertype composition is the base list | **TRUE** (probe: interface multi-inherit, class-implements-many both parse clean; nothing else composes) |
| `with_expression` exists and means record-update | **TRUE** — `with_expression`/`with_initializer` are present, 673 corpus sites (274 + 399) |
| "therefore `mixes_in` is not implementable" | **does not follow from the above** |

The ruling is *right in its conclusion* but *wrong in its stated reasoning*: it treats
"no mixin node type" as sufficient, and that is precisely the argument form the owner has
ruled out — "the grammar is not doing this so we are not doing it either."

**The correct ruling, which is still a ruling.** A mixin composes **into the supertype
chain**. C# has exactly one supertype mechanism (the base list) and it is already
published as `extends` (first base) + `implements` (remaining). `with_expression` is
record-update on an *instance*, not supertype composition. There is no third thing. So the
honest statement is:

> **ontological** — a C# supertype edge is already `extends` or `implements` by
> construction; `mixes_in` would require a supertype composition that is neither, and C#
> has no such construct. Falsifier: a C# construct that adds a type to another type's
> supertype chain and is neither its first base nor one of its interfaces.

**Decision (recommendation): RE-RULE as `ontological`, with the falsifier above, and drop
the "grammar absence" vocabulary from the entry.** The verdict does not change; the
*reason* becomes one that survives the owner's test. Do not implement `mixes_in`.

**Acceptance test:**
- `excluded[mixes_in].evidence` becomes `"ontological"`; the entry names the single
  supertype mechanism and the falsifier.
- `nodeTypesThatWouldMeanIt: []` is dropped (there is no node type that *would* mean it,
  which is the point) or replaced by the base-list node types.
- No `mixes_in` edge appears in any fixture.

---

### P0-3. `part_of` ruling is CORRECT, and is now measured rather than asserted

**The ruling says** (`excluded[part_of]`): "informational" — C# `partial` splits one type
across declarations, so a `part_of` row would be `X -> X` and carry no information;
1,873 partial sites; 300 types across >1 file.

**Independent verification (this session):**

- Grammar probe: `part_*` → `[]`, `*mixin*` → `[]`. **C# has no file-inclusion syntax.**
- Corpus sweep of all **1,181** `.cs` files in `powershell/src`: **0** `#include`/`#import`
  directives; only **4** files contain any `".cs"` string literal at all (all incidental
  path strings, not directives).
- The comparison that matters: C++ resolves `part_of` from `#include "..."` (quoted form),
  PowerShell from dot-sourcing, TypeScript from `/// <reference>`, Dart from `part '…'`.
  **C# has no equivalent directive**, so there is no source construct to read.

**This ruling is sound.** It is also the one the owner's rule bites hardest on, and it
survives: the exclusion is not "the grammar lacks a node" but "**no C# syntax names another
file as part of this compilation unit**" — measured at 0 sites over 1,181 files with the
inclusion-syntax sweep, plus 0 `#include`-family directives.

**Decision (recommendation): KEEP the ruling, restate it in the owner's vocabulary
(`ontological` — C# composition is per-declaration via `partial`, which merges into one
symbol; there is no inter-unit composition to name), and record the 0-site sweep as the
falsifier test.** Add the corpus sweep command to the entry so it is re-runnable.

**Acceptance test:**
- `excluded[part_of].evidence` restated; entry carries the sweep command and the 0 count.
- No `part_of` edge in any fixture.

---

### P0-4. `script/m14/csharp-ruled.ts` does not exist — the arbiter reads C# as unadjudicated

**Measured:** 24 lanes ship `script/m14/{lang}-ruled.ts`; **all 24 are registered** in
`RULED_BY_LANG` (`script/m14/ontology-coverage-gate.ts:544-568`). C# ships **none** and is
**not** in the map.

Consequence: `ontology-coverage-gate.ts csharp` cannot render a verdict for the three
excluded types. For `decorates` (P0-1) that is correct-by-accident; for `mixes_in` and
`part_of` it means a **live, correct ruling is invisible to the gate**, and the lane reads
as if nobody adjudicated it.

The contract is explicit (`powershell-ruled.ts` header): a ruling table adjudicates
**only** types the analyzer does not emit; an entry asserts a construct is
**inapplicable**; and a **missing** registration is what makes the gate report
RULED-UNJUSTIFIED rather than RULED-SOUND.

**Decision (recommendation): CREATE `script/m14/csharp-ruled.ts` with TWO entries**
(`mixes_in` ontological, `part_of` ontological/informational — whatever P0-2/P0-3 settle),
plus `RULED_BY_LANG.csharp` registration. Both are additive lines in a file whose own
header says a registry merge must resolve toward the union.

**Acceptance test:**
- `npx tsx script/m14/ontology-coverage-gate.ts csharp` renders a verdict instead of
  failing on a missing entry. (Note the known shared-harness import-order crash —
  see P3-4.)
- `grammar-node-inventory.ts csharp` has been run so the cited inventory exists.

---

## P1 — the analyzer defect the gates already convict

### P1-1. `verify-csharp-symbols` FAILS on 26 conversion-operator symbols — fix the name or the gate

**Measured this session.** Full-corpus run (1,181 files, absolute paths):

```
symbol-surface audit — csharp, 1181 files, 49025 symbols
  dangling owner: 0
  name not written at its own range: 26
PROBLEMS (1): ! 26 symbol(s) whose name is not written at its own range
VERDICT: FAIL
```

49,025 symbols are checked; **exactly 26** fail, and they are all conversion operators.

All 26 are **conversion operators**, and the count is exact — an independent corpus
sweep finds **26 conversion sites across 6 files**:

```
Credential.cs:281     public static explicit operator NetworkCredential(PSCredential credential)
MshObject.cs:935      public static implicit operator PSObject(int valueToConvert)
MshCmdlet.cs:91       public static implicit operator bool(SwitchParameter switchParameter)
PSDataCollection.cs:204  public static implicit operator PSDataCollection<T>(bool valueToConvert)
WSManNativeAPI.cs:207 public static implicit operator IntPtr(MarshalledObject obj)
PSVersionInfo.cs:530  public static implicit operator Version(SemanticVersion semver)
```

**Root cause** (`src/ast/real-csharp-analyzer.ts:1909-1916`): the symbol is named
`` `${modifierKeyword.type} ${cleanTarget}` `` → e.g. `implicit NetworkCredential`.
That concatenated string **is not written in the file** — the file writes
`implicit operator NetworkCredential`. The gate's "declared somewhere" property is
correct and the symbol name is the defect.

**Grammar evidence** (probe this session) for why the two operators differ:

```
operator_declaration              {operator="+", type="C"}      anon=[operator,+,;]
conversion_operator_declaration   {type="string"}               anon=[implicit,operator,;]
```

An `operator_declaration` **does** carry the operator token in a field (`operator="+"`),
and its name `operator +` is likewise not literally written — but only **2** such
non-conversion operator overloads exist in the corpus, so the failure is invisible there.
The class is the same; conversion operators are where it is measurable.

**Decision (recommendation): FIX THE SYMBOL NAME, not the gate.** Options weighed:

| option | effect | verdict |
|---|---|---|
| Name it `op_Implicit`/`op_Explicit` (CIL spelling) | name not written either → gate still fails | ✗ |
| Name it `implicit operator NetworkCredential` (verbatim source slice) | written in file → gate passes; but symbol names become long and the `contains`/`references` labels change | **✓ recommended** |
| Weaken the gate to exempt conversion operators | gate stops convicting a real class | ✗ — this is the "silence the alarm" move |

Recommended: publish the **verbatim source spelling** of the operator (the grammar already
gives both pieces: `implicit`/`explicit` anonymous child + `type` field), because that is
both what the file writes and what a reader means by the symbol. The change is confined to
`opName` construction at `:1909-1916`.

**Acceptance test:**
- `verify-csharp-symbols --list <1181 abs paths>` → **PASS**, `name not written: 0`.
- Any fixture/mutant that pins the old `implicit X` spelling is updated in the **same
  commit** (the operator-name-collapse mutant must still be CAUGHT).
- `docs/analyzers/csharp.md` symbol-contract section restated.

---

## P2 — the oracle bugs (the "truth" is wrong, not the analyzer)

### P2-1. `deriveCSharpContains` misses local functions inside property accessors

`script/m14/differential.ts:9643`. The owner-climb for a local function walks
`block`-ish ancestors but does not treat `accessor_declaration` / `accessor_list` as an
owner boundary, so a local function declared inside a property accessor is attributed to
the *type* (or dropped) rather than to the accessor's declaration.

**Decision (recommendation): FIX the oracle.** A local function inside an accessor belongs
to the accessor's symbol. Add `property_declaration`/`accessor_declaration` to the climb.
Acceptance: a fixture whose local function lives in a `get {}` block produces a `contains`
edge from the accessor; F5 unexplained does not rise.

### P2-2. `deriveCSharpUsingReferences` drops type arguments

`script/m14/differential.ts:10734` — the using-reference derivation pushes only `t.module`
and never `t.typeArguments`, so a `using` of a generic type loses its type-argument
references while the analyzer publishes them.

**Decision (recommendation): FIX the oracle.** Push `t.typeArguments` alongside `t.module`.
Acceptance: a fixture `using Foo<int>` yields the same reference set on both sides.

### P2-3. `overrides` at confidence 0.5 — 162/184, the "first-parent-guess" tail

`src/ast/real-csharp-analyzer.ts:3272-3276`: when passes 1–2 fail, the resolver guesses
`ownerHierarchy[0]` at confidence **0.5** with `reasonCode: "first-parent-guess"`. 22 of
184 overrides land there.

**Decision (recommendation): MEASURE FIRST, then decide.** Do not lower the confidence and
do not delete the fallback. Emit a measurement of the 22 guessed rows — how many name a
declaring type that actually declares the member — and only then choose between (a) keep
0.5 and document the tail, or (b) refuse the edge. Acceptance: the 22 rows are classified
in a measurement artifact and `docs` states the residual honestly.

### P2-4. `uses` at 0.7 inferred — 83.5%

`src/ast/real-csharp-analyzer.ts:3398`. The field-access half of `uses` is published at
0.7 `inferred`. This is a **declared** limitation, not a defect; it needs a doc statement
with the 83.5% figure and its denominator, not a code change.

---

## P3 — tooling, docs, and hygiene

### P3-1. `script/m14/grammar-node-inventory.ts` is Bun-only — crashes under `tsx`

`script/m14/grammar-node-inventory.ts:44` computes `ROOT` from `import.meta.dir`, which is
**`undefined` under `tsx`/Node** (it is a Bun builtin). Result:

```
$ npx tsx script/m14/grammar-node-inventory.ts csharp
TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of type string.
  at resolve (node:path:1272:7) at <anonymous> (grammar-node-inventory.ts:44:14)
$ bun script/m14/grammar-node-inventory.ts csharp
GRAMMAR-NODE INVENTORY — 1 language(s) written, 0 failed
  csharp (239 named / 533 ids)
```

Every other M14 script is `tsx`-runnable; this one silently requires Bun. Since the file is
the **cited instrument for every C# ruling**, its un-runnability under the documented
runner is itself a reproducibility defect.

**Decision (recommendation): make `ROOT` portable** — `import.meta.dir ?? dirname(fileURLToPath(import.meta.url))`.
Acceptance: the generator runs under **both** `tsx` and `bun` and writes a byte-identical
artifact (compare `csharp-grammar-nodes.json`).

### P3-2. Five cited artifacts were never committed — the rulings are unfalsifiable

Every C# ruling cites evidence that does not exist in the tree:

| cited artifact | state |
|---|---|
| `validation/m14/verification/VOCABULARY-EXTENSION-PROPOSAL.md` | **NEVER COMMITTED** |
| `validation/m14/measurements/csharp-grammar-nodes.json` | never committed (regenerated this session) |
| `validation/m14/measurements/csharp-emission-census-whole.json` | **NEVER COMMITTED** |
| `validation/m14/measurements/csharp-grammar-inventory.json` | **NEVER COMMITTED** |
| `validation/m14/verification/GRAMMAR-BINDINGS-2026-10-21.md` | **NEVER COMMITTED** (crashes the inventory generator) |

`validation/**/measurements/` is gitignored (`.bbignore:9`), which explains the
measurement files. But `VOCABULARY-EXTENSION-PROPOSAL.md` and `GRAMMAR-BINDINGS-2026-10-21.md`
live under `verification/` and are *not* covered by that rule — they were cited and never
written. That is the difference between "an artifact is regenerated locally" and "an
artifact a reader can open."

**Decision (recommendation):**
1. Regenerate `csharp-grammar-nodes.json` (done, this session) and
   `csharp-emission-census-whole.json` (`bun script/m14/csharp-emission-census.ts`), and
   **change the rulings to cite a path a reader can open** — i.e. move the committed
   measurement into a non-ignored location, or state in each ruling that the artifact is
   regenerated by a named command (and name it).
2. **Do not** create `VOCABULARY-EXTENSION-PROPOSAL.md` post-hoc unless its content can be
   reconstructed truthfully; instead remove the citation from the `decorates` ruling, which
   P0-1 rewrites anyway.
3. Either write `GRAMMAR-BINDINGS-2026-10-21.md` or make `servedDigest()` tolerate its
   absence (it currently returns `null` when missing — but only *after* `resolve()` has
   already crashed; see P3-1, the same `ROOT` bug).

Acceptance: every path cited by `script/m14/spec/csharp-completeness.json` either exists on
disk or is named as a command.

### P3-3. Doc refresh — `docs/analyzers/csharp.md` (1,630 lines) is stale in five places

| line(s) | stale claim | correct |
|---|---|---|
| `:6` | `engine.ts:1189` | **`engine.ts:1210`** (verified: `grep -n` gives 320 and 1210) |
| `:6` | "239 named node types over 533 ids" | **correct** — verified by regeneration |
| `:176-190` | "Gates, all green" / 2026-09-29 round | restate with today's re-run |
| `:280` | symbols section | now **FAIL 26** before P1-1, PASS after |
| `:533` | "Section A of the completeness gate fails on a CROSS-LANE schema gap" | resolved — `completeness-inventory.ts --lang csharp` now 8/8 |
| `:1520` | "Reported, not fixed — everything outside this lane" | re-audit; three of its rows are now closed |

Also stale: the doc never states the **44.0% resolution rate** with its denominator, and
never gives the seven-cause partition. That belongs in §"Where this lane stands".

**Decision (recommendation): rewrite the gate/standing sections from a single re-run**, not
by hand-editing numbers. Acceptance: every number in the doc is produced by a command named
beside it; `docs` and a fresh run agree.

### P3-4. `ontology-coverage-gate.ts csharp` crashes on a shared-harness import-order bug

```
$ csharp → Error: Incompatible language version 0. Compatibility range 13 through 15.
```

Reproduced identically for `kotlin` (`docs/analyzers/kotlin.md:639`) and `lua`
(`lua.md:1054`) — this is the **shared harness**, not C#. It is a known fleet-wide defect
where the WASM language version is read before the runtime is ready.

**Decision (recommendation): do not fix it in the C# lane** — fix it once in the shared
harness and re-run all three lanes. Recorded here so the C# verdict is not read as a
csharp-specific failure. Acceptance: `ontology-coverage-gate.ts csharp|kotlin|lua` all
render verdicts.

### P3-5. `run-fixtures.ts --lang=csharp` runs all 50 lanes

`script/m14/run-fixtures.ts:1901-1903` accepts only the **space** form:
`--lang csharp`. `--lang=csharp` (the `=` form) is not parsed, so the variable stays
`undefined` and the run falls through to `Object.keys(LANGS)` — **every lane**. A scoped
C# run silently becomes a 50-lane run.

**Decision (recommendation): accept both forms** (`--lang x` and `--lang=x`), or fail
loudly on an unparsed `--lang=`. Acceptance: `--lang=csharp` runs 1 lane.

### P3-6. `firing-check-v2.mjs` has no C# lane

`script/m14/firing-check-v2.mjs:178`: `CSHARP: null` (and `CS: null`). The C# firing
census therefore cannot be produced by the shared tool; it exists only as an ad-hoc run.

**Decision (recommendation): either wire a `CSHARP` entry or delete the row** so the tool
does not read as covering C#. Acceptance: the tool's language list matches reality.

### P3-7. Comment and prose defects in the analyzer

- `src/ast/real-csharp-analyzer.ts` header claims "NO locals" for the symbol surface; the
  lane **does** emit `local_function_statement` as `SymbolKind.Function` (`:1997-2001`) and
  the grammar has the node type (verified present in the 239). The header claim is false.
- `CSHARP_SYMBOL_DECLARATIONS` (`:152`) omits `local_function_statement` while the walker
  handles it separately — a reader comparing the table to the walker sees a contradiction
  that should be a one-line comment.
- The `decorates`/`mixes_in`/`part_of` prose in the spec will be rewritten by P0-1..P0-3.

**Decision (recommendation): fix the header comment and add the table note.** Acceptance:
header and walker agree; a reader can tell why `local_function_statement` is not in the table.

---

## Suggested execution order

```
P0-4  csharp-ruled.ts + registration        (unblocks the arbiter)
P0-1  decorates implemented                 (largest claim change)
P0-2  mixes_in re-ruled ontological
P0-3  part_of restated + sweep command
P1-1  conversion-operator symbol names      (turns symbols FAIL → PASS)
P2-1  oracle: contains accessor climb
P2-2  oracle: using typeArguments
P2-3  overrides 0.5 tail measured
P2-4  uses 0.7 documented
P3-1  grammar-node-inventory tsx portability
P3-2  cited-artifact audit
P3-3  doc rewrite from a single re-run
P3-4  (shared harness, not this lane)
P3-5  run-fixtures --lang= parsing
P3-6  firing-check CSHARP row
P3-7  comment defects
```

Each item is independently shippable and independently testable. P0-1 is the only one that
changes the lane's *published* relationship set, so it is the one that needs the most
careful fixture and mutant work.

---

## What I did NOT change

Read-only was honoured: no file under `src/`, `script/`, `docs/`, or
`validation/m14/spec/` was edited. Two artifacts were **written** because they are
measurement outputs the analysis required and they are gitignored by design:

- `validation/m14/measurements/csharp-grammar-nodes.json` (regenerated — the fleet's own
  generator, 239 named / 533 ids)
- `.tmp-csclose/` scratch probes (untracked, disposable)

No git command that discards work was run.
---

# PART 2 — what shipped (2026-11-19, after approval)

The owner approved the plan with the gate fix first. Everything below is **done and verified**;
nothing is left in a "designed" state.

## The gate fix (was the blocker)

`script/m14/ontology-coverage-gate.ts`:

- **`ALL_TYPES` widened 10 → 14.** It is used in all three places the gate reads a type — the edge
  counter (`:705`), the un-emitted guard (`:857`) and the row loop (`:926`) — so a type absent from
  it was **invisible**, not unruled. Blast radius measured *before* the edit (52 lanes):
  **155 new `RULED-UNJUSTIFIED` rows** fleet-wide (decorates 34, mixes_in 42, part_of 45, renders 34)
  — debt exposed, not a regression. Self-test **11/11** before and after.
- **The denominator no longer lies.** The summary printed `emitted N/10` as a literal, so a run
  emitting eleven types would have read `emitted 10/10`. Now derived from `ALL_TYPES.length`.

## P0-4 — `script/m14/csharp-ruled.ts` (new, 3 entries)

`mixes_in` and `part_of` (both `A:grammar-inventory`, `spacesProbed: ["node-types","attribute-keys"]`
— the second space is **required**, because C# writes 8,402 key/value bindings including 1,325
`attribute_argument`) and `renders` (`B:parse-tree-count`, `publishedCount: 0`). Registered in
`RULED_BY_LANG.csharp` with the `as unknown as Ruled[]` cast `clean` already uses.

## P0-1 — `decorates` implemented

A post-pass over the tree; one emission site, no grammar change. 39,782 edges over 14,415 files on
the whole admitted corpus. Four mutants, **all caught**.

## P1-1 — conversion-operator names

`implicit NetworkCredential` → `implicit operator NetworkCredential` (the source spelling).
`verify-csharp-symbols` went from **FAIL (26)** to **PASS (0)** over 49,025 symbols. The oracle moved
in the same commit, so F5 stayed at `MISSING=0 unexplained=0`.

## P3-1 — `grammar-node-inventory.ts` portable

`import.meta.dir` is Bun-only; it now falls back to `fileURLToPath(import.meta.url)`. `tsx` and `bun`
write byte-identical output (only `measuredAt` differs).

## Final gate results — single re-run, this branch

| gate | result |
| --- | --- |
| F1 grammar coverage | `PASS` refs=**112** unknown=0 unknownFields=0 |
| F3 fixtures | **27 / 27** |
| F4 mutants | **78 / 78 caught** |
| F5 differential | **100%** `MISSING=0` `unexplained=0` (powershell 60/60, fsharp 60/60) |
| `verify-csharp-symbols` | **PASS** — 49,025 symbols, 0 defects |
| `verify-csharp-line-numbers` | **PASS** |
| `verify-csharp-no-regex` | **PASS** |
| `verify-csharp-overrides-symmetry` | **PASS** |
| `verify-csharp-oracle-regressions` | **PASS** |
| `verify-oracle-coverage` | **PASS** |
| `verify-csharp-targets-resolve` | **PASS** (88.35% floor) |
| completeness inventory | **8/8** |
| ontology-coverage-gate | **emitted 11/14, FALSIFIED 0, ruled-without-justification 0** |

## Files touched

Modified: `src/ast/real-csharp-analyzer.ts`, `script/m14/ontology-coverage-gate.ts`,
`script/m14/mutate-analyzer.ts`, `script/m14/csharp-mutants.ts`, `script/m14/differential.ts`,
`script/m14/completeness-inventory.ts`, `script/m14/grammar-node-inventory.ts`,
`script/m14/spec/csharp-completeness.json`, `docs/analyzers/csharp.md`,
`validation/m14/fixtures/csharp/{payload-and-complexity,qualified-type-spelling,using-alias-and-operators}.expectation.json`.

New: `script/m14/csharp-ruled.ts`,
`validation/m14/fixtures/csharp/decorates-attribute.{cs,expectation.json}`.
