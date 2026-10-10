# JSON Analyzer — lane coverage record

The analyzer's ontology history (grammar pin, walk rules, the seven rulings this lane
retracted, the M60 census table) is `docs/analyzers/real-json-analyzer.md`. **This file
is the coverage record the board reads**: what the lane declares, which instrument
measured it, and the reconciliation of the two instruments that disagreed about it.

## The row, and the two numbers it replaced

**The lane's coverage is `9/10`** — 9 relationship types emitted, 10 applicable, with
`instantiates` excluded as `zero-sites` and therefore still counted in the denominator.
`script/m14/spec/json-completeness.json` → `coverage` is the declaration; the board
(`bun script/m14/language-board.ts --coverage`) prints `json 9/10 from=spec coverage block`.

Why it moved, in one line each, for anyone who meets the old numbers first:
`8/8` (the previous row) excluded `implements` as grammar-absence — it is **emitted**,
113 edges over 1 file, so the numerator and the denominator both gain one; `1/10` (the
firing log) is a **true statement about 120 files** in one repo, not about json. The two
old numbers below are kept because they are what the disagreement was about:

| instrument | population | what it read (BEFORE the 2026-10-09 correction) |
| --- | --- | --- |
| `script/m14/firing-check.mjs JSON_B` (the firing log) | ONE repo — `shadcn-svelte`, 2,369 `.json` files — strided to 120 | `JSON_B 1 types fired — contains:2425`, 120/120 parsed, 0 degraded |
| `script/m14/language-board.ts --coverage` (the board) | reads `script/m14/spec/json-completeness.json` → `coverage` | `json 8/8 from=spec coverage block` |

`docs/analyzers/HANDOFF.md` §4's footnote recorded the same pair as "**json 9 emitted vs 1
fired**" and called reconciling them open work. The reconciliation is this file: **both**
numbers were wrong, and each was wrong in the direction that made the other look like the
liar — the log's `1` is a claim about 120 files, and the block's `8` was a stale count that
the lane's own passing fixture had already overtaken.

**If you are reading the spec's prose, read it with this file.** Its historical fields
(`gap._denominator`, `design_decision` BD-ontology and BD-audit-rulings) now say what
changed and bracket the superseded sentences as `SUPERSEDED`; a sentence there that reads
"EIGHT are emitted … TWO are excluded by the language", or "It is 8, not 1, and not 10",
or "json emits 8 of 10", is history, not the declaration. The declaration is the
`coverage` block, and only that block is machine-read.

## 1. The log's `1` — a population artefact, measured on the arbiter instrument itself

Four runs of the same production path (`engine.parseFile`, the instrument's own control
PASSing in each), differing only in which files are admitted:

| population | files | types fired | counts |
| --- | ---: | ---: | --- |
| planted control corpus (`.tmp-json/control-corpus`, all constructs hand-written) | 3 | **9** | contains:76 · implements:3 · extends:2 · exports:2 · references:2 · calls:1 · imports:1 · overrides:1 · uses:1 |
| REAL `shadcn-svelte`, WHOLE repo | 2,369 | **4** | contains:54,575 · uses:339 · references:8 · exports:14 |
| REAL `shadcn-svelte`, the log's 120-file even stride | 120 | **1** | contains:2,425 |
| whole admitted population, all 154 repos (chunked census, §5) | 13,951 | **9** | contains:3,990,897 · references:17,117 · uses:9,955 · extends:1,780 · exports:1,200 · calls:263 · implements:113 · imports:82 · overrides:22 · **instantiates:0** |

`implements` and `instantiates` are silent in the control because the control corpus does
not carry an LSP `mixins` declaration or a construction; the only type silent in a
population that carries every construct is `instantiates`.

Two independent facts follow, and the second is the one that matters:

- **The instrument is not blind to json.** Given a population that carries the
  constructs, it reports 9 of the 10 types — `implements:3` included. So a SILENT column
  over a json corpus is a statement about that corpus.
- **The log's corpus cannot carry them.** Measured over the whole repo: only **25 of
  2,369 files** emit anything besides `contains` (23 `package.json` manifests + 2 JSON
  Schema documents). `shadcn-svelte` is 97.2 % `docs/**` theme/schema data (2,302 files);
  the construct-bearing files are 1.06 % of it and are clustered in the path tail that
  sorts after `docs/`.

