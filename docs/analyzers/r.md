# R lane — `r` (engine language id) / `R_LANG` (firing-check name)

Lane owner: **r-lane**. Corpus: 2,184 git-tracked `.R` files across 16 repositories
(ggplot2=360 r-testthat=266 dplyr=195 usethis=184 r-vctrs=181 r-cli=171 r-rlang=160 r-pkgdown=135
r-Rcpp=116 r-scales=95 r-air=87 Matrix=80 S7=61 r-withr=58 R6=27 nvim-treesitter=8), rooted at
`$HOME/fixtures/repositories`. Corpus file-set sha256 `953c0314…` (2,184 paths, sorted).

**Every figure on this page declares its `degraded` count**, per HANDOFF §5.1. A degraded parse is
a regex fallback: it does not fail, it returns fewer edges with no error, so a figure without a
`degraded` count is not a smaller figure — it is an unlabelled one.

---

## 1. HANDOFF §5.1 — `[BB-HANG] parser stuck 120s on ggplot2/R/scale-hue.R`

**VERDICT: REFUTED as a hang.** Nothing hung. `scale-hue.R` made tree-sitter-r trap
(`memory access out of bounds`), the trap propagated out of `engine.parseRaw`, and the
self-destruct timer armed around that parse was left ARMED because its `clearTimeout` sat on the
line after the parse. 120 s later the orphaned guard fired in an unrelated turn of the event loop,
named the last file whose parse had thrown, and called `process.exit(1)` — after the walk's own
summary had already been printed. That is fixed in `src/ast/engine.ts` since `8f0e0c930`
(2026-10-07 03:03:38, "disarm the parse bomb on the throw path, and reuse the grammar"); the
disarm now sits in `finally` (`src/ast/engine.ts:1690-1694`).

### 1.1 The two artifacts the handoff quotes, read exactly

| artifact | wall clock | counter predicate | read | `[BB-PARSE-ERR]` traps in the same file |
|---|---|---|---|---|
| `r-ambiguity-split.txt` | 2026-10-05 11:18 | `r.fallback === true` (sound) | `degraded 0` | 0 |
| `r-ambiguity-attribution.txt` | 2026-10-05 12:33 | `r.fallback === true` (sound) | `degraded 2` | 2 (`scale-hue.R`, `r-cli/R/unicode.R`) |
| `r-b-pair-verify.txt` | 2026-10-05 14:13 | `r?.metadata?.degraded \|\| r?.degraded` (**dead**) | `degraded 0` | **1** (`scale-hue.R`) |

Both artifacts carry the **same analyzer sha256** `ecb02eecda7bf54b3996b55a2a6e10d054edd95cdc1c72a73b9d96d82175ea4e`
and the **same corpus file-set sha256** `953c0314…`. So `degraded 2` vs `degraded 0` is not a
difference in the analyzer and not a difference in the population: it is **nondeterminism in the
parse**, 91 minutes apart, with the trap rate low enough to read 0 in one whole-corpus walk and 2 in
the next.

### 1.2 The disagreement has TWO causes, and the second one is this lane's own defect

1. **The trap is intermittent.** Pooled over the three 2,184-file walks above: **3 traps in 6,552
   parses** (4.58e-4). Two runs at identical analyzer and corpus shas cannot disagree otherwise.
2. **One of the two counters cannot fire.** `r-b-pair-verify.ts:104` counted
   `r?.metadata?.degraded || r?.degraded`. Production sets **neither**: `extractFallback`
   (`src/ast/pool-worker.ts:457`) and the >5 MB early return (`src/ast/pool-worker.ts:931`) both
   report a degraded parse as `fallback: true`, and no analyzer sets a `degraded` key anywhere. The
   predicate is a constant `undefined`, so that artifact's `degraded 0` is not a clean walk — its
   own log opens with a trap on `scale-hue.R` and then reports 0.

   **Fixed** in this lane (`r-b-pair-verify.ts:104` now uses the `fallback` predicate).

   The counter was not taken on faith. `validation/m14/fixtures/r/probe-degraded-counter.ts` runs
   BOTH predicates against REAL production fallback objects obtained without a WASM trap — A: an
   unsupported extension, which reaches the catch and `return extractFallback(...)` at
   `pool-worker.ts:1443`, the **same return statement a trap reaches**; B: a >5 MB `.R` file, the
   early return. Both objects carry `fallback: true`, `degraded: undefined`, `metadata: undefined`.
   The sound predicate reads **DEGRADED**; the dead one reads **clean**. Raw:
   `validation/m14/fixtures/r/probe-degraded-counter.txt`.

