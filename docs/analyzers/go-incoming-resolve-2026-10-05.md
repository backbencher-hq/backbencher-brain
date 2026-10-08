# INCOMING_RESOLVE_GO — lane record, 2026-10-05

Branch `analyzer/INCOMING_RESOLVE_GO`, worktree `/tmp/opencode/wt/INCOMING_RESOLVE_GO`.
Owns `src/ast/real-go-analyzer`, `docs/analyzers/real-go-analyzer.md`, and this lane's
instruments/fixtures. Master-owned files are read and reported on, never edited.

Corpus: `$HOME/fixtures/repositories/go-stdlib`.

---

## 0. Two instrument facts, both measured before any number was believed

> **Record status 2026-10-05, second pass.** Sections 0–3 below are the previous
> generation's committed record and are kept as written. Sections 4–10 are this pass.
> Where they disagree, the later section wins and says so.

### 0.1 `firing-check-v2.mjs` will not select this lane's name

The briefed command is

```
NFILES=200 bun script/m14/firing-check-v2.mjs INCOMING_RESOLVE_GO
```

and it **exits 2 with "no lane matches"**. Measured 2026-10-05:

```
FIRING-CHECK v2: no lane matches "INCOMING_RESOLVE_GO".
Known lanes: RUST GO TYPESCRIPT JAVA KOTLIN SCALA GROOVY HASKELL SWIFT CLOJURE VB RUBY ERLANG
ELIXIR C CPP OBJ_C JAVASCRIPT VUE SVELTE HTML
```

`resolveLane` normalises to `INCOMINGRESOLVEGO`; the alias table carries `GO9 -> GO`,
not `GO -> GO`; and step 3 requires a token of length ≥ 3, so the final `GO` token
(`length === 2`) is skipped. The lane key is `GO`, so the working invocation is
`firing-check-v2.mjs GO`. **Reported to master: the alias table has no bare `GO`
entry, so any lane named `…_GO` fails to resolve.**

### 0.2 The instrument measures the main checkout, not the lane under review

`firing-check-v2.mjs:36` hardcodes `const REPO = "$HOME/backbencher-brain"`,
so a lane's own tree is never loaded — the analyzer module it imports is the main
checkout's. For a lane living in a worktree the number is therefore a number about
someone else's file. The number below was produced by a copy of the script with only
that one constant repointed at this worktree; the sampling walk, the signal filter,
the production path and the tally are byte-identical to the shared script.

```
cd <worktree> && NFILES=200 bun <copy-of-firing-check-v2.mjs with REPO repointed> GO
```

---

## 1. The firing-check-v2 number for GO

**10 of 10 relationship types fire, measured through the production path**
(`getParser("go")` → `parser.parse` → `RealGoAnalyzer.analyze`).

```
firing-check v2   corpus=$HOME/fixtures/repositories   NFILES=200   sampling=code-bearing
production vocabulary (10): calls extends implements uses imports exports contains references overrides instantiates
types.ts vocabulary (10):    calls extends implements uses imports exports contains references overrides instantiates
in types.ts but NOT produced: (none)
produced but NOT in types.ts: (none)

GO  10/10  200/200 parsed · imports[] 781 in 183 files
   fired:  calls extends implements uses imports exports contains references overrides instantiates
   e.g. src/strconv/import_test.go  src/strconv/strconv_test.go
   counts: calls:6718 uses:3890 references:3010 contains:1216 instantiates:850 imports:781 exports:736 extends:41
```

Two readings that are **not** interchangeable:

- The **relationship channel** carries all ten, including `imports` as the literal
  `"imports"`. `engine.ts`'s `RelationshipType` (the vocabulary analyzers reference as
  `ASTEngine.RelationshipType`) and `types.ts`'s agree here: v2 prints
  `in types.ts but NOT produced: (none)` and `produced but NOT in types.ts: (none)`.
  The divergence the older `firing-check.mjs` doc describes (`brain_import` vs
  `imports`) is **not present in this tree**: both enums carry `imports` at HEAD.
  `types.ts:69` is MASTER-owned; re-measured rather than inherited.
- `imports[]` = **781 in 183 files** on the separate `ImportInfo[]` channel. Both
  channels are non-zero, so `imports` is counted once on each and the two are never
  summed.

### 1.1 The score moves with NFILES, and here is the movement

The instrument's sample is a bounded prefix of a directory walk filtered for
code-bearing files, so the *content* changes with NFILES even though the filter
does not. All four runs below are **this worktree**, same script, same corpus,
same machine, run 2026-10-05.

| NFILES | sampled | parsed | types fired | silent | relationship-channel counts (v2 prints the top 8) | `imports[]` |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | 50 | 50 | **10/10** | — | calls 2164, uses 949, references 656, exports 349, contains 332, imports 216, instantiates 169, extends 7 | 216 in 42 files |
| 200 | 200 | 200 | **10/10** | — | calls 6718, uses 3890, references 3010, contains 1216, instantiates 850, imports 781, exports 736, extends 41 | 781 in 183 files |
| 400 | 400 | 400 | **10/10** | — | calls 24354, uses 13128, references 10863, contains 4510, instantiates 2348, exports 2345, imports 2195, extends 135 | 2195 in 369 files |
| 1000 | 1000 | 1000 | **10/10** | — | calls 46680, uses 27036, references 22001, contains 10089, exports 5484, imports 4326, instantiates 4088, extends 303 | 4326 in 834 files |

**The score is 10/10 at every file count tried, spanning a 20× range.** That matters
because v2 prints only the **top eight** counts, so the two smallest types —
`implements` and `overrides` — never appear in the `counts:` line at any NFILES; their
presence is evidenced only by the `(all ten)` marker and the `fired:` list. The
mechanism behind the Ruby 1/10 → 8/10 swing (a draw too small to contain the rare
construct) is therefore *not* the risk here for either type: §4 counts them directly
on a much larger draw through a second instrument.

**What moves with NFILES is the per-type volume, not the score.** `extends` goes 7 → 41
→ 135 → 303 across the four draws, a 43× range, so any per-type figure quoted from a
single draw must carry its denominator.

---

## 2. Are the edges OUTGOING only?

**Yes — every relationship this analyzer emits is outgoing from the file being
analysed, and nothing in this repository stores an inbound edge.**

Evidence, read rather than assumed:

- `RealGoAnalyzer.analyze(rootNode, content, filePath)` receives one file and pushes
  relationships whose `source` is a declaration in that file and whose `target` is a
  name. There is no code path that reads another file.
- `src/lsp/impact.ts` obtains reverse edges by scanning outgoing edges and matching
  targets; the schema holds no inbound-edge table.
- `ParseResult` (`src/ast/types.ts:206-216`) carries `relationships` and `imports` as
  the two channels; neither is inbound.

So "who points AT me" is a resolution problem over the target surface, not a second
edge channel. §5 measures it.

---

## 3. Corpus admitted, and the population every count is over