Mechanism, measured rather than argued (`.tmp-json/json-stride-overlap.mts`, a verbatim
copy of `firing-check.mjs`'s `pickFiles` — selection only, no parsing):

```
population 2369 · want 120 · stride 19.742 · distinct sampled indices 120 · sampled 120
construct-bearing files in the whole corpus: 25
construct-bearing files INSIDE the 120-file sample: 0
```

23 of the 25 sit at sorted indices 2,302–2,367. The sampled indices are
`floor(i × 19.742)` for `i = 0…119`, so the last one is **2,349** — indices 2,350–2,368
are **unreachable by construction**, not merely unsampled. That is a THIRD mechanism,
distinct from the two already recorded in `firing-check.mjs`'s own header:

- the SQL lane's defect was `return`-on-`want`, a **head-N** walk that measured one
  subtree and called it a language — fixed by striding;
- the markdown lane's defect was `parser.parse` + `analyze` instead of `parseFile`, a
  wrong **code path** — fixed in `f5dec55d3`;
- this one is **stride arithmetic over a clumped population**: `floor(i·N/want)` never
  reaches the tail, and an even stride over the *index* is not an even sample of the
  *construct* when the construct is concentrated in one directory. A 120-file draw from
  this corpus is reproducibly 100 % `contains`, and the row it produces — `1 types fired`
  — is a true statement about 120 files that reads as a false statement about json.

**Verdict on the log:** `1/10` is an artefact of the corpus assignment (one repo, chosen
by "most `.json` files", which for a data-interchange language selects a docs/data dump)
compounded by a stride that sampled **0 of the 25** files in that repo that carry any
other type. Not one of the seven silent types was ruled on by this row.

## 2. The block's `8` — also wrong, and the correction is the larger one

The block excluded `implements` and `instantiates` as `grammar-absence`, so
`applicable = 10 − 2 = 8` and the board read `8/8`. **`implements` is EMITTED**, and has
been since before the block was last touched:

- `validation/m14/fixtures/json/Inherit.lsp.expectation.json` **asserts four `implements`
  edges** (with `meta.reasonCode: declared_interface_mixin`) and **forbids three**, and
  the fixture PASSES: `npx tsx script/m14/run-fixtures.ts --lang json` →
  `{"json":{"pass":17,"fail":0}}`.
- `script/m14/json-ruled.ts` — the lane's ruling table, the one the shared arbiter is
  wired to read — carries **one entry, `instantiates`**. Its header says so in as many
  words: "*`implements` was RULED at pass 1 and is EMITTED now*", and quotes the
  measurement that overturned it — **113 statements in 1 file**
  (`dart-sdk/third_party/pkg/language_server_protocol/lsp_meta_model.json`).
- `docs/analyzers/real-json-analyzer.md`'s M60 census table records
  `implements | EMITTED | 113 | 1`.
- JSON-G1's own overturn condition — "*any emitted `implements` edge*" — has fired.

A ruling with a stated overturn condition, whose condition has been met, that is still
being subtracted from the denominator, is the defect this block was supposed to make
impossible. The stride that measured `implements 0` is the same instrument defect as §1:
one file in ~14,000 carries the construct, so a 400-file stride (2.9 % of the population)
misses it ~97 % of the time — and `_denominator`'s sentence "implements 0 and instantiates
0" is exactly that reading.

**Verdict on the block:** `implements` moves to `implemented`.

## 3. `instantiates` — the exclusion is real, the evidence CLASS was not

`instantiates` stays excluded, but not as `grammar-absence`. It has no emission path in
the analyzer at all, and the lane's own ruling for it (`script/m14/json-ruled.ts`) is
**`B:parse-tree-count`** — a corpus count, not a grammar inventory, and deliberately so,
because "*JSON's grammar has 12 named node types and no node type for a KEYWORD, so it
would have reported RULED-SOUND for any keyword-shaped construct, including the ones that
turned out to exist*". That is the instrument the lane has retracted **six** rulings over
(`imports`, `exports`, `extends`, `calls`, `overrides`, `implements`).

The measurement is a whole-corpus zero, so the programme's class for it is `zero-sites`,
which **STAYS IN the denominator** — a type the language can spell by convention and the
corpus never exercises is not a type the language lacks. Recorded: 0 hits over 13,951
admitted files, with the 23 ungated near-misses (constructor-spelled keys bound to an
object) classified one by one as not-constructing. Taking `grammar-absence` here would
shrink the denominator on the one argument this lane has had to retract six times, and the
board's own rule-book calls a false exclusion "the one error direction that flatters".

## 4. The corrected declaration

`script/m14/spec/json-completeness.json` → `coverage`:

- `implemented` = **9** — calls, uses, contains, imports, references, exports, extends,
  **implements**, overrides;
- `excluded` = **1** — `instantiates`, evidence `zero-sites` (stays in);
- `applicable` = **10**, so the board row is **9/10**, not 8/8 and not 1/10.

Invariant: implemented 9 + corpusUnexercised 0 + gaps 1 (`instantiates`) = 10 = applicable.

`coverage-block-gate.ts --strict` on this block: **no `problems` row**, and every one of the
seven silences is `cited` — so the block neither relies on `unclassified` (which HANDOFF
§5.9 flags as shrinking the denominator without the rule allowing it) nor rests on a claim
with nowhere to read a count from. Nothing in this declaration subtracts a type that no
instrument has measured.

**One stale number lives outside this lane's write scope and is reported, not edited:**
`docs/analyzers/real-json-analyzer.md` (~line 122) still frames the lane as "9 applicable
of 9 (9 emitted, 1 measured-absent)". That is the OLD rule twice over — it counts
`implements` as emitted *and* lets `instantiates` leave the denominator — and under the
corrected block the row is 9 of **10**. `docs/analyzers/HANDOFF.md` §4 line 89 (`json |
8/8 | implements, instantiates (G)`) and `docs/analyzers/LAPTOP-B-STATUS.md` line 63
(`json 9 emitted vs 1 fired`) carry the same old framing. Posted to the Lead 2026-10-09;
those three files are theirs.

## 5. Per-type whole-population counts (the 7 the log reads SILENT)

`npx tsx validation/m14/fixtures/json/census.ts --chunked --limit 0` — production
`parseFile` from `src/ast/pool-worker.ts`, per-repo children, **13,951 of 13,951 admitted
files, 0 excluded, 0 repos without a verdict, 0 parse failures**. Raw aggregate:
`validation/m14/fixtures/json/measurements/json-census-whole-population.jsonl`.

| type | edges | files | verdict |
| --- | ---: | ---: | --- |
| `contains` | 3,990,897 | 13,445 | emitted |
| `references` | 17,117 | 272 | emitted (the log reads SILENT) |
| `uses` | 9,955 | 1,041 | emitted (SILENT) |
| `extends` | 1,780 | 119 | emitted (SILENT) |
| `exports` | 1,200 | 446 | emitted (SILENT) |
| `calls` | 263 | 99 | emitted (SILENT) |
| `implements` | **113** | **1** | emitted (SILENT **and** wrongly excluded — §2) |
| `imports` | 82 | 28 | emitted (SILENT) |
| `overrides` | 22 | 12 | emitted (SILENT) |
| `instantiates` | **0** | 0 | NOT emitted — the lane's only exclusion |

**Seven of the seven declared-implemented types the log reads SILENT fire over the
admitted population**, and the eighth silent type (`implements`) fires too. The 400-file
gate stride that produced `_denominator`'s earlier table printed the same types at 2.9 %
scale (`imports 1`, `overrides 1`, `calls 5`) — those counts were always real, just
sampled.

## 6. Instrument limitations found while measuring this (KILLED runs, not results)

`npx tsx script/m14/incoming-gate.ts --json json json 0` — the whole admitted corpus, the
obvious way to lift the 400-file stride — was **KILLED**: `FATAL ERROR: Ineffective
mark-compacts near heap limit … JavaScript heap out of memory`, 4,022 MB heap, ~4,000 of
14,009 files parsed, exit **134**. The gate pools every symbol of every parsed file in
four maps (127,549 qualified-name aliases at 400 files ⇒ millions at 14,009) and this
lane's population does not fit in the default heap. **It reports no counts and is not used
as one.** Whole-population counting for json goes through the lane's chunked census
(`validation/m14/fixtures/json/census.ts`, bounded per-repo children, production
`parseFile`), which is the instrument every number in `real-json-analyzer.md`'s census
table also came from.

The census itself has two modes and only one of them is safe at this scale: the first
attempt (`census.ts --limit 0`, without `--chunked`) was **aborted by the lane** after 7.5
minutes, because the single-process walk is the one the instrument's own header says dies
at an arbitrary file (`engine.ts:1441` arms a 120-second timer that calls `process.exit(1)`
inside synchronous WASM). The `--chunked` re-run completed 13,951/13,951.

The two populations a reader will meet are not identical and both are declared here:
the **census** admits **13,951** files (size cap 524,288 B), the **gate** admits **14,009**
(size cap 1,048,576 B, 522 tracked-but-absent and 79 over-cap reported separately). The
firing instrument's population is a third, smaller one: **2,369 files in one repo**.

## 6b. The gate the Lead pointed at, before and after

`npx tsx script/m14/coverage-block-gate.ts --strict`, json row:

```
BEFORE  json  yes  8  8  2  calls? uses? imports? references? export -        cited: -   uncited: calls uses imports references exports extends overrides
AFTER   json  yes  9 10  1  calls uses imports references exports ex -        cited: calls uses imports references expo   uncited: -
```

Every one of the seven silences now cites a corpus artifact that exists, so json
contributes no `uncited` entry and no `problems` row. (The gate still exits 2 fleet-wide:
`lua`, `php`, `powershell`, `yaml`, `css` carry uncited silences of their own — not this
lane's.)

The artifacts are stored as `.jsonl` (one JSON value per line) rather than `.json`
**deliberately**: `run-fixtures.ts` treats *every* `.json` under
`validation/m14/fixtures/json/**` as a fixture source and duly reported the two measurement
files as phantom "missing expectation file" rows (`{"json":{"pass":17,"fail":2}}`). With
the extension changed the suite is back to 17/0 — a fixture regression this lane caught in
itself before committing, which is why the extension convention is recorded here rather
than left for the next person to rediscover.

`npx tsx script/m14/incoming-gate.ts --json json json 0` — the whole admitted corpus, the
obvious way to lift the 400-file stride — was **KILLED**: `FATAL ERROR: Ineffective
mark-compacts near heap limit … JavaScript heap out of memory`, 4,022 MB heap, ~4,000 of
14,009 files parsed, exit **134**. The gate pools every symbol of every parsed file in
four maps (127,549 qualified-name aliases at 400 files ⇒ millions at 14,009) and this
lane's population does not fit in the default heap. **It reports no counts and is not used
as one.** Whole-population counting for json goes through the lane's chunked census
(`validation/m14/fixtures/json/census.ts`, bounded per-repo children, production
`parseFile`), which is the instrument every number in `real-json-analyzer.md`'s census
table also came from.

The two populations a reader will meet are not identical and both are declared here:
the **census** admits **13,951** files (size cap 524,288 B), the **gate** admits **14,009**
(size cap 1,048,576 B, 522 tracked-but-absent and 79 over-cap reported separately).

## 7. Fixtures

`npx tsx script/m14/run-fixtures.ts --lang json` → `summary: {"json":{"pass":17,"fail":0}}`,
`fixture baseline gate: no regressions`. Run on the tree this record describes; the
`Inherit.lsp` fixture is the one that pins `implements`.

## 7b. The residual — what is NOT yet real (measured 2026-10-09)

`incoming-gate.ts json json 0` OOMs (§6), so the whole-population residual was measured by
running the gate over **every chunk of the admitted population, one chunk per invocation,
and summing the TOTAL rows** (17 chunks, `--repo=<csv>`, `maxFiles 0`; scratch runner
`.tmp-json/run-chunks.sh`, aggregate `.tmp-json/aggregate.py`). The gate's verdict is
PER PROJECT and each column is exact and additive, so this is the same measurement on
smaller key spaces — not a workaround for the memory limit but the scope the verdict was
always defined over.

**Population: 14,009 admitted files, 154 repos, 17/17 chunks measured, 0 unmeasured.**

| | edges | resolved | amb | unresolved | extFAIL | bindFAIL | causeFAIL | residual |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| whole population, BEFORE this turn's fix | 5,588,463 | 5,588,134 | 41 | 3 | 2 | 0 | 0 | **46** |
| docker alone, before → after the file-claim fix | 8,382 | 8,336 | 0 | 0 | 2 → **0** | 0 | 0 | 2 → 0 |

The remaining 44 by type, each with its count and its named cause:

- **`overrides` 22 amb of 22 edges** — every one of this lane's override edges. The
  analyzer's own measurement (recorded at the emission site) classifies them: 22 of 22
  targets match more than one symbol BY NAME and 14 of 22 BY PATH. Those 14 are the two
  declarations of ONE key sharing a name AND a qualified path — i.e. the two rows are the
  same key in the same object, which the document itself does not distinguish. Whether
  production binds them (a `contains`-shaped resolver preferring the edge's own file and
  line) or they are genuinely unresolvable in the store's key space is the NEXT question,
  and it is a measurement against the store, not an argument. **Not yet ruled.**
- **`contains` 19 amb of 5,546,243** — 19 of 5.5 million, and the same class as the
  overrides shape (a repeated key inside one object). The `containsLike` reclassification
  (`fa2dc27e8`) already moved this type from thousands to 19.
- **`extends` 3 unresolved of 2,981** — target names nothing in the project; classified
  next.

**A discrepancy to record, because two measurements of this lane disagreed and the reason
is an instrument change, not a graph change.** The Lead's chunked reader measured **70**
residual (68 amb + 2 extFAIL) over the 40 repos with ≥50 `.json` files. My run measures
**46** over all 154 repos, a strictly larger population (622,066 more edges). The
difference is commit `fa2dc27e8` — "`contains` was being classified by DECLARATION COUNT;
production binds it with a different statement" — which landed BETWEEN the two runs:
duckdb's 30 ambiguous in the Lead's artifact is mostly `contains`, and the current rule
reads it as 19 across the whole population. **Neither number is wrong; they are different
rules over different populations, and every residual figure in this doc must name both.**

## 7c. The two extFAIL edges, fixed

`docker`'s vendored rekor schema has one `oneOf` with two `$ref`s: `v0.0.1/...` and
`v0.0.2/...`. The vendored copy carries v0.0.2 only. The analyzer attached
`importProjectFile` to both, from path arithmetic alone, and the arbiter — whose file claim
is checked against the project's admitted list and refutes on a miss, by design — refuted
the v0.0.1 pair. **The refutation was correct; the claim was false.**

`real-json-analyzer.ts` now makes the file claim only where the project can confirm it
(`projectCarriesFile`: one `statSync` on `projectRoot/candidate`), and a target the project
does not carry says the true thing instead — `isExternal: true`, which
`verifyExternalClaim`'s `pathLikeTarget` guard reads as unverifiable rather than refutable.
Measured on docker, same population: **extFAIL 2 → 0, extQ 38 → 40, edges 8,382 and
resolved 8,336 unchanged.** Nothing was dropped.

The change can only ever REMOVE a claim (a file that does not exist cannot be claimed), so
it cannot manufacture a refutation the blind claim would not already have earned. Fixtures
17/0 and the zero-regex contract 28/28 both hold; the new check is a `stat`, not a read.
Artifact: `validation/m14/fixtures/json/measurements/json-docker-extfail-before-after.jsonl`.

## 8. Open items

- `JSON-G3` (duplicate identity for a top-level array's second element) and `JSON-G4`
  (`projectFile` claims unverifiable arbiter-side — **now narrowed to genuinely-outside
  targets by §7c**) are unchanged and still open.
- **The `overrides` 22 and the `extends` 3 are the next two causes**, with the counts above.
- **A better file claim than a `stat`**: an exact project file list on the
  `AnalyzeContext` would use the arbiter's own key space (git-tracked, size-capped) instead
  of the on-disk tree. json has no `INDEX_SPECS` entry, so `--index` builds nothing for it,
  and `parallel-indexer.ts:1273` passes only `{ projectRoot }` on the per-file path.
  Reported to the Lead as a shared-file change.
- `firing-check.mjs`'s per-lane corpus assignment and its unreachable tail are **shared
  instrument** defects, not lane-owned: reported to the Lead rather than patched here.
  The same shape is already visible in two other lanes' rows (markdown's `imports` lives
  in traefik/bulma/vega, none in redwood; sql's `contains` was invisible to the head-N
  draw), so the fix belongs in the instrument.
