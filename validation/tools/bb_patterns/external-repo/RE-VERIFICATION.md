# bb_patterns — re-verification against the landed analyzers

The analyzer work merged as `4900f3e4` (568 commits) while this lane was mid
review. `bb_patterns` reads that index directly, so every decision here had to be
re-made against the new analyzers rather than carried over: **a fix that
compensates for a defect the analyzers have since fixed is now itself a defect**,
because it discards real evidence.

This file is the re-verification ledger. The pre-merge ledger is in
`REVIEW-PLAN.md`.

## 0. Runtime, and the measurement bug that nearly hid a crash

There was no Node or Bun on this machine. Measured matrix, all four cells checked
rather than assumed:

| runtime | `node:sqlite` | `better-sqlite3` (the engine's Node driver) |
| --- | --- | --- |
| v22.14.0 | **SIGKILL** (exit 137) | OK |
| v22.20.0 | **SIGKILL** (exit 137) | OK |
| v24.21.0 | OK | ABI mismatch (NODE_MODULE_VERSION 127) |

`node:sqlite` on Node 22 is killed by the kernel the moment a database is opened,
including `new DatabaseSync(":memory:")`, with no output. The harness uses
`better-sqlite3`, which is also what `src/brain/database.ts` resolves under Node,
so a measurement and the engine share one SQL implementation.

`harness/run-cli.mjs` exists because `src/cli/index.ts:792` guards its entry on
`import.meta.main`, a Bun-only flag. Under Node that module only *defines*
`runCli`, so `tsx src/cli/index.ts index .` exits 0, prints nothing, and writes
no index — a clean-looking result for an empty run.

### The empty-database trap

Two measurements in this lane produced fictional numbers for the same reason: a
probe did `cd "$BB_REPO"; export BB_DATA_DIR="$PWD/_data2_poly"`, so `$PWD` was
evaluated after the `cd`, the path pointed into the shared repository, and
`better-sqlite3` **created an empty database there** rather than failing. Every
query then answered about zero files, and the tool reported a clean project. One
run of `bb_patterns` against that empty database returned **0 candidates on all
eight corpora** and another reported **95% false positives** — both fiction.

Worse, the empty database **masked a hard crash**: `usedIds` was declared below
the loop that fills it, so every call that reached the loop body threw
`ReferenceError: Cannot access 'usedIds' before initialization`. With zero rows the
loop never ran, the throw never happened, and the tool looked healthy.

`harness/corpus-env.sh` now pins `BB_DATA_DIR` by absolute path and
`assert_corpus` refuses to measure a project with zero indexed files. A wrong path
must fail loudly; it must never measure nothing.

## 1. Corpus

Nine repositories re-indexed from scratch with the landed analyzers.

| repo | language | files | symbols | relationships |
| --- | --- | --- | --- | --- |
| backbencher-brain | TypeScript (+md/json/yaml/toml) | 7,384 (see §5) | — | — |
| rake | Ruby | 57 | 786 | 2,403 |
| ripgrep | Rust | 161 | 6,424 | 30,105 |
| lodash | JavaScript | 35 | 553 | 3,442 |
| rebar3 | Erlang | 147 | 3,658 | 24,171 |
| clojure | Clojure | 245 | 10,263 | 44,000+ |
| luarocks | Lua | 241 | 6,905 | 7,175 |
| mojo | Perl | 304 | 5,044 | 4,070 |
| clyde | Python | 117 | 3,146 | 2,121 |

`assert_corpus` is the authority on these numbers at run time; the table is
context, not a claim the harness makes for you.

## 2. What the analyzers now publish, and what it changes

Every relationship row carries `confidence` and a `metadata` JSON blob with an
`evidenceClass`. The pre-merge engine decided on the relationship **type** alone.
The landed index makes the row itself judgeable, and the type is not the deciding
variable:

| type | rows (rake) | self-loop | `inferred` | conf < 0.7 | all-clean |
| --- | --- | --- | --- | --- | --- |
| calls | 732 | 3.7% | 0.0% | 0.0% | **96.3%** |
| contains | 910 | 0.0% | 0.0% | 0.0% | 100.0% |
| uses | 168 | 0.0% | 0.0% | 0.0% | 100.0% |
| references | 2 | 0.0% | **100%** | 0.0% | **0.0%** |
| instantiates | 23 | 0.0% | 0.0% | 0.0% | 100.0% |
| extends | 14 | 0.0% | 0.0% | 0.0% | 100.0% |
| implements | 9 | 0.0% | 0.0% | 0.0% | 100.0% |
| **overrides** | 48 | **87.5%** | **93.8%** | **93.8%** | **2.1%** |

On ripgrep `overrides` is 100% self-loop, 100% inferred, 100% below 0.7, **0%
all-clean**.

`uses` is 98.8% all-clean on ripgrep and **9.2%** on lodash. So does any type's
soundness hold across corpora? No. `overrides` never does, and `uses` is
corpus-dependent — which is the whole argument for gating on the row rather than
on a list of types.

### The concrete defect, read out of rake's own rows

Two rake symbols carried an `overrides` edge to **themselves**:

```
target  test_files=   lib/rake/testtask.rb
source  test_files=   lib/rake/testtask.rb
ext     TaskLib.test_files=
conf    0.5
meta    reasonCode "first-parent-guess", evidenceClass "inferred"
```

`ruby_version` is identical (`TaskLib.ruby_version`). The indexer guessed that a
method overrides its own name in the parent class. The pre-merge engine read that
guess as proof of a consumer, so the symbols never reached the report. Upstream
`60eb13ef` measures the same tier at 65.2% wrong on real Kotlin and states it
"has NO oracle", because a per-file oracle cannot adjudicate a guess that fires
precisely when the declaring ancestor is out of file.

Verified by hand in `lib/rake/testtask.rb`: `test_files=` is defined at line 81
and used at 82, 91, 103, 173; `ruby_version` at 179 is `# :nodoc:`. So the
guess is the *only* thing that was keeping them out of the report, and the guess
is worthless.

## 3. Evidence arrives in two strengths

The share of edges carrying **no source symbol** is a property of the project,
not of the type:

| repo | calls | uses | imports | references |
| --- | --- | --- | --- | --- |
| rake | 2% | 0% | 5% | 97% |
| ripgrep | 2% | 4% | 0% | 0% |
| rebar3 | 0% | 0% | 0% | 0% |
| clojure | 0% | 3% | 0% | 0% |
| lodash | **83%** | 31% | 65% | 61% |
| luarocks | 17% | 14% | **83%** | 13% |

So the engine now has two channels:

- **ID evidence** — an anchored, clean, cross-symbol edge. Decisive.
- **NAME evidence** — the leaf of `target_external`, or the name of an
  unanchored clean row's target. Clears only an **unambiguous** name.
- **Nothing** — a row failing the gate contributes nothing, not even its name.

On lodash the 3,775 unanchored `calls` edges are published as
`{"isFieldAccess":true,"bareRead":true,"evidenceClass":"usage_contextual"}` — a
bare identifier name-matched to a symbol. Treating them as proof of consumption
is what produced a **95.1%** false-positive rate in the pre-merge round.

Rejected rows per corpus: lodash 5,670 · clojure 6,442 · mojo 3,626 · rebar3 1,507
· ripgrep 401 · clyde 479 · rake 76. All reported in
`summary.unverifiedUsageEdges`, by reason and by type, at the index's own values.

## 4. Imports can now be resolved

Attributable `imports` rows, i.e. naming the file that made them:

| corpus | before the analyzer work | after |
| --- | --- | --- |
| ripgrep | 0 of 96 | **96 of 96** |
| rake | 0 of 19 | **18 of 19** |
| clyde | — | 667 of 667 |
| lodash | — | 24 of 69 |
| luarocks | — | 70 of 415 |

With the importer known, a specifier is joined onto its directory and matched
against the real indexed path set, so `./used` from `src/main.ts` clears
`src/used.ts` and nothing else. Root-relative specifiers are also tried, which is
safe precisely because the result must name a path that **exists** in the index —
`node:fs` and `express` match nothing, which is the property the pre-merge flat
stem set lacked and the reason it cleared a local `node.ts` from Node's own
builtins. Unattributable rows fall back to a stem match, only where that stem
names exactly one file, and the fallback count is reported.

## 5. Results, scored against the source text

The index-based oracle used in the pre-merge rounds is **not valid** against the
landed index: it called a candidate a false positive when "something other than
`contains`/`exports` points at its symbol id", and the thing pointing at it is
frequently a self-loop or a 0.5-confidence guess. It graded the engine against a
standard the same review had just rejected, and reported 35–95% rates that were
artifacts of the oracle.

`probe-r5-source-oracle.mjs` scores against the tree: a candidate is contradicted
only when a **uniquely named** symbol is consumed in a consuming position in
another file. Anything weaker is a name collision the instrument cannot
adjudicate — the first version of the oracle counted rake's `initialize`
appearing in 20 of 98 files as usage of every class's `initialize`, and reported
43%. It cannot see reflection, string lookup or template indirection, so **every
rate below is a lower bound**.

| repo | symbol candidates | contradicted | rate | file candidates | rate |
| --- | --- | --- | --- | --- | --- |
| rake | 120 | 15 | 12.5% | 19 | 5.3% |
| ripgrep | 1,835 | 7 | **0.4%** | 53 | 7.5% |
| lodash | 151 | 42 | 27.8% | 24 | 4.2% |
| rebar3 | 824 | 2 | **0.2%** | 67 | 6.0% |
| luarocks | 179 | 1 | 0.6% | 117 | 2.6% |
| mojo | 543 | 11 | 2.0% | 207 | 1.9% |
| clyde | 1,886 | 0 | 0.0% | 41 | 0.0% |

### The residual is an analyzer coverage gap, not a decision error

mojo's contradicted set includes `listen@lib/Mojo/IOLoop/Server.pm`,
`connect@lib/Mojo/IOLoop/Client.pm`, `warn@lib/Mojo/Log.pm`,
`chmod@lib/Mojo/File.pm`. `listen` has **no incoming call edge at all** — its
callers were never recorded — and the only thing hiding it was the self-loop guess
above. Verified in the index, not inferred.

So a finding now **discloses the refused evidence**: every candidate whose symbol
had rows rejected by the gate carries a `REFUSED EVIDENCE` entry naming the
reasons, and a limitation saying that if the analyzer missed a real caller, this
is a coverage gap rather than dead code. The tool stops papering over the gap and
starts naming it. That is the honest resolution available from this side; closing
the coverage gap is the analyzer lane's work.

## 6. Carried over unchanged, re-confirmed

These were decided on the pre-merge index and re-measured on the new one. The
evidence for each is in `REVIEW-PLAN.md` §2; all still hold.

- `referencedFiles` is built from **all** symbol types. six-type map sees 32
  files on rake, all-type sees 37; on ripgrep 67 vs 80.
- Non-code languages contribute no symbol candidates: still 21.0% of rake's
  reportable pool, 8.5% of ripgrep's.
- `overrides` is in the type set but gated by evidence, so it contributes only
  its 2.1%/0% clean rows.
- The god-class statement is a correlated `COUNT(*)` over the owner index.

## 7. Blockers found outside this lane

Neither is a `bb_patterns` change. Both block work and are recorded rather than
silently worked around.

### 7a. `bb index` cannot complete on a large repository — unhandled EPIPE

`src/ast/parallel-indexer.ts:1335` (`createWorker`) calls `worker.send(...)` on a
worker that has already exited. When a batch times out, the batch is removed from
`pendingBatches` and the worker is killed, but the drain loop keeps a handle on it;
the next `send` to the dead handle throws `EPIPE`, and because it surfaces as an
unhandled `'error'` event on the `ChildProcess`, the whole index process exits
non-zero and the in-flight batch is lost.

Measured on this repository: the index reached 1,361/7,354 files and died; on
`--resume`, 1,777 and died; then 1,839, then 2,108. The trigger is a large JSON
file — `reviews/merge/2026-09-25-main-into-recovery-identity-census.json`,
`script/m14/spec/powershell-completeness.json`,
`validation/m60/script-surface-baseline.json` — where one worker exceeds its
timeout, kills the batch, and then takes the parent with it. Resuming makes
progress, so the checkpoint is intact, but at ~0.1 files/s after the first
crash the remaining 5,200 files would take about 14 hours.

The fix is a liveness check before `send`, or draining a dead worker out of the
schedule that still holds its handle. It is a handful of lines and it unblocks
indexing for the whole project, including the analyzer work this lane depends on.

### 7b. The upstream merge left duplicate declarations in four files

`git merge origin/main` (4900f3e4) concatenated duplicated blocks:

- `src/intelligence/analysis/dependencies.ts` — `MAX_ROW_ENTRIES` declared 3×
- `src/intelligence/testing/test-intel.ts` — `DEFAULT_PAGE` 2×, `DEFAULT_MAX_LINKS` 3×
- `src/intelligence/graph/graph-engine.ts` — `edgesByType` 2×
- `src/lsp/graph_request.ts` — `TestMappingEntry` shape mismatch

`tsc --noEmit` reports 8 errors from these, and **`tsup` fails outright** — which
means `bin/bb` cannot be built, so every gate that shells out to the compiled CLI
fails. `m13/verify-patterns-contract` failed for exactly this reason until another
agent finished their in-progress edit. This lane's own files are clean under
`tsc`; the errors are all in the four files above.

## 8. Provenance: this lane's work is split across other lanes' commits

Two commits by other agents swept up `bb_patterns` changes with a broad `git add`:

| content | commit | author |
| --- | --- | --- |
| `src/mcp/tool-handlers.ts`, `src/mcp/tool-registry.ts` | `b604038b` | bb_search lane |
| orphan engine, rules, `ast/tools.ts`, `analysis-exclusions.ts`, the two m20 verifiers, `docs/tools/bb_patterns.md` | `29b4ad05` | bb_doc lane |

History was not rewritten to tidy it, because other agents are committing into
this branch continuously and a rebase would destroy their work. The content is
intact and verified; only the attribution is wrong. Worth a lane rule about
`git add` scope before the next merge.

## 9. Probes

| probe | question |
| --- | --- |
| `probe-r1-reverify.mjs` | re-ask every decision against a fresh index, with a verdict per question |
| `probe-r2-overrides-truth.mjs` | adjudicate `overrides` edges against the **source text**, not the index |
| `probe-r3-evidence-quality.mjs` | is "this edge is evidence of a consumer" decidable from the row? |
| `probe-r4-after-gate.ts` | the engine's own numbers, including what the handler prints |
| `probe-r5-source-oracle.mjs` | score the engine against the tree |
| `probe-p0..p12` | the pre-merge measurement battery, kept for the before/after diff |

## 10. The disclosure, and where it must not fire

`bb_patterns` reports `Rake::TestTask`, `Rake::FileCreationTask` and
`Rake::EarlyTime` as dead. The tree settles all three:

```
lib/rake.rb:51          require_relative "rake/file_creation_task"
lib/rake.rb:57          require_relative "rake/early_time"
dsl_definition.rb:83    Rake::FileCreationTask.define_task(*args, &block)
```

`EarlyTime` — all 7 occurrences are inside its own file; it is genuinely alone,
so reporting it is correct. The other two are real false positives, and the
index records nothing about them.

The first disclosure only fired for a symbol that had rows and had all of them
refused. `TestTask` and `FileCreationTask` have **no rows at all**, so nothing
fired and both read as confident dead-code findings.

The decidable signal is an asymmetry between the symbol and its file:

| file | incoming usage rows | the symbol itself |
| --- | --- | --- |
| `lib/rake/testtask.rb` | 21, from 11 sources | `TestTask` has 0 |
| `lib/rake/file_creation_task.rb` | 2, **both `overrides` self-loops** on `needed?`/`timestamp` | `FileCreationTask` has 0 |
| `lib/rake/early_time.rb` | 0, from 0 | `EarlyTime` has 0 |

A candidate in that state now carries a `COVERAGE GAP INDICATOR` naming the
file's own numbers, plus a limitation saying the absence of evidence is probably
the analyzer's rather than the code's.

Two things the obvious implementation gets wrong, both of which
`probe-r6-disclosure.ts` asserts:

- **The indicator is asymmetry, not suspicion.** `FileCreationTask` gets **no**
  disclaimer: its file's only two rows are self-loops, so symbol and file are
  equally unreferenced and there is nothing to disclose beyond the standing
  limitations. A caveat that fires everywhere is a caveat nobody reads.
  `EarlyTime` is the control for the same property.
- **`contains` and `exports` are not "incoming" here.** Counting them made
  `TestTask` look referenced, because its own module offers it via `exports` —
  which is the definition of a declaration nobody called.

`probe-r6-disclosure.ts`: 18 checks, PASS on rake.