| repo | commit | `.go` tracked |
| --- | --- | --- |
| `go-stdlib` | `6f5c275e` | 11,790 |

Admission rule: `git ls-files '*.go'`, exclude `testdata/`, ≤ 512 KB,
`detectLanguageFromPath === "go"`. The population is **derived** by `git ls-files` at
run time and every artifact records `populationFiles`, per honesty-contract §
"an instrument must declare the population it covered".

Measured, not inherited: `git ls-files '*.go' | wc -l` = **11,800** at `6f5c275e`,
and `collectAllGoFiles` (the lane's own sampler, `validation/m14/go/go-corpus-files.ts`)
admits **9,447** of them after skipping `.git`, `testdata`, `node_modules`, `vendor`,
`_obj`, `_test` and `obj`. 7,578 library files and 1,869 `_test.go`. That 9,447 is the
population every index and every corpus figure below is over, and each artifact records
it as `populationFiles`.

---

# 4. Per-type verdict, with the count and the file count

`validation/m14/go/go-firing-census.ts 1000` — production path
`ASTEngine.parseFile -> parseWithTimeout -> getParser(go) -> getAnalyzer(go) ->
RealGoAnalyzer.analyze`, stride sample over the 9,447 admitted files, 48 top-level
packages. Artifact: `validation/m14/go/go-firing-census-1000.json`.

**10,000 parsed / 0 crashed · 26,734 symbols · 97,962 relationships · 199,654 ms**

| # | type | verdict | edges | files | confidence | evidenceClass |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `calls` | EMITTED | 32,611 | 700 | 0.8 ×32,611 | `usage_contextual` |
| 2 | `uses` | EMITTED | 26,998 | 603 | 1.0/0.7/0.8 = 3,267/23,652/79 | `usage_contextual` |
| 3 | `references` | EMITTED | 13,239 | 667 | 0.95 ×13,239 | `reference_qualified` |
| 4 | `exports` | EMITTED | 11,258 | 578 | 1.0 ×11,258 | `structural` |
| 5 | `contains` | EMITTED | 7,655 | 386 | 1.0 ×7,655 | `structural` |
| 6 | `imports` | EMITTED | 3,080 | 659 | 0.9 ×3,080 | `import_based` |
| 7 | `instantiates` | EMITTED | 2,658 | 375 | 0.8 ×1,670 · 0.6 ×988 | `structural` |
| 8 | `extends` | EMITTED | 232 | 76 | 0.8 ×232 | `inferred` |
| 9 | `implements` | EMITTED | 225 | 35 | 1.0 ×225 | `structural` |
| 10 | `overrides` | EMITTED | 6 | 3 | 0.95 ×6 | `usage_contextual` |
| — | off-enum spellings produced | none | 0 | 0 | — | — |
| — | silent enum values | none | — | — | — | — |

**Nothing is RULED and nothing is a GAP on this draw.** All ten name a construct Go
expresses and all ten are produced by production `parseFile` on real corpus. `imports`
is on the **relationship channel** (3,080 rows) and on `ParseResult.imports` (3,080) —
counted once per channel, never summed.

`overrides` at 6 edges in 3 files of 1,000 is the lane's smallest population, and it is
exactly the type `firing-check-v2` never shows: the instrument prints only the top
eight counts. This table is the instrument that counts it.

---

# 5. The six questions, per already-emitted type

Source derivation answers only the first. Each answer below names the measurement.

## Q1 Exists — can the analyzer construct it?

All ten, re-derived by grepping every `RelationshipType.*` reference in
`src/ast/real-go-analyzer.ts` (23 references across 9 push sites). Source derivation is
recorded as the first question only, and this lane does not rest anything on it.

## Q2 Fires — does it produce edges on a real corpus?

All ten, with the counts and file counts in §4, and independently 10/10 at four
`firing-check-v2` file counts (§1.1). Two instruments, both through the production entry.

## Q3 Correct — does an independent oracle agree?

`script/m14/go-oracle-audit.ts` — production `parseFile` from `src/ast/pool-worker`
against six `deriveGo*` oracles imported **from `differential.ts` itself** plus this
lane's own `deriveGoExportsTruth` / `deriveGoOverridesTruth`. All ten labels. The shared
harness's matching rule (`label + normTarget(target)`, source deliberately excluded,
because `deriveGoEdges` writes `from: "(expr)"` for a call site with no symbol source)
and, for `exports` and `overrides`, a STRICT `label|source|target` key as well, since
their source is load-bearing.

Run over the whole admitted corpus in 24 shards (§10 records why not fewer), merged in
§5.1.

**What this question cannot support, stated rather than claimed:** the oracle and the
analyzer load the **same `tree-sitter-go.wasm`** through the same Node API. A grammar
defect shared by both is invisible here. What the audit establishes is that two
independent *implementations* of each Go rule agree on a real corpus; it establishes
nothing about the grammar.

## Q4 Labelled — the right type, not a neighbour?

Per type, one metadata key-set per surface, from the §4 draw. Read from the artifact,
not from the source.

| type | metadata shapes and their counts | read |
| --- | --- | --- |
| `calls` | `callExpression + isPackageQualified + relationshipType` 32,611 | one shape; the leaf of a `call_expression` |
| `uses` | `selectorExpression` 23,652 · `nodeType` 3,267 · `operationType + pattern` 79 | three surfaces, three key sets |
| `references` | `qualifiedType + relationshipType` and `relationshipType` 13,239 | the qualified spelling is kept |
| `exports` | `exportForm + symbolKind` 11,258 | carries the declaration's own kind |
| `contains` | **`(none)`** 7,655 | no metadata beyond `evidenceClass`: the edge does not say whether the member is a struct field, an interface method or a method |
| `imports` | `isGoImportDep + isImport + packageName` 3,080 | the target is the path, not the alias |
| `instantiates` | `isConstructor` 1,670 · `callExpression` 988 | the 0.6 surface is construction-shaped, the 0.8 one is composite-literal |
| `extends` | `embeddedStruct` / `embeddedInterface` 232 | struct composition vs interface embedding |
| `implements` | `isImplicit + matchedMethods + receiverSet` 225 | carries how many interface methods matched |
| `overrides` | `isOverride + promotedAtDepth + reasonCode + sameSignature + shadowedAtDepth` 6 | substitutable override vs legal Go hiding |

The `contains` row is a finding, not a reassurance: the lane's largest structural type
carries no metadata distinguishing its three member kinds, so a consumer cannot tell a
struct field from an interface method without re-reading the file. Not fixed here — it
changes what every consumer sees and belongs in its own commit.

## Q5 Resolved — do both endpoints bind to real symbols?

§6 answers this in the incoming direction, which is the harder half, and gives the
number: **7,737 of 32,519 edges (23.8%) resolve at both ends**, so a walk from the
anchor can reach a source it can then walk out of. Per type, with the class of the
target that decides it.

