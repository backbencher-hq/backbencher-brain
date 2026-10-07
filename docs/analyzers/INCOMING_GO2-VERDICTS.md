# INCOMING_GO — per-type verdicts with numbers

Lane: `src/ast/real-go-analyzer` · branch `analyzer/INCOMING_GO2`
Corpus: `$HOME/fixtures/repositories/go-stdlib` @ `6f5c275e`
(`cmd/go: read go.mod under the lock when selecting the toolchain`), 11,800 tracked
`*.go` files, revision recorded in every census artifact.

Scope statement before the table, because it decides what every number below
means. **Every number here is OUTGOING.** An analyzer is given one file and emits
edges FROM the symbols in it. Which symbols point AT this file is a second
subsystem (resolve an emitted target to an indexed symbol, then traverse in
reverse); `graph-engine.ts` builds no reverse edges and the schema stores no
inbound row. A Go project can fire 10/10 types and still have an empty incoming
side. That is a statement about the architecture, not a defect in this lane.

## Verdict 1 — FIRING (Part 1 q2), measured through the production path

`script/m14/firing-check.mjs`, `GO` lane, run against this worktree (the shipped
copy hardcodes `$HOME/backbencher-brain`; the constant was repointed at
`/tmp/opencode/wt/INCOMING_GO` in a temp copy and nothing else was edited, so
the gate's own sampler, corpus draw and tally are the ones that ran).
Path: `getParser("go")` → `parser.parse` → `new RealGoAnalyzer().analyze`.

    120/120 files parsed
    types fired: 10 of 10

| label | edges at 120 files |
| --- | --- |
| calls | 7,880 |
| uses | 5,039 |
| contains | 1,071 |
| imports | 703 |
| references | 2,049 |
| exports | 861 |
| instantiates | 345 |
| extends | 31 |
| implements | 7 |
| overrides | 2 |

**GO fires 10/10.** This is the number source-derivation cannot produce and it is
the one that decides EMITTED vs RULED. Twelve files per lane was the earlier
figure and it is a floor; these are 120.

## Verdict 2 — the `brain_import` finding in `docs/analyzers/FIRING-CHECK.md` is a misdiagnosis, and the reason is a duplicated enum

`FIRING-CHECK.md` records: "`brain_import` was emitted by zero of twenty lanes at
120 files. Sixteen analyzers emit the raw literal `imports`, which is not an enum
value. Fifty call sites compare against `RelationshipType.Imports`. So the
`Imports` relationship type is currently unreachable through the enum in the
entire codebase."

**Measured: the premise is false, and the cause is that the gate reads the wrong
enum.** There are two declarations of `RelationshipType`:

| file | line | `Imports` member |
| --- | --- | --- |
| `src/ast/engine.ts` | 454 | `Imports = "imports"` |
| `src/ast/types.ts` | 69 | `Imports = "brain_import"` |

`real-go-analyzer.ts:352` writes `type: ASTEngine.RelationshipType.Imports` —
`ASTEngine` is `engine.ts`, so the value is `"imports"`. It is an enum member, not
a raw literal. `graph-engine.ts`'s `DEFAULT_REL_TYPES` (line 45) lists
`"imports"`, so the edges are reachable, not invisible. The firing run agrees:
`imports:703` emitted, `brain_import` not emitted.

`script/m14/firing-check.mjs:56` does `await import(\`${REPO}/src/ast/types.ts\`)`
and reads its `ALL` list from there, which is why its SILENT line names
`brain_import` — a value the analyzers were never asked to produce.
`src/ast/types.ts` has one importer in the whole repository
(`script/m14/tmp/zigw-invariants.ts`, and that one imports `SymbolKind`, not
`RelationshipType`). `script/m60/rel-type-coverage-gate.ts` reads **engine.ts**
and is therefore unaffected.

Blast radius: the SILENT line in `firing-check.mjs` output and the "enum bug is
fleet-wide" section of `FIRING-CHECK.md`. Both are MASTER-owned and neither is
changed here. The fix is one member in `src/ast/types.ts`, or the gate importing
`engine.ts` — a decision about which of the two enums is canonical, and that is
master's call, not a lane's.

## Verdict 3 — GO IS among the DERIVATION findings

`validation/m60/rel-type-coverage-baseline.json`, 104 findings, `go` has exactly
one:

    DERIVATION|go|emits `imports` but the differential audits
    ["calls","contains","extends","implements","instantiates","overrides",
     "references","uses"] — the type is stored and compared against nothing

"Stored and compared against nothing" is the worst failure mode in the programme:
an unverified edge ships a bug invisibly. This is therefore a first-class part of
the lane, not a footnote.

`script/m60/rel-type-coverage-gate.ts` `readOwnOracleLabels` (line 186) prefers a
lane's own `export const <LANG>_ORACLE_LABELS` in `script/m14/<lang>-truth.ts`
over the shared filter in `differential.ts`, and `script/m14/go-truth.ts:86`
exports all ten. The gate therefore reads ten audited labels for go and finds
none missing. The baseline row is stale in the other direction now — it records a
debt that the module repays. **Repaying it needs a baseline write, which is
MASTER-owned; reported, not made.**

What `GO_ORACLE_LABELS` claims is checked separately, below: publishing the label
set is a claim that an oracle can derive it, and the claim is only worth what the
oracle's own measured agreement is worth.
## Verdict 4 — EMITTED, all ten, on the FULL corpus

`script/m14/go-ontology-census.ts`, 12 shards merged, `--mode=emit`, the
PRODUCTION entry (`parseFile` from `src/ast/pool-worker` → `ASTEngine.parseFile`
→ `getAnalyzer("go")`). Corpus: go-stdlib @ `6f5c275e`, 11,800 tracked `*.go`
files, **11,789 admitted** (4 skipped: the engine's 120 s parse self-destruct
fires on `go/types/named_test.go`, `go/types/range.go`,
`syscall/ztypes_openbsd_arm.go`, `test/fixedbugs/issue33062.go` — named, not
silently dropped), **0 parse failures**.

    414,302 symbols · 1,037,606 relationships · 2,672,308 ms wall

| type | edges | files | empty src/tgt | placeholder src/tgt | non-ident src/tgt |
| --- | ---: | ---: | --- | --- | --- |
| `calls` | 293,086 | 7,981 | 0 / 0 | 0 / 33 | 1 / 3 |
| `uses` | 230,659 | 6,888 | 0 / 0 | 0 / 57 | 1 / 45 |
| `exports` | 216,858 | 6,693 | 0 / 0 | 0 / 0 | 2 / 2 |
| `references` | 137,054 | 7,490 | 0 / 4 | 3 / 21 | 2 / 5 |
| `contains` | 99,295 | 4,628 | 0 / 0 | 2 / 1 | 26 / 12 |
| `imports` | 32,395 | 7,645 | 0 / 5 | 0 / 5 | 0 / 12,999 |
| `instantiates` | 24,365 | 4,096 | 0 / 0 | 0 / 9 | 1 / 5 |
| `extends` | 2,215 | 793 | 0 / 0 | 0 / 0 | 0 / 0 |
| `implements` | 1,580 | 402 | 0 / 0 | 0 / 0 | 0 / 0 |
| `overrides` | 99 | 35 | 0 / 0 | 0 / 0 | 99 / 99 |

Every one of the ten has a count AND the files it came from. The three
"non-ident" columns that are large are conventions with a stated owner, not
debris, and each is adjudicated below rather than excused: `imports` targets
are MODULE PATHS (12,999 of them carry `/`, `.` or `-`), and `overrides`
endpoints are `Receiver.Method` on both sides (99/99). `imports` also has **5
edges with an EMPTY target** and 4 `references` edges likewise — those are
defects, not conventions, and they are listed in the findings below.

## Verdict 5 — RESOLVED, measured on Go's real scope ladder

`script/m14/go-endpoint-resolution.ts`. 1,500 files drawn on an EVEN STRIDE
across the sorted corpus (stride 7; the first N would have been all of `cmd/`,
the most interface-heavy subtree, and calling that a corpus rate is how a sample
becomes a lie). The resolution UNIVERSE is the whole corpus: 1,494 package
dirs, 1,494 import paths, 132,219 distinct declared names. 57,171 symbols and
151,156 relationships scored.

| type | edges | both ends reachable from this file | neither |
| --- | ---: | ---: | ---: |
| `calls` | 42,719 | 100.0% | 0 |
| `uses` | 33,910 | 99.9% | 0 |
| `contains` | 14,024 | 100.0% | 0 |
| `imports` | 4,640 | 94.5% | 0 |
| `references` | 22,419 | 99.7% | 0 |
| `exports` | 28,986 | 100.0% | 0 |
| `extends` | 234 | 100.0% | 0 |
| `implements` | 167 | 100.0% | 0 |
| `overrides` | 9 | 0.0% → **100% scored by halves** | 9 → 0 |
| `instantiates` | 4,048 | 99.7% | 0 |

Two rows need reading rather than quoting:

- **`overrides` at 0% is the INSTRUMENT being wrong, not the analyzer.** Its
  endpoints are `Receiver.Method`, and a dotted endpoint cannot match a
  single-identifier symbol table. Scored on its two halves instead: the receiver
  resolved 9/9 and the method name resolved 9/9. Reporting 0% for a type whose
  endpoints all resolve is how an instrument convicts a correct edge.
- **`imports` at 94.5%**: 4,387 targets name a package the corpus holds; **253
  are external modules** (`golang.org/x/...`, third-party). Those are correct
  edges to packages outside the corpus, not unresolved names.

The file-scope numbers in the census (`calls` 27.4%, `uses` 43.4%) are the same
edges measured with the wrong question, and the gap between 27.4% and 100% is
entirely the scopes a file cannot see. Both numbers are here so neither can be
quoted alone.

## Verdict 6 — CONFIDENT: the confidence and evidenceClass census

| type | confidence distribution | evidenceClass |
| --- | --- | --- |
| `exports` | 1.0 × 216,858 | `structural` × 216,858 |
| `contains` | 1.0 × 99,295 | `structural` × 99,295 |
| `references` | 0.95 × 137,054 | `reference_qualified` × 137,054 |
| `imports` | 0.9 × 32,395 | `import_based` × 32,395 |
| `calls` | 0.8 × 293,080, **0.5 × 6** | `usage_contextual` × 293,080, **`(none)` × 6** |
| `uses` | 0.7 × 177,192 · 1.0 × 52,688 · 0.8 × 779 | `usage_contextual` × 230,659 |
| `extends` | 0.8 × 2,215 | `inferred` × 2,215 |
| `implements` | 1.0 × 1,580 | `structural` × 1,580 |
| `overrides` | 0.95 × 99 | `usage_contextual` × 99 |
| `instantiates` | 0.8 × 19,441 · 0.6 × 4,924 | `structural` × 24,365 |

Two rows are findings, and neither is the analyzer's own arithmetic:

- **`instantiates` at 0.6 — 4,924 edges, 20.2% of that type.** Under contract §4
  a sub-0.7 edge is a heuristic, not a fact, and it must carry a
  machine-readable reason code. The sampled rows show
  `relationshipType: "go_instantation"` with `evidenceClass: "structural"` and
  **no `reasonCode`**. A 0.6 edge with no reason code is the defect §4 names.
- **`calls` at 0.5 — 6 edges with NO `evidenceClass` at all.** `classifyEvidenceTier`
  (called last over every relationship, PHASE 5.6) cannot leave an edge
  untagged, so these edges were not produced by the analyzer at all. Traced, and
  it is a real defect in a file this lane does not own — see the findings.

## Verdict 7 — INCOMING / OUTGOING: RULED, and the ruling is a measurement too

This is the gap named at handover. It is not a relationship type and cannot be made
into one.

**The language HAS the construct.** "Who points at this symbol" is a real question every
language can answer and Go answers it statically: a call, an embed, an interface
satisfaction and a promotion are all resolved at compile time, so an inbound edge is a
fact about the program, not an inference.

**The ONTOLOGY has no such member.** `RelationshipType` in `src/ast/engine.ts:453` has
ten members and none is `incoming` or `outgoing`; the same is true of the second
declaration in `src/ast/types.ts:60`. Ten is the ontology the workstream defines.

**It is a QUERY DIRECTION, and the repository already implements it.** `src/lsp/relations.ts:48`
declares `RelationDirection = "incoming" | "outgoing" | "self" | "unrelated"` and derives it
from a stored row. `src/intelligence/graph/graph-engine.ts:676` implements the inbound side by
REVERSING the stored edge:

    FROM brain_relationship r
    JOIN brain_symbol s ON s.id = r.source_symbol_id AND s.project_id = r.project_id
    JOIN ( <cascade> ) casc ON casc.id = r.target_symbol_id

So one stored row serves both directions, and `bb_graph` answers "who calls this" from the
same row the analyzer emitted. Emitting a second edge per direction would DOUBLE-COUNT every
edge in the graph — the number `bb_impact` reasons over would be wrong by a factor of two,
and `bb_migrate` would plan against inflated dependency counts.

**An analyzer cannot emit one, and this is structural rather than a limitation of this
lane.** "Incoming" is defined relative to a QUERY, so it needs every OTHER file in the
project. The analyzer is handed one file and returns edges FROM the symbols in it; the
reverse direction is the indexer's job, and it is already the indexer's job.

**So the thing the analyzer does own is whether the emitted TARGET BINDS** — a reversed
query can only find an inbound edge whose `target_symbol_id` was resolved. That is
measured, and it is the number that stands in for the incoming side:

| type | edges scored | both endpoints resolve | neither |
| --- | ---: | ---: | ---: |
| `calls` | 42,719 | 100.0% | 0 |
| `uses` | 33,910 | 99.9% | 0 |
| `contains` | 14,024 | 100.0% | 0 |
| `exports` | 28,986 | 100.0% | 0 |
| `extends` | 234 | 100.0% | 0 |
| `implements` | 167 | 100.0% | 0 |
| `references` | 22,419 | 99.7% | 0 |
| `instantiates` | 4,048 | 99.7% | 0 |
| `imports` | 4,640 | 94.5% | 0 |
| `overrides` | 9 | 100% (scored by halves) | 0 |

**Falsifier.** The ruling is overturned the moment a corpus probe finds a Go construct that
expresses an inbound dependency and produces no row under the existing reversal. The probe to
run is the endpoint-resolution ladder above plus any new construct; the ladder is already
built and reports `neither` per type, which is 0 for all ten.

**What this lane cannot settle, and why.** Whether the INDEX binds the endpoints — i.e.
whether `brain_relationship.target_symbol_id` is populated for these rows — is the indexer's
question, not the analyzer's. This pass never opens a database, so the gap between "the name
is declared" and "the row carries the id" is unmeasured here. Reported, not claimed.

## Verdict 8 — every edge this lane emits is OUTGOING, stated plainly

Not one number in this document is an inbound edge. An analyzer is given one file and emits
edges from the symbols in it. A Go project can be 10/10 on every type in this table and still
have an empty incoming side in any tool that does not reverse stored rows. `bb_graph`'s
`callers` traversal does reverse them (`graph-engine.ts:676`), so `bb_graph` specifically is
not in that position; nothing in this lane's measurement is.

## Verdict 9 — PAYLOAD, before and after, on a fixed 300-file draw

`script/m14/tmp/go-payload-probe.mts`, 300 files drawn on an EVEN STRIDE from the sorted
tracked corpus (the same 300 files in both runs, so neither can be a different sample wearing
the other's name), payload measured as the serialized byte length of the analyzer's own
`relationships` and `symbols` arrays through the production path.

| | before (`213d16321`, pre-lane) | after (`analyzer/INCOMING_GO2` HEAD) |
| --- | ---: | ---: |
| files | 300 | 300 |
| symbols | 10,402 | 10,402 |
| relationships | 25,028 | 25,028 |
| relationship payload bytes | 5,492,439 | 5,492,439 |
| symbol payload bytes | 6,419,288 | 6,419,288 |
| total bytes | 11,911,727 | 11,911,727 |
| bytes per relationship | 219.5 | 219.5 |

**Byte-identical.** Two reasons, both structural rather than lucky: this lane added NO
relationship TYPE — all ten already fired — so `graph-engine.ts`'s `DEFAULT_REL_TYPES` is
unchanged and the un-narrowed-to-filtered payload ratio the workstream quotes (2.5–4.8x) is
structurally unmoved; and the R7 endpoint gate removes edges only in compiler-rejection
fixtures, of which this draw contains none. The three new result-metadata keys
(`invalidImportPathCount`, `r7DroppedEdges`, `r7DroppedByType`) live on the ParseResult, not
on a relationship, so they are not in a relationship payload at all.

**No budget is regressed and none is re-baselined.**

`script/m60/payload-matrix.ts` was also re-run. It reports `P1: 33 declared fields × 48
languages = 1536 emit cells (749 alive)`, and it rewrote
`validation/m60/results/P1.json` from a 33-language / `0da6ea37c` state to a 48-language /
`237eff837` one. That diff is fleet drift from other lanes' work, not this lane's, and the
artifact is MASTER's, so the write was reverted after reading it. The run is recorded here
rather than the artifact.

## Verdict 10 — GAP: Go's type conversion is a construct the analyzer does not read

`script/m14/go-construct-gap-probe.ts`, 1,500 files on an even stride, ten parse-tree probes
paired with emission counts from the same files' production `parseFile` results.

**The first version of this probe was wrong about four node shapes and reported 0 for four
constructs that occur thousands of times.** The shapes are now measured, not assumed, and
the wrong guesses are recorded because a probe that reports 0 for a construct another pass
counted 1,204 times in the same run is the instrument lying.

| probe | construct | occurrences | files | edges carrying the construct's name | verdict |
| --- | --- | ---: | ---: | ---: | --- |
| P10 defer/go (**control**) | `defer f()` / `go f()` | 1,075 | 253 | 6,567 `calls` | control passes — the instrument CAN see an emission |
| P5 method value | `x.M` not called, `x` not an imported package name | 33,402 | 639 | 20,669 | covered (`uses` on the selector leaf) |
| P4b type-constraint union | `~int64 \| int64` | 10,926 | 526 | 0 | nothing in the ontology expresses it |
| P8 channel operation | `ch <- v` / `<-ch` | 823 | 87 | 0 | nothing in the ontology expresses it |
| P7 **type conversion** | `type_conversion_expression`, plus a `call_expression` whose function is a type | **868** | 172 | **0** | **GAP — the language has it, nothing reads it** |
| P7b conversion → `calls` | the MISLABEL check | 0 | 0 | **0** | no conversion is labelled `calls` — the 0.8-confidence `calls` edges are not conversions |
| P3 generic instantiation | `generic_type` with a `type_arguments` FIELD | 247 | 54 | 55 | covered (`references` to the base type) |
| P3b generic type argument | `Map[Key, Value]` with local `Key`/`Value` | 181 | 39 | 59 | covered |
| P1 defined-type dependency | `type Celsius Kelvin`, `Y` a declared type | 77 | 17 | 20 | **partial — 57 unattributed, NOT SETTLED** |
| P4 embedded interface | `constraint_elem` naming an interface | 47 | 27 | 29 | covered (`extends`, `metadata.embeddedInterface` 440 corpus-wide) |
| P6 method expression | `T.M` over a parenthesised type | 38 | 14 | 21 | covered |
| P9 select statement | `select { case <-ch: }` | 134 | 37 | 0 | nothing in the ontology expresses it |
| P2 type alias dependency | `type A = B` | **12** | 10 | **0** | **GAP — small, real** |

### The one real GAP, and why this lane does not close it

**Go has type conversion as a distinct construct.** The spec's Conversions section: a
conversion `T(x)` has **no function value and no call frame**, which is why it is not a call.
The pinned grammar gives it a node — `type_conversion_expression` (6,061 corpus-wide) — plus a
second shape for a named type (`call_expression` whose `function` is a `type_identifier`).

**868 occurrences across 172 of the sampled 1,500 files produce 0 edges**, under all ten
labels. And the mislabel check is 0, so this is not a wrong label — it is a missing edge.

**This lane will not invent the label.** `instantiates` is construction (`Foo{...}`,
`NewFoo()`); a conversion is neither construction nor a call, and publishing a conversion as
`instantiates` would assert that `[]byte(s)` builds a value, which the language does not say.
A fabricated edge is counted as `unexplained`/fabrication and poisons `bb_graph`, `bb_impact`
and `bb_migrate`. **The blocker is the ontology, not the analyzer**: `RelationshipType` has no
member for "value of type T produced from a value of type U". Adding one is a change to
`src/ast/types.ts` and `src/ast/engine.ts`, both MASTER-owned, and it is a family decision
because twelve other lanes would then be measured against a type they do not emit.

**P2 (type alias, 12 occurrences, 0 edges) is the same shape at a smaller scale.** `type A = B`
makes A an alias for B — the same type under a second name, which the spec calls a type
identity rather than a dependency. Whether an alias deserves an edge at all is the same family
decision.

**P1 is reported as NOT SETTLED rather than as a gap.** 77 constructs and 20 attributed edges.
The 57-row delta is either cross-file (the underlying type declared in a sibling file of the
package, which a per-file analyzer structurally cannot see) or uncollected by the declared-type
pass. Separating those two needs a per-site probe this wave did not run, and guessing which it
is would be the exact prose-instead-of-a-measurement failure the workstream was written to
stop. Left open on purpose, with the number.

## Verdict 11 — ORACLE AGREEMENT, and the limit of what it proves

Two oracles, both second implementations over the SAME `tree-sitter-go.wasm`:

`script/m14/differential.ts --repo go-tools --lang go --sample 200` — 200 files, production
path, independent derivations of eight labels:

    files=200  tree-truth=13,105  covered=13,104 (100%)  MISSING=1
    analyzer-edges=9,707  unexplained=0 (0%)  heuristic=0

`script/m14/go-oracle-audit.ts` — the lane's own runner over all ten labels, so
`exports` and `overrides` are included (the shared filter excludes go from `overrides`).

**The one MISSING row is a `uses` receiver read.** `uses doMain -> main` at
`cmd/ssadump/main.go:180`, where `for _, main := range ssautil.MainPackages(pkgs)` shadows the
package-level `main` function and `main.Pkg.Path()` reads the loop variable as a selector's
operand. Measured on that file: the analyzer publishes 17 `uses` edges sourced at `doMain`
(including `-> Pkg`) and not the receiver read `-> main`. An earlier rotation of the same
sample produced a different single MISSING of the same family, `uses _ -> A`, from
`go/analysis/passes/loopclosure/testdata/src/a/a.go` — a source of `_`, and that file declares
FOUR `func _()`, so the name does not even identify a unique declaration within its own file.
Both are `uses`-family coverage holes, neither is a wrong label, and **neither is fixed in this
wave**: a shadowing-resolution change wants its own fixture authored from a re-probed emission,
and shipping it without one would repeat the mistake this lane has been fixing all week.

**What agreement here does NOT prove, stated rather than implied:** both oracles load the same
`tree-sitter-go.wasm`, so a bug IN the grammar — a node type that fails to match, a field never
populated — is invisible to the differential exactly as it is to the analyzer. This establishes
that two independent implementations of each Go rule agree on a real corpus. It does not
establish that the grammar is right, and no artifact in this repository does.

## Verdict 12 — the `global` pseudo-source, measured

`script/m14/go-endpoint-defects.ts`, 11,788 files, 939,048 relationships:

| class | edges | distinct sites |
| --- | ---: | ---: |
| `D3_global_source` — source is the literal `global` | **1,802** | 1,790 |
| `D5_placeholder_target` — endpoint spelled `Unknown`/`Null`/`Symbol`/`TODO`/`Anonymous` | 99 | 97 |
| `D2_empty_target` | 4 | 4 |
| `D5_placeholder_source` — source spelled `unknown`/`undefined` | 5 | 4 |

- **`global` (1,802 edges, 0.17% of the lane's output) is the analyzer's own documented
  pseudo-source**, used when a declared-type reference cannot be attributed to a declaration
  (`extractDeclaredTypeRefs`'s `resolveSource` returns it after walking to the root). Such an
  edge says "something in this file uses T" with no way to navigate back to the declaration
  that wanted T. It is a stated scope limit rather than a defect, and it is counted here so it
  cannot be mistaken for resolution.
- **The 99 placeholder-spelled TARGETS are 126/131 resolved corpus-wide and are NOT
  placeholders.** `--mode=adjudicate` re-resolves every candidate against all 11,790 files:
  126 resolve to a real declaration in the corpus and **5 do not — and all 5 are the
  compiler-rejection `import ""` files**, now fixed. `go/constant.Unknown`,
  `database/sql.Null`, `x/tools/internal/stdlib.Symbol` and gcimporter's `Anonymous` are real
  exported members of other packages; a file-scope-blind rule convicts every one, which is the
  error `validation/m60/target-spelling-register.json` already records for two earlier runs.

## What could NOT be settled, and precisely why

**1. The ontology gate did not complete on this corpus, and neither did a full
post-fix census.** `script/m14/ontology-coverage-gate.ts go` admitted 18,923 files and then
died with `[BB-PARSE-ERR] … memory access out of bounds` on
`src/cmd/vendor/golang.org/x/telemetry/internal/configstore/download.go`, followed by the
engine's 120 s `[BB-HANG]` self-destruct on the same file. The 12-shard post-fix census died
at shard 3 for the same class of reason.

**Characterised as far as it could be, and no further.** All three implicated files
(`x/telemetry/internal/configstore/download.go`, `x/telemetry/doc.go`,
`cmd/compile/internal/escape/utils.go`) parse **cleanly and fast in isolation through the
production `getParser("go")` path** — 184 ms / 392 nodes, 38 ms / 3 nodes, 221 ms / 1,081
nodes, all with 0 error and 0 missing nodes. A targeted concurrency probe then ran **96
concurrent `parseFile` calls** over those files plus two controls (8 workers × 3 rounds, then
6 workers × 12 rounds): **0 throws, 0 parse errors, 27.1 s.** So the failure is NOT
reproducible on the implicated files in isolation or at moderate concurrency, it appeared
twice under full-corpus sweeps, and **its cause is not isolated**. Reported as an open
cross-lane finding rather than as a mechanism: `src/ast/engine.ts` is MASTER-owned, and the
honest statement is the observation plus the failed reproduction, not a theory.

**2. My worktree was deleted three times mid-session** by something pruning
`/tmp/opencode/wt/*` on this machine — it also removed four other lanes' worktrees in the
same windows. All eleven commits survived in the object store each time and the worktree was
recreated from `analyzer/INCOMING_GO2` with `git worktree add`; no work was lost, and the
commit-per-verdict discipline is why. The practical cost was measurement time, not content:
the 12-shard post-fix census got to shard 3 of 12 before the third deletion.

**3. The post-fix corpus total is derived, not re-censused.** The pre-fix census measured
11,789 files and 1,037,606 relationships. The R7 endpoint gate removes edges ONLY where an
endpoint is empty, the pre-fix census counted exactly 9 such edges (5 `imports` + 4
`references`), and every one of the 9 was verified individually through the production path
after the fix: **0 edges with an empty endpoint across all 9 affected files**, with
`r7DroppedEdges = 1` and `invalidImportPathCount = 1|1|2` on the six that had one, and two
control files (`src/archive/tar/reader.go` 278 edges, `src/bufio/bufio.go` 274 edges) dropping
nothing. So the corpus total after the fix is **1,037,597**, and it is stated as
`1,037,606 − 9 verified` rather than as a fresh full-corpus number, because the fresh
full-corpus run did not finish.

**4. The two `uses`-family coverage holes are open, with their sites named.**
`uses doMain -> main` at `cmd/ssadump/main.go:180` and `uses _ -> A` at
`go/analysis/passes/loopclosure/testdata/src/a/a.go`. Both are a bare-identifier read the
analyzer does not publish; neither is a wrong label. Fixing shadowing resolution wants its own
fixture authored from a re-probed emission first.

**5. Whether the INDEX binds the endpoints is unmeasured.** This pass never opens a database,
so the gap between "the name is declared" and "`brain_relationship.target_symbol_id` is
populated" is the indexer's to answer and is not answered here.

**6. Whether the grammar is right is unmeasured, and unmeasurable by this harness.** Both
oracles load the same `tree-sitter-go.wasm`, so a grammar bug is invisible to the differential
exactly as it is to the analyzer.

## Needs from MASTER, stated as needs and not made

| need | file | why it is not a lane's |
| --- | --- | --- |
| a relationship type for Go type conversion (868 corpus occurrences, 0 edges) | `src/ast/types.ts`, `src/ast/engine.ts` | a family decision: twelve other lanes would be measured against a type they do not emit |
| reconcile the two `RelationshipType` declarations — `engine.ts:454` has `Imports = "imports"`, `types.ts:69` has `"brain_import"` | `src/ast/types.ts` | `types.ts` has one importer in the repository and it imports `SymbolKind`; which enum is canonical is a fleet decision |
| point `firing-check.mjs:56` at `engine.ts` rather than `types.ts`, and correct the "enum bug is fleet-wide" section of `docs/analyzers/FIRING-CHECK.md` | `script/m14/firing-check.mjs`, `docs/analyzers/FIRING-CHECK.md` | MASTER-owned; the claim is built on reading the drifted enum |
| write off the repaid DERIVATION finding | `validation/m60/rel-type-coverage-baseline.json` | shrink-only baseline; `go-truth.ts`'s `GO_ORACLE_LABELS` already repays it |
| add `go` to `validation/m14/grammar-pins.json` | `validation/m14/grammar-pins.json` | the lane doc records the pin-contract status as NOT registered |
| record `overrides\|.` in go's row of the R10 register (go emits 99 dotted `overrides` endpoints; eight lanes already record the triple and go does not) | `validation/m60/target-spelling-register.json` | the register is shared and shrink-only |
| wire two `deriveGo*Truth` calls into the go truth block and drop go from the `overrides` exclusion | `script/m14/differential.ts` | MASTER-owned; `script/m14/go-truth.ts` publishes the derivations and `verify-go-lane-coverage.ts` reports the wiring as done from the lane side |
| `extractFallback` builds relationships with REGULAR EXPRESSIONS over source lines, and the production path reaches it for every file over 1 MiB: `rewriteAMD64.go` (2.8 MB) returns 5 regex-derived edges with `source: "this"`, and three larger files return nothing at all including the corpus's largest at 4.2 MB | `src/ast/pool-worker.ts` | MASTER-owned; `pool-worker.ts:290-360` |
| spread the go mutant registry into the master `MUTANTS` array (one line per mutant) | `script/m14/mutate-analyzer.ts` | MASTER-owned; `script/m14/go-mutant-run.ts` runs the registry meanwhile |
