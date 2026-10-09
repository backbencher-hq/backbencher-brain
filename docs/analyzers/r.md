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

## 2. Coverage declaration

Not yet declared. `script/m14/spec/r-completeness.json` still carries an explicit placeholder —
`coverageDeclared=false`, `r 8/10 from=firing-log`. The silent types are `overrides` and
`instantiates`; both need a corpus measurement before either is ruled or called a gap, because R's
S4/R5/R6/S7 systems express both as ordinary calls, so `grammar-absence` is not available by
intuition and must be shown by a grammar inventory or refused.