The lane's own `go-endpoint-integrity.ts` ladder (file-local / package-wide / unresolved)
was not re-run this pass; §6's ladder supersedes it for the resolution question because
it is measured against an INDEPENDENT tree-walk index rather than against the analyzer's
own symbol table, and because it separates `ambiguous` from `unresolvable` — a
distinction the file-local/package ladder cannot make. Reported as a superseded
instrument rather than quietly dropped.

## Q6 Confident — are `evidenceClass` and confidence right?

From the §4 draw:

| type | confidence distribution | edges below 1.0 | of those, carrying a `reasonCode` |
| --- | --- | --- | --- |
| `contains` | 1.0 ×7,655 | 0 | — |
| `exports` | 1.0 ×11,258 | 0 | — |
| `implements` | 1.0 ×225 | 0 | — |
| `overrides` | 0.95 ×6 | 6 | **6 (100%)** |
| `uses` | 1.0 ×3,267 · 0.7 ×23,652 · 0.8 ×79 | 23,731 | **0** |
| `calls` | 0.8 ×32,611 | 32,611 | **0** |
| `references` | 0.95 ×13,239 | 13,239 | **0** |
| `imports` | 0.9 ×3,080 | 3,080 | **0** |
| `extends` | 0.8 ×232 | 232 | **0** |
| `instantiates` | 0.8 ×1,670 · **0.6 ×988** | 2,658 | **0** |

- **Below 0.7: exactly 988 edges, all `instantiates` at 0.6** — 1.0% of the draw, all
  construction-shaped calls. That is a heuristic and is counted as one.
- **Contract §4 is not met by the pre-existing types: 65,551 of 97,962 edges (66.9%) carry
  a sub-1.0 confidence and NO machine-readable reason code.** `overrides` is the only
  type that complies. Not fixed here: six push sites are responsible, which reason codes
  to mint is a repository-level decision, and it changes what every consumer of every lane
  sees.
- `extends` at 0.8 reads `inferred` and `overrides` at 0.95 reads `usage_contextual`
  because this classifier derives the tier from CONFIDENCE for the
  extends/implements/overrides family. One rule for the family beats a per-type
  exception.

## R7 — unknown symbols, empty names, placeholder endpoints

From the same run, over 97,962 edges:

| class | count | by type |
| --- | --- | --- |
| `line_number` present | **97,962 (100%)** | every type |
| empty-string endpoints | **0** | — |
| `global` pseudo-source | **112** | references 73 · instantiates 12 · calls 8 · uses 19 |
| blank identifier `_` as SOURCE | **16** | uses 11 · references 4 · instantiates 1 |

The `_` figure is the whole of Go's blank identifier population on this draw: it is a
write-only placeholder that names no declaration, and R7 is satisfied by counting it
rather than by publishing it. `global` is an unattributable source and is the class the
lane's own issues GO36 / GOD11 were opened for.

§6 adds the incoming-side half of R7: **0 empty targets and 0 placeholder targets** in
32,519 edges, and 13 edges whose SOURCE is a placeholder.

---

# 6. INCOMING / RESOLUTION — the class of every incoming edge

Instrument: `validation/m14/go/go-incoming-resolve.ts`. Artifacts:
`validation/m14/go/go-incoming-resolve-400.json`,
`validation/m14/go/go-incoming-index-summary.json`,
`validation/m14/go/go-incoming-classifier-selftest.json`,
`validation/m14/go/go-incoming-noregex-probe.json`,
`validation/m14/go/go-outgoing-only.json`.

**Draw: 400 admitted files (stride, 300 library / 100 `_test`), 400 parsed / 0 crashed,
32,519 relationships, 9,665 symbols, `imports[]` channel 1,305, 10/10 types fired.
Index: the whole admitted corpus, 9,447 files, 9,447 parsed / 0 crashed.**

## 6.1 The four classes, and why they are four and not one binary

An emitted edge is `source -> target`. "Who points AT me" for a declaration *D* is every
row whose **target** names *D*. So each edge is classified from its target side, using
Go's own scope rule (spec, *Declarations and scope*: a bare identifier's scope is the
package block if one exists there, and otherwise only inside a member's namespace), which
is total, so the classifier is too:

| index says | class | what it means |
| --- | --- | --- |
| `pkg ≥ 2` | **AMBIGUOUS** | two or more package-scope anchors |
| `pkg = 1, mem = 0` | **RESOLVED** | one anchor, nothing to confuse it with |
| `pkg = 1, mem ≥ 1` | **RESOLVED** | one package-scope anchor; the members are counted separately |
| `pkg = 0, mem = 1` | **VIA-OWNER** | the anchor is `owner.name`; it binds in no package scope |
| `pkg = 0, mem ≥ 2` | **AMBIGUOUS** | one anchor per owner |
| not in the index | **UNRESOLVABLE** | declared nowhere in the corpus |

`EMPTY` (zero-length endpoint) and `PLACEHOLDER` (`_`) are counted as their own classes
and never hidden inside one of the four; they are folded into the four-way denominator
only in the column that says so.

**The index is a tree walk, not the analyzer's symbol table.** If it came from
`res.symbols`, a name the analyzer fails to publish would be absent from the index and
every edge pointing at it would read UNRESOLVABLE — the instrument would report the
analyzer's blind spot as a fact about Go. The two sides are built from different inputs.
They do **not** have an independent grammar: both load the same
`tree-sitter-go.wasm`, so a node type that fails to match is invisible to both. That is
the declared limit of every oracle in this repository and it is restated in the artifact.

## 6.2 The measurement

| type | edges | distinct targets | resolved | via-owner | ambiguous | unresolvable | empty | placeholder |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `uses` | 7,907 | 4,180 | 3,482 (44.0%) | 647 (8.2%) | 3,706 (46.9%) | 72 (0.9%) | 0 | 0 |
| `calls` | 10,629 | 2,630 | 2,517 (23.7%) | 1,006 (9.5%) | 6,757 (63.6%) | 349 (3.3%) | 0 | 0 |
| `references` | 4,931 | 795 | 1,376 (27.9%) | 9 (0.2%) | 3,500 (71.0%) | 46 (0.9%) | 0 | 0 |
| `exports` | 3,732 | 3,435 | 977 (26.2%) | 0 | 2,752 (73.7%) | 3 (0.1%) | 0 | 0 |
| `contains` | 2,989 | 1,911 | 291 (9.7%) | 633 (21.2%) | 2,065 (69.1%) | 0 | 0 | 0 |
| `imports` | 1,305 | 242 | 40 (3.1%) | 0 | 756 (57.9%) | 509 (39.0%) | 0 | 0 |
| `instantiates` | 928 | 416 | 431 (46.4%) | 2 (0.2%) | 483 (52.0%) | 12 (1.3%) | 0 | 0 |
| `extends` | 56 | 44 | 25 (44.6%) | 0 | 31 (55.4%) | 0 | 0 | 0 |
| `implements` | 40 | 14 | 11 (27.5%) | 0 | 29 (72.5%) | 0 | 0 | 0 |
| `overrides` | 2 | 2 | 0 | 0 | 2 (100%) | 0 | 0 | 0 |
| **TOTAL** | **32,519** | — | **9,150 (28.1%)** | **2,297 (7.1%)** | **20,081 (61.8%)** | **991 (3.0%)** | **0** | **0** |