### 1.3 The mechanism, proven by a three-arm control that can fail

`validation/m14/fixtures/r/probe-hang-mechanism.ts` (raw: `probe-hang-mechanism.txt`) reproduces
both engine shapes in child processes with a 400 ms bomb:

| arm | shape | predict | observed |
|---|---|---|---|
| A | pre-`8f0e0c930`: disarm on the line AFTER the parse, parse THROWS | leak | exit 1, `[BB-HANG]` printed **after** the summary, wall 454 ms |
| B | same shape, parse SUCCEEDS | clean | exit 0, no `[BB-HANG]`, wall 66 ms |
| C | current: disarm in `finally`, parse THROWS | clean | exit 0, no `[BB-HANG]`, wall 73 ms |

Arm B is the control for A: without it, A's exit 1 could be explained by "a bomb always fires"
instead of "a THROW skips the disarm". Arm C is the claim about the tree as checked out.

### 1.4 The live reading today — and what it does NOT settle

`validation/m14/fixtures/r/probe-hang-live.ts` walks a stated population through the PRODUCTION
`parseFile` (the same function that arms `engine.ts`'s bomb in-process), then schedules nothing, so a
leaked guard would keep the process alive and exit 1 ~120 s later. Raw outputs:
`probe-hang-live.txt`, `probe-hang-poison.txt`, `probe-hang-conc4-and-unicode.txt`.

| run | population | parses | 1-min load | degraded | traps | exit | post-walk drain |
|---|---|---|---|---|---|---|---|
| ggplot2, 2 workers | 360 `.R` (whole, no stride) | 360 | 12.28 | **0** | 0 | 0 | 3,338 ms |
| ggplot2, 4 workers (the Oct-5 shape) | 360 `.R` | 360 | 9.74 | **0** | 0 | 0 | 3,891 ms |
| `ggplot2/R/scale-hue.R` ×30 | 1 file, sha256 `9c524ebf…` | 30 | 9.75 | **0** | 0 | 0 | 9,189 ms |
| `r-cli/R/unicode.R` ×30 | 1 file, sha256 `cf8dccd2…` | 30 | 12.34 | **0** | 0 | 0 | 9,504 ms |

A drain shorter than 120 s with exit 0 is the leak test: it cannot be satisfied if a bomb is pending.

**What is NOT established:** the trap was NOT reproduced today, and 780 clean parses do not retire
it. At the Oct-5 pooled rate (4.58e-4) today's 780 parses had only a **~30 %** chance of showing one;
seeing at least one with 95 % confidence needs ≈ **6,550** parses. The zero bounds the rate, it does
not prove absence. The trap is real — it is in `r-b-pair-verify.txt`'s own first line.

**Candidate cause of the trap, stated as a hypothesis and not as a measurement:** on 2026-10-05 a
2,184-file walk logged ~10 `language parser loaded` lines, because the once-per-500-files parser
recreation also dropped and RELOADED the grammar; `8f0e0c930`'s body measures each `Language.load`
of a grammar at ~2.4 MB of RSS that web-tree-sitter 0.25.9 never returns (no `Language.delete`), so
the mitigation whose comment reads "prevents WASM memory accumulation" was itself accumulating. A
WASM linear-memory exhaustion on an 8-core laptop shared by 20+ agents is exactly the shape that
traps intermittently and names a different innocent file each run. Today the same walk logs ONE
`language grammar allocated` for 360 files. The reload storm is gone; whether the trap is gone for
the same reason is **not** proven by that correlation.

### 1.5 Consequence for every other R figure

The hang did not abandon a measurement — the walk finished and its summary printed. What the leak
did was **overwrite the process's exit code after the summary**, so a consumer reading only the exit
code saw a failure on a walk that had completed (`probe-gate-exit-code.ts` measured the same
mechanism on the gate's exit code on 2026-10-05). The correct reading of the Oct-5 artifacts is:
their numbers are usable, their `degraded` counts must be read from the counter that can fire, and
their exit codes cannot be trusted.

**HANDOFF §5.1 is out of this lane's write scope** and still carries the open item; the Lead owns
that file. The material needed to close it is this section.

---

## 2. Coverage declaration — `10/10`, declared from a whole-corpus measurement

DECLARED. `script/m14/spec/r-completeness.json` carries a `coverage` block with all ten types in
`implemented`, no exclusions and nothing corpus-unexercised, so the board reads
`r 10/10 from=spec coverage block` and the invariant closes (`10 + 0 + 0 === 10 − 0 − 0`).

The two types the 120-file instrument reads SILENT are the whole reason the block exists, and each
is substantiated by a whole-corpus count rather than by the instrument's zero:

| type | whole-corpus emission | files |
|---|---|---|
| `overrides` | 95 edges | 8 |
| `instantiates` | 3 edges | 2 |

Population: the lane's declared corpus — 2,184 git-tracked `.R` files over 16 repositories
(`sha256 953c0314…`), **degraded 0**, parse failures 0, `[BB-PARSE-ERR]` traps 0.
Artifact: `validation/m14/fixtures/r/measurements/r-census-overrides-instantiates.current.txt`.

Neither exclusion class was available, and the spec states which measurement refuses each:
`grammar-absence` is refuted by emission (R expresses both constructs and this analyzer resolves
both — the fixtures below pin the edges), and `zero-sites` is refuted for THIS lane's corpus. The
0x reading holds only for the instrument's single-repo sample: `firing-check.mjs` pins one
repository per lane (ggplot2, 360 of the lane's 2,184 files). The full rationale, per-type counts
for all ten types, and the scope argument are in the spec's `_from` / `_implemented_measured`.

---

## 3. The canonical fixture gate — 22/22, and the four failures were a DIALECT

The shared gate now runs this lane: `--lang r` used to discover **zero** of the 22 fixtures, because
`LANGS.r.ext` is `"r"` and the filter was case-sensitive against `*.R` — a lane with no fixtures run
and a lane whose fixtures all pass printed the same line (`fceae35d3`). With that fixed the lane read
**18 pass / 4 FAIL**: F12-edges, F18-direction-and-s7, F21-namespace-depends-on,
F22-redeclared-class-name.

**All four were one defect, and it was not the overrides bound.** 16 rows across those four fixtures
carried `"meta": { … }`. The canonical matcher resolves `meta.<key>` dot-paths against
`actual.metadata[key]` and has no branch for a bare `meta` OBJECT, so the row falls through to
`actual["meta"] !== v` — no relationship has a top-level `meta` field, so the row is
**unsatisfiable** and is reported as an `inert assertion` *and* as `expected relationship not found`.
Every "not found" line in the four failures was exactly one of those 16 rows.

Translating all 38 constraints to `meta.<key>` dot-paths took the gate to **22 pass / 0 fail** with
**no analyzer change**. That refutes the natural reading of those failures — the one that says the
recorded bound arrived as a failing test. The bound is real and recorded (62 bases declined by the
file-scoped `overrides` pass, in the census artifact), but it is not what these four fixtures were
reporting: the edges they expect ARE emitted, and the rows could not be found.

Cause of the dialect: `validation/m14/fixtures/r/run-r-fixtures.ts` — this lane's own runner —
documented `meta.<key>` in its header and implemented the legacy bare `meta` object, so the fixtures
were written against the implementation. It now accepts BOTH, preferring the canonical form, and the
fixtures use only the canonical form.

**CONTROL (the matcher is not vacuous):** mutating one row — the dplyr `references` row demanding
`meta.accessOperator: ":::"` where the source writes `::` — fails **both** runners on the same row
for the same reason (`0 passed, 1 failed` in the lane runner; `21 pass / 1 fail` in the canonical
gate), and restoring it returns both to green.

Artifacts: `measurements/r-fixtures-canonical-gate.txt`, `measurements/r-fixtures-lane-runner.txt`.