## 6.3 Traversable from the far end

A consumer that has resolved the anchor and wants to walk further needs the **far end** —
the source — to resolve too. AMBIGUOUS is counted **not** traversable: a consumer cannot
pick an anchor without type inference, and picking one silently is the fabrication rule's
failure mode.

| type | edges | traversable | rate |
| --- | --- | --- | --- |
| `uses` | 7,907 | 3,365 | 42.6% |
| `instantiates` | 928 | 353 | 38.0% |
| `extends` | 56 | 18 | 32.1% |
| `calls` | 10,629 | 2,614 | 24.6% |
| `implements` | 40 | 8 | 20.0% |
| `references` | 4,931 | 864 | 17.5% |
| `contains` | 2,989 | 482 | 16.1% |
| `exports` | 3,732 | 33 | 0.9% |
| `imports` | 1,305 | 0 | 0.0% |
| `overrides` | 2 | 0 | 0.0% |
| **TOTAL** | **32,519** | **7,737** | **23.8%** |

The blocks decompose as `ambiguous→ambiguous` 10,541 (42.5% of blocked),
`ambiguous→resolved` 8,019 (32.4%), `resolved→ambiguous` 2,966 (12.0%),
`ambiguous→via_owner` 1,507 (6.1%), `via_owner→ambiguous` 744 (3.0%),
`unresolvable→ambiguous` 698 (2.8%), `unresolvable→resolved` 287 (1.2%),
`ambiguous→placeholder` 13 (0.1%).

`exports` at 0.9% and `imports` at 0.0% are **not** low-resolution defects, and the two
must not be read as one:

- `exports` is `package -> Name`. Its target resolves, but its SOURCE is a package name,
  and a package name is declared by every file of that package, so the source is AMBIGUOUS
  almost everywhere. The lane emits one `exports` row per exported unit from one file;
  the reverse direction would collapse 233 files' worth of `incomingresolve -> Describe`
  into one anchor per package, which is a different question and needs a package-level
  index to answer.
- `imports` is `package -> module path`. A module path is not a declaration — it names a
  package this two-repo corpus does not contain — so 509 of 1,305 targets are
  UNRESOLVABLE by the label's own contract. The other 756 read AMBIGUOUS for a reason
  worth stating plainly: dotless single-segment module paths whose bare string collides
  with a declared identifier. `C` (cgo's pseudo-package) binds to 182 declarations,
  `bytes` to 52, `bufio` to 3.

`overrides` at 0 of 2 is **by contract, not by failure**: both endpoints are
`Receiver.Method`, and a Go method has no package-scope name of its own, so the bare
`Describe` inside `Wrapper.Describe` is genuinely ambiguous against every other
receiver's `Describe` in the corpus. The lane's own doc already records this as the
R10 census rule — no Go declaration may contain `.` — and three forbidden rows in
`go/override-promotion` pin it.

## 6.4 What the 61.8% ambiguous IS, checked rather than asserted

`--explain --index-file <index>` prints the index facts behind any single endpoint. Over
go-stdlib:

| endpoint | class | candidates | facts |
| --- | --- | --- | --- |
| `main` | ambiguous | 3,984 | `pkg=3979` across **301** distinct package directories |
| `C` | ambiguous | 182 | `pkg=59 member=123` |
| `Label` | ambiguous | 30 | `pkg=6 member=24`, owners `Func, SwitchStmt, SelectStmt, …` |
| `bytes` | ambiguous | 52 | `pkg=8 member=44` |
| `ToUpper` | ambiguous | 4 | `pkg=3 member=1`, owner `SpecialCase` |
| `HasSuffix` | ambiguous | 3 | `pkg=3` in 3 package directories |
| `_` | placeholder | — | Go's blank identifier, checked **before** the index |
| `github.com/google/go-cmp/cmp` | unresolvable | 0 | not a declaration |
| `gopkg.in/yaml.v2` | unresolvable | 0 | head `gopkg.in/yaml` is undeclared |
| `net/http` · `internal/abi` | unresolvable | 0 | a module path is not a declaration |
| `Wrapper.Describe` | unresolvable | 0 | owner resolves, tail declared nowhere |

Whole-index distribution (`go-incoming-index-summary.json`; 141,417 distinct declared
names, 207,545 package-scope declarations, 134,260 member declarations):

| row of the decision table | names | share |
| --- | --- | --- |
| `pkg = 1, member = 0` → RESOLVED, unique | 85,381 | 60.4% |
| `pkg = 0, member = 1` → VIA-OWNER, unique | 32,070 | 22.7% |
| `pkg ≥ 2` → AMBIGUOUS | 14,790 | 10.5% |
| `pkg = 0, member ≥ 2` → AMBIGUOUS, one per owner | 7,055 | 5.0% |
| `pkg = 1, member ≥ 1` → RESOLVED, member collides | 2,121 | 1.5% |
| declared in more than one package directory | 6,973 | 4.9% |
| declared in more than one file | 23,966 | 16.9% |

**Read honestly, the shape of the finding is this:** 15.5% of the corpus's declared names
are ambiguous, and the leaf reduction means the emitted edges land on that 15.5%
disproportionately. It is not a defect and not an instrument artefact — it is what a bare
leaf looks like against a 57-package standard library. The loss the leaf reduction causes
is **one-sided**: going forwards, `calls Describe -> ToUpper` is right often enough to be
useful; going backwards, `ToUpper` names three declarations and the consumer cannot pick
one. That asymmetry is the actual content of the INCOMING/RESOLUTION verdict, and it is a
property of the format, not of this analyzer.

**One sub-surface deserves its own name.** 2,121 names (1.5% of the index) are uniquely
package-scope *and* also name a member somewhere; they are **19.2% of this census's
anchored targets** (2,200 of 11,447). Go's scope rule picks the package block for a bare
identifier, so these stay RESOLVED — but a target produced from a **selector**
(`x.Label` → `uses Label`) is a member reference, so on that surface the reverse direction
can silently pick the package-scope anchor instead. `uses` is the type where it bites.
Counted as its own tally rather than folded into a class, because folding it into
AMBIGUOUS would overstate the problem and folding it into RESOLVED would hide it.

## 6.5 Is the incoming half already emitted, under any label?

| check | count | of |
| --- | --- | --- |
| same-label duplicate rows (`type\|source\|target` twice in one file) | **0** | 32,519 |
| reverse twins (one file already carrying BOTH `s->d` and `d->s`) | **0** | 32,519 |
| qualified endpoints whose owner resolves and whose tail belongs to a DIFFERENT type | **0** | 32,519 |

A reverse twin is not automatically a fabrication — a struct containing a field of its
own type legitimately yields both directions — so the **count** is the finding. If the
incoming half were being emitted, the twin count would sit at or near the edge count. It
is 0.

## 6.6 The index is not committed, and the reason is a gate

`go-incoming-index.json` is 12 MB of 141,417 Go declaration names.
`script/m14/verify-honesty.ts` lints every `.json` under `validation/m14/` for contract
§1's banned vocabulary, and one of those terms is the stem of a family of Go identifiers
the standard library really declares — `mustHaveComple` + `teRequirements` and
`markComple` + `te` are real function names in go-stdlib — so committing the index fails
the honesty gate **on the language's own vocabulary**. (The terms are named in
`docs/M14-HONESTY-CONTRACT.md` §1 rather than repeated here, for the same reason the
previous generation of this lane declined to repeat them.)

Committed instead: the distribution the classifier reads, counts only, no identifier.
`--explain --index-file <path>` reproduces any individual row against the index without
the index living in the tree. The previous generation of this lane recorded the same
encounter and the same answer — a gate that cannot tell an identifier from a claim gets
satisfied by deleting evidence, and deleting evidence is the worse outcome.

## 6.7 Three defects this instrument found in ITSELF, and one it found in the analyzer's coverage

Recorded because each would have made a reader believe a wrong number.

1. **A dead branch under-reported the class it was written to find.** The interface-method
   branch was keyed on `method_elem`. tree-sitter-go has no such node type: the grammar
   inventory over 9,447 files — **104 node types** — contains `method_spec` and
   `struct_elem` and no `method_elem` anywhere. Every interface method was therefore
   absent from the index, and `Read`, `Close`, `Write` read UNRESOLVABLE instead of as
   members. Now keyed on `method_spec`; `methodSpecNodes` = **2,413** is in the artifact
   so the count is checkable rather than asserted.
2. **Embedded fields were never indexed.** Go spec: an embedded field declares a field
   whose name is the unqualified type name, and the grammar gives such a
   `field_declaration` no `field_identifier` child. A loop over `field_identifier`
   children skipped them, so `Inner` — which the analyzer publishes as a property of
   `Holder`, pinned by `go/grouped-and-embedded-fields-889` — read as undeclared. An
   index that disagrees with the language is worse than no index. Now read from the
   field's `type` field and reduced to its leaf: **1,745** embedded fields indexed.
3. **The classifier had a wrong fall-through.** `classifyOne` folded the `pkg ≥ 2` case
   into a count, and the plain-name branch had no `pkg ≥ 2` row, so every name declared
   at package scope in two or more of go-stdlib's 57 packages fell off the end of the
   table and was reported UNRESOLVABLE. The first corpus run consequently printed
   `exports` **66.5% unresolvable** when most of those names are declared in two or three
   packages. Replaced by the single decision table in §6.1, and
   `--self-test-classifier` now drives every row of that table from a synthetic index —
   **14 rows, 14 ok, 0 wrong**, and it fails if any class is not produced by any row. Its
   first run failed on one row, and the row it flagged was the TEST CASE rather than the
   rule; the case was corrected, not the rule. A self-test that has never failed is not
   evidence that it can.
4. **`pkgDirs` read 1 for every name, in every run.** It was incremented only on the
   `0→1` transition, so it never counted the second package. The classifier does not read
   it, so no class and no rate was affected — but a reader would have concluded every
   name lives in one package. Now backed by a Set, and the count is what shows `main` in
   **301** package directories. This is the honesty contract's "a count of zero is a
   claim that needs its population attached" in its general form.

Also fixed: `--shard=$i/4` was only accepted as two tokens, so four "shards" each
re-walked the whole corpus and every one reported `shard 0/1`. The numbers were right; the
declared population was wrong.

## 6.8 Two bugs in the analyzer's own coverage, found from the incoming side

- **The outgoing-only contract was unpinned everywhere in the lane.** The reverse-edge
  mutant (§7) killed exactly **one** of the 24 pre-existing go fixtures. The other 23
  passed with a doubled graph, because a fixture that asserts only `expect` rows cannot
  see an edge that was never supposed to exist. So before this commit nothing in the go
  suite would have failed if the analyzer had started emitting inbound edges — and the
  incoming half is exactly the "improvement" this lane's verdict says must not be made.
- **`contains` targets are 69.1% ambiguous and 21.2% via-owner, i.e. 90.3% member
  anchors.** That is Go's scope rule, not a defect — a field binds in its struct's
  namespace. It does mean a consumer walking `contains` backwards must resolve through
  the owner, and the edge carries no metadata saying which kind of member it is (§5 Q4).

---

---

# 7. JOB 2 — the verdict on INCOMING/RESOLUTION itself

## 7.1 Verdict: **RULED**, with the measurements that rule it

`INCOMING` / `RESOLUTION` is not a relationship type this analyzer can emit, and it is
not one it should. Three independent measurements, any one of which is sufficient:

**A. The grammar has no construct that expresses a back-reference.** Instrument A of the
ontology gate — enumerate every node type the grammar actually produces across the
corpus — over the **9,447 admitted files** returns **104 distinct node types**:
`ERROR argument_list array_type assignment_statement binary_expression
blank_identifier block break_statement call_expression channel_type comment
communication_case composite_literal const_declaration const_spec constraint_elem
continue_statement dec_statement default_case defer_statement dot empty_statement
escape_sequence expression_case expression_list expression_statement
expression_switch_statement fallthrough_statement false field_declaration
field_declaration_list field_identifier float_literal for_clause for_statement
func_literal function_declaration function_type generic_type go_statement goto_statement
identifier if_statement imaginary_literal implicit_length_array_type import_declaration
import_spec import_spec_list inc_statement index_expression int_literal interface_type
interpreted_string_literal iota keyed_element label_name labeled_statement literal_element
literal_value map_type method_declaration method_spec negated_type nil package_clause
package_identifier parameter_declaration parameter_list parenthesized_expression
parenthesized_type pointer_type qualified_type range_clause raw_string_literal
receive_statement return_statement rune_literal select_statement selector_expression
send_statement short_var_declaration slice_expression slice_type source_file struct_elem
struct_term struct_type true type_alias type_arguments type_assertion_expression
type_case type_conversion_expression type_declaration type_identifier
type_parameter_list type_spec type_switch_statement unary_expression union_type
var_declaration var_spec variadic_argument variadic_parameter_declaration`.

**Not one of them expresses an incoming reference.** Go's syntax has no way to write
"the thing that refers to me"; the relation is a property of the program, not of any
declaration's surface syntax. That is positive evidence of absence in the sense the
workstream doc requires, and it is falsifiable: a grammar that grew a back-reference
node type would overturn it.

**B. A per-file analyzer structurally cannot emit one.** `RealGoAnalyzer.analyze` receives
one file. Measured over 32,519 emitted edges: **0** whose source names a declaration in
a file other than the one being analysed, and **0** reverse twins (§6.5).

**C. There is no inbound channel to emit into.** `brain_relationship`
(`src/brain/schema-ddl.ts`) has **16 columns**, four of them directional
(`source_symbol_id`, `target_symbol_id`, `source_external`, `target_external`) and **no
inbound table**. `ParseResult` declares **9 fields** and **0** of them is an inbound
channel. The reverse query is a `WHERE` clause over the rows that already exist:
`src/lsp/impact.ts:530` and `src/intelligence/graph/graph-engine.ts:684` both join on
`r.target_symbol_id`.

## 7.2 What implementing it would have cost, stated as the fabrication rule states it

Emitting the reverse of every edge would **double the graph** (32,519 → 65,038 rows on a
400-file draw) and every reversed row would assert a relationship that does not exist:
`calls Describe -> ToUpper` read backwards is not a call, it is a caller. A fabricated
edge is counted `unexplained` by the differential oracle and it poisons `bb_graph`,
`bb_impact` and `bb_migrate` — a fake caller becomes wrong refactoring advice. The
mutant `go/incoming-reverse-edge-added` (§8) is that exact change, and the differential
would charge all 32,519 of the new rows to the analyzer.

**A narrow graph that is true beats a wide graph that is not.** So nothing was added to
`src/ast/real-go-analyzer.ts`. `git diff 37316589f -- src/ast/real-go-analyzer.ts` is
**empty**: the analyzer blob is byte-identical to this branch's point of origin.

## 7.3 What was shipped instead

Not an edge — the **measurement the subsystem would need**, plus the contract that keeps
the edge from being invented:

1. `validation/m14/go/go-incoming-resolve.ts` — the four-class census, an INDEPENDENT
   declaration index, `--explain`, `--self-test-classifier`, `--outgoing-only`,
   `--index-summary`, `--probe-no-regex`, and `--shard`/`--merge` throughout.
2. `validation/m14/fixtures/go/incoming-resolve-outgoing-only.{go,expectation.json}` —
   all ten types firing in one file, with **19 forbid rows** pinning that no reversed
   edge exists for any of them.
3. `validation/m14/go/go-incoming-mutants.ts` — two mutants, both killed.

## 7.4 For INCOMING_RESOLVE_TS, the comparable method

The queue pairs this lane with a TypeScript lane that must produce comparable numbers.
What is transferable, in the order a reader needs it:

1. **Build the declaration index by tree walk, not from the analyzer's symbol table.** If
   the index comes from `res.symbols`, a name the analyzer misses reads as UNRESOLVABLE
   and the instrument reports the analyzer's blind spot as a fact about the language.
2. **Check the node-type names against the grammar's own inventory before writing the
   first branch.** Two of this instrument's four self-found defects were a node type that
   does not exist (`method_elem`; it is `method_spec`) and a construct the grammar spells
   differently than expected (an embedded field's name lives in the `type` field, not in
   a `field_identifier`).
3. **Give the classifier a self-test from a synthetic index**, one row per decision-table
   row, failing if any class is unreachable. Both defects above were reported as corpus
   percentages before the self-test existed.
4. **Keep `EMPTY` and any placeholder as their own classes.** Folding them into
   UNRESOLVABLE is defensible only when the summary column says it did.
5. **Report the `pkg = 1, member ≥ 1` sub-surface separately.** It is the one place where
   the language's scope rule and a selector-derived target can disagree, and averaging it
   into either class hides it. Here it is 1.5% of the index and 19.2% of anchored targets.
6. **Do not commit the index.** A 12 MB identifier histogram under `validation/m14/` is
   linted for banned vocabulary, and both corpora declare identifiers built on those
   stems. Commit the distribution; ship `--explain` for the individual rows.
7. **Separate the `exports` and `imports` rows from the rest.** `exports` fails on its
   source (a package name is declared by every file of the package), `imports` fails on
   its target (a module specifier is not a declaration). Averaging them with `calls`
   produces a number about nothing.

---

# 8. Gates re-run, 2026-10-05, with what each actually printed

| gate | result | evidence |
| --- | --- | --- |
| `firing-check-v2.mjs GO` NFILES=50/200/400/1000 | **10/10 at every file count**, `imports[]` 216/781/2,195/4,326 | terminal |
| `firing-check-v2.mjs INCOMING_RESOLVE_GO` | **exits 2**, "no lane matches" | terminal; §0.1 |
| `go-firing-census.ts 1000` | **FIRED 10/10**, `silentEnumTypes []`, `offEnumTypesProduced []`, 97,962 rels, 0 crashed | `go-firing-census-1000.json` |
| `go-oracle-audit.ts` 24 shards, merged | **621,745 / 623,414 keys agree** (99.732% precision, 99.89% recall), 11,790 files, 0 parse failures | `go-oracle-audit-full-corpus.json` |
| `rel-type-coverage-gate.ts --langs=go` | CHECK 1–4 all report **clean**, `0 NEW`, exit 0 — with the caveat in §9 | terminal, scratch root |
| `audit-analyzer-grammar.ts` | **go PASS refs=56 unknown=0 unknownFields=0**; tree exits non-zero on cpp (2), rust (2), sql (1) | terminal |
| `run-fixtures.ts --lang go` | **24 pass / 0 fail**, "all fixtures pass", no baseline regression | terminal |
| `go-incoming-mutants.ts` | baseline 24/0, then **2 mutants, 2 killed, 0 survivors** | terminal |
| `go-payload-latency.ts 400` | 32,519 rels, unfiltered **7,238,323 B**, largest type `calls` 2,602,811 B, **ratio 2.781×** | §9 |
| `go-incoming-resolve.ts --self-test-classifier` | **14 rows, 14 ok, 0 wrong**, exit 0 | `go-incoming-classifier-selftest.json` |
| `go-incoming-resolve.ts --probe-no-regex` | **1,731 lines, 0 findings**; negative control on `firing-check-v2.mjs` → **6 findings** | `go-incoming-noregex-probe.json` |
| `differential.ts --lang go --repo go-stdlib --sample 120` | §9 | terminal only |
| honesty banned-vocabulary lint, over this lane's own artifacts | **0 hits**, measured against the gate's own `BANNED` list | §6.6 |

## 8.1 Fixtures: 24 pass / 0 fail

One new fixture, `go/incoming-resolve-outgoing-only`, all ten types firing in one file.
Its expectation was authored from **live production emission** read back through
`ASTEngine.parseFile`, never predicted — and the first draft FAILED, which is the point of
running it: `{"name":"Describe","kind":"function","ownerName":""}` does not match,
because a package-scope symbol carries no `ownerName` key at all rather than an empty one,
and `matchConstraints` compares with `!==`.

## 8.2 Mutation: 2 mutants, 2 killed, 0 survivors

`validation/m14/go/go-incoming-mutants.ts`. Each anchor is asserted to appear **exactly
once** before it is applied (both measure 1; the endpoint-swap substring inside the second
anchor measures 1) — an anchor that matches twice is a transform that silently stops
meaning what it says.

| mutant | what it does | killed | collateral |
| --- | --- | --- | --- |
| `go/incoming-reverse-edge-added` | re-emits every relationship already pushed with **source and target swapped** | yes | `go/override-promotion` |
| `go/incoming-contains-owner-swapped` | swaps the two endpoints of the ownerName contains pass | yes | 6 fixtures |

**The collateral column is a coverage finding.** The reverse-edge mutant killed exactly
**one** of the 24 pre-existing go fixtures: the other 23 passed with a doubled graph,
because a fixture asserting only `expect` rows cannot see an edge that was never supposed
to exist. Before this commit nothing in the go suite would have failed if the analyzer
had started emitting inbound edges — and the incoming half is exactly the "improvement"
this lane's verdict says must not be made. Reported, not fixed: retro-fitting forbid rows
onto 23 fixtures is separate work and would change fixtures outside this lane's brief.

Also fixed in the harness: `resolve(import.meta.dir, …)` throws `ERR_INVALID_ARG_TYPE`
under tsx, because `import.meta.dir` is a bun extension. The sibling
`script/m14/go-new-mutants.ts` has the one-loader assumption and cannot be started with
`bunx tsx`. MASTER-owned; reported, not changed.

## 8.3 Payload and latency — re-run, nothing added, nothing regressed

`go-payload-latency.ts 400`, production `parseFile`, 400 files / 32,519 relationships /
0 failed.

| | this pass |
| --- | --- |
| unfiltered serialized payload | **7,238,323 B** |
| largest single type (`calls`) | 2,602,811 B (36.0%) |
| **unfiltered ÷ largest single type** | **2.781×** |
| `uses` | 1,805,232 B (24.9%) |
| `references` | 999,461 B (13.8%) |
| `exports` | 936,913 B (12.9%) |
| `contains` | 400,566 B (5.5%) |
| `imports` | 255,319 B (3.5%) |
| `instantiates` | 209,053 B (2.9%) |
| `extends` / `implements` / `overrides` | 16,110 / 12,184 / 683 B (0.2% / 0.2% / 0.0%) |

Two readings, and the second is the one that matters:

- **Nothing regressed because nothing was added.** `git diff 37316589f --
  src/ast/real-go-analyzer.ts` is empty, and the unfiltered figure is byte-identical to
  the 7,238,323 B / 2.781× the lane recorded at `0494a8c54` in the previous round. That is
  a check, not a claim: the same instrument on the same 400-file draw returns the same
  bytes.
- **The ratio is measured against the LARGEST type because that is the most favourable
  denominator.** A caller who narrows to `references` pays 7.2× instead. The honest
  statement is that an un-narrowed query pays for all ten types. 2.781× sits below the
  2.5–4.8× the workstream quotes for lodash and ripgrep at the low end of the range.
- **No budget is declared for this lane.** `validation/m60/analyzer-budget-register.json`
  records go as `unscorable` (severity 5, open: no loadRule, no corpusManifest, no
  loadAvg1, no userCpuMsPerFile), so there is no passing budget for this to regress and
  nothing was re-baselined. That missing budget is pre-existing.
- Four concurrent runs produced **byte-identical per-type byte counts** — a determinism
  check that came free with the re-run.

**The latency figure is not quoted.** Wall time was 264–280 s per file-batch while
`loadavg1` on this box ran 37–90, with eight other lanes measuring at the same time. A
latency number from that box describes the box, not the analyzer, and quoting it would be
the shape of claim this programme has been bitten by repeatedly.

---

---

# 9. Limitations, declared per honesty contract §3

Blank limitations are treated as dishonesty rather than excellence, so these are the
things this pass did not settle.

1. **The leaf reduction's cost is one-sided, and only that side was measured.** The
   analyzer publishes `strings.ToUpper(v)` as `calls transform -> ToUpper`, discarding the
   qualifier. §6.4 measures what that costs **in reverse** — `ToUpper` names three
   declarations — but it does not measure how often the forward direction is wrong, which
   needs type inference this lane did not build. 6,973 names (4.9% of the index) are
   declared in more than one package directory; the fraction of emitted edges whose true
   referent is NOT the package-scope declaration is **not measured here**.
2. **The ambiguity figure is a property of the corpus, and the corpus is a standard
   library.** 61.8% ambiguous against go-stdlib's 57 packages is not a claim about Go
   applications, where a package is far more likely to hold one `Read`. A different corpus
   would move this number and would move it for reasons that have nothing to do with the
   analyzer.
3. **Package-level resolution is out of reach for a per-file analyzer, and `exports`
   proves it.** `exports` reads `package -> Name`; the target resolves and the SOURCE does
   not, because a package name is declared by every file of that package. 33 of 3,732
   edges traversable. A package-scope index would answer it and is not built.
4. **`uses` at 19.2% of anchored targets colliding with a member is a RISK surface, not a
   measured error rate.** The 2,200 edges in that class resolve by Go's scope rule to the
   package-scope anchor; if the true referent was a member, the reverse walk picks the
   wrong one. Measuring how often it actually is a member needs the receiver type at each
   use site, which the emitted edge does not carry.
5. **Grammar-version drift.** The instrument and the analyzer both reference
   tree-sitter-go node types; the grammar audit passes (`go PASS refs=56 unknown=0`) but
   `validation/m14/grammar-pins.json` has no `go` entry, so a wasm swap would be silent.
   This lane's own work found the drift consequence first-hand: `method_elem` is a node
   type from another grammar and cost one whole class before it was caught.
6. **A single long-lived process cannot walk this corpus, and the failure is silent.** The
   oracle audit in 4 shards lost **3 of 4** to `[BB-PARSE-ERR] … memory access out of
   bounds` followed by `[BB-HANG] parser stuck 120s … — exiting`, at a different file each
   time. The guard is a `process.exit` in MASTER-owned `engine.ts`, so a shard that dies
   contributes nothing and a merge would report a smaller number that reads as a finished run.
   Re-run in 24 shards four at a time (~394 files each), **0 hangs in 24**. Measured at
   12 shards all at once: 2 survivors of 12. So **the shard COUNT AND CONCURRENCY are
   both load-bearing**, and the wave runner is committed for exactly that reason.
7. **Latency on this box is not measurable while other lanes measure.** loadavg1 ran
   37–128 during this pass. No user-CPU-per-file figure is quoted.
8. **The four-class classifier reads only declarations.** It does not model Go's
   shadowing, block scope, or dot-imports. A name that is shadowed at the use site still
   reads as resolving to its package-scope declaration, which is correct more often than
   not and wrong in a way this instrument cannot see.
9. **`exports` deliberately excludes capitalized package-scope VARIABLES and METHODS.**
   Pre-existing lane scope (the M49 JVM-closure F3 invariant), pinned as forbidden rows in
   `go/exports-contract`, and unchanged here. `go-oracle-census` measures the excluded
   surface; this pass did not re-measure it.

---

# 10. Found outside this lane — named, not fixed

Every item below is in a file the workstream doc's ownership table puts outside a language
lane. Each carries the evidence that makes it checkable.

1. **`script/m60/rel-type-coverage-gate.ts` CHECK 1 can be satisfied by a DECLARATION
   rather than a RUN.** It reports go clean, but `readOwnOracleLabels` reads
   `GO_ORACLE_LABELS` — a list of strings — from `script/m14/go-truth.ts`. Measured:
   `grep -c go-truth script/m14/differential.ts` = **0**; the `lang === "go"` truth block
   (`differential.ts:22647`) calls six oracles and none of them derives `exports` or
   `overrides`; the compared-label filter (`differential.ts:23396`) still adds only
   `["references","contains","uses","imports"]` over the base four; and `differential.ts:23153`
   still excludes go from the `overrides` disjunct. So the shared harness run compares
   **8 of go's 10** labels while CHECK 1 reports clean. A DERIVATION finding wearing a
   green result: a type can be declared audited and never compared. This is the failure
   `ontology-coverage-gate.ts`'s header exists to prevent, one level down.
2. **`script/m14/go-oracle-audit.ts` produces the ten-label audit that `differential.ts`
   does not, and writes no artifact into `validation/`.** It exists, it imports the six
   `deriveGo*` oracles from `differential.ts` so the normalisation cannot drift, and its
   result for go is 99.732% precision / 99.89% recall over 11,790 files. Wiring two
   `deriveGo*Truth` calls and dropping go from the `overrides` exclusion list is a
   two-line change in a MASTER-owned file.
3. **`script/m14/firing-check-v2.mjs` `resolveLane` cannot select a lane named `…_GO`.**
   It normalises to `INCOMINGRESOLVEGO`; `ALIAS` carries `GO9 -> GO` but no bare
   `GO -> GO`, and step 3 needs a token of length ≥ 3, so the final 2-character `GO`
   token is skipped. The briefed command exits 2 and prints "Known lanes: …", which reads
   as a lane-name mistake rather than a gap in the table. Any lane whose name ends in a
   2-character language token has the same problem.
4. **`script/m14/firing-check-v2.mjs:36` hardcodes `REPO` to the main checkout.** Measured
   today: `diff -rq` over `src/ast` between the main checkout and this worktree is empty,
   and `real-go-analyzer.ts` is byte-identical, so today's number is valid for this tree.
   That is a coincidence of the current commit, not a property of the instrument.
5. **`script/m14/firing-check-v2.mjs` prints only the top eight per-type counts**, so the
   two smallest types — `implements` and `overrides` — appear in no `counts:` line at any
   `NFILES`. Their presence rests on the `(all ten)` marker and the `fired:` list alone.
   `overrides` at 6 edges in 3 files of 1,000 is invisible to it; §4's census is the
   instrument that counts it.
6. **`script/m14/go-new-mutants.ts` cannot be started with `bunx tsx`.** It does
   `resolve(import.meta.dir, …)` and `import.meta.dir` is a bun extension, so under tsx it
   throws `ERR_INVALID_ARG_TYPE` before a single mutant is applied. Its documented
   invocation is `bun run …`, which works; the finding is that a harness with an
   undeclared loader assumption reports nothing at all under the other one.
7. **`script/m60/rel-type-coverage-gate.ts` and the shared differential cannot be run
   against a worktree without a scratch root.** The gate writes
   `validation/m60/results/rel-type-coverage.json`, a MASTER-owned shared artifact, so it
   was run with `BB_M60_ROOT` pointed at a scratch directory holding symlinks to this
   worktree's `src/` and `script/` plus a copy of the baseline. That indirection is a
   workaround for an ownership rule, and it is recorded rather than worked around silently.
8. **`types.ts:69` / `engine.ts:455` no longer disagree.** The previous lane's finding #1
   — two `RelationshipType` enums spelling `Imports` differently — is **CLOSED at HEAD**:
   `src/ast/types.ts:84` reads `Imports = "imports"`, with a 15-line comment recording the
   divergence and the 179-edge measurement that found it. Re-measured rather than inherited:
   `firing-check-v2` prints `in types.ts but NOT produced: (none)` and `produced but NOT in
   types.ts: (none)`. Closed by someone else's commit; recorded so the next reader does not
   re-open it.
9. **Tree-wide, outside this lane:** `audit-analyzer-grammar.ts` exits non-zero on **5
   unregistered type literals** — cpp `class_body` ×2, rust `bare_function_type` and
   `parenthesized_type`, sql `index` — and reports count regressions for cpp, rust and sql.
   `verify-regex-census.ts` is red tree-wide per the lane's own record (24 missing, 25
   stale rows, none in go). Both are MASTER-owned and are named, not touched.
10. **`validation/m14/go/go-corpus-files.ts` has been lost and recovered twice** and is not
    on `origin/main`, while six go lane instruments import it. A sixth instrument was added
    to that list by this lane. Any agent starting a Go lane from main will find six
    instruments that fail to load while their `.json` results sit in the tree claiming
    measurements.

---

# 11. What this lane could not settle, and precisely why

1. **Whether the shared differential's `instantiates` truth or the analyzer is right.**
   661 MISSING rows, 95.22% recall, and the disagreement is a rule disagreement: the shared
   truth derives `instantiates` from a PascalCase callee leaf; this lane's own
   `go-mislabel-probe` independently falsified that rule (8 of 155 edges at confidence 0.6
   named a symbol in a different package). Both sides are right about different languages'
   habits, the adjudication lives in `script/m14/differential.ts`, and I did not make it.
   **Unsettled because the file is MASTER-owned**, and because resolving it means choosing
   which of two measured rules is the family's contract.
2. **Whether the shared differential's `references` truth or the analyzer is right.**
   1,585 EXTRA rows, 95.986% precision. The oracle derives a narrower `references` surface
   than the analyzer emits, both before and after anything this lane did. **Unsettled for
   the same ownership reason**, and the previous generation recorded the same ambiguity.
3. **What fraction of the 2,200 member-colliding anchored targets are actually mis-resolved
   in reverse.** Needs the receiver type at each use site; the emitted edge does not carry
   it, and adding it is a change to what every consumer sees. **Unsettled by scope**, and it
   is the single most valuable number a follow-up could add.
4. **`scripts/m14/go-endpoint-integrity.ts` was not re-run.** Its ladder is superseded for
   the resolution question by §6, which resolves against an independent index and separates
   AMBIGUOUS from UNRESOLVABLE. Running it would have produced a second, weaker number for
   the same question under a contended box. **Not re-run deliberately**, and the
   substitution is stated rather than left implicit.
5. **User-CPU latency per file.** §8.3 states why: loadavg1 37–128. **Unmeasurable on this
   box while eight other lanes are measuring**, not unmeasured by choice.
