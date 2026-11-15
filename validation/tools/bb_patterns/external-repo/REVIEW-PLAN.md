# bb_patterns — deep review plan and evidence ledger

Lane owner: this agent. Scope: `bb_patterns` only.
Corpus: `/Users/sano/Documents/Default Project/ishaq/bb_tests` (harness, probes,
corpus results). Engine changes are committed to `backbencher-brain` on `main`,
paths named per finding so concurrent lanes are unaffected.

## 0. Runtime, and why a harness had to be built first

There was no Node or Bun on this machine. Measured matrix (all four cells
verified, not assumed):

| runtime | `node:sqlite` | `better-sqlite3` (the engine's Node driver) |
| --- | --- | --- |
| v22.14.0 | **SIGKILL** (exit 137) | OK |
| v22.20.0 | **SIGKILL** (exit 137) | OK |
| v24.21.0 | OK | ABI mismatch (prebuilt is NODE_MODULE_VERSION 127) |

`node:sqlite` on Node 22 is killed by the kernel the moment a database is
opened — including `new DatabaseSync(":memory:")` — with no output at all. Any
corpus harness built on it dies silently and looks like a clean run. The
harness therefore uses `better-sqlite3`, which is also what
`src/brain/database.ts` resolves under Node, so a measurement and the engine
share one SQL implementation.

`bb_tests/harness/run-cli.mjs` exists because `src/cli/index.ts:792` guards its
direct entry with `import.meta.main`, which is Bun-only. Under Node that module
only *defines* `runCli`, so `tsx src/cli/index.ts index .` exits 0, prints
nothing, and writes no index. Every "it already works" claim that ran that way
was measuring an empty run.

## 1. Corpus

Real index, 1,654 files / 45,018 symbols / 160,126 relationships, reused from a
concurrent lane's `BB_DATA_DIR` and copied so this lane owns its bytes.

```
projectId 818db37d8f54173ad1357ab24627373da2e9418c   (sha1 of the repo realpath)
languages  typescript 1071, markdown 447, json 80, javascript 38, lua 4,
           bash 3, c 3, toml 3, yaml 3, python 2
```

Caveat recorded honestly: this index covers 1,654 files while the tree holds
5,953 paths. The shortfall is exclusion by `analysis-exclusions` plus whatever
slice the indexing agent completed. Every number below is labelled with the
index it came from, and no claim is scaled from it to a 5,953-file tree.

## 2. Findings, each with the number that proves it

### F1 — the default page is a garbage collection, not the dead code
`detectOrphans(minConfidence 0.6, maxResults 100)` on the real index returns
**100 findings, all `orphaned_class`, all YAML mapping keys and Markdown
headings, and 0 under `src/`.**

```
page rule mix        {"orphaned_class":100}
page extension mix   {".yml":59, ".json":2, ".md":39}
page top-level dirs  {".github":59, ".vscode":2, "AGENTS.md":1, "docs":38}
page under src/      0
sample               orphaned_class pull_request  .github/workflows/ci.yml:6
                     orphaned_class jobs          .github/workflows/ci.yml:9
                     orphaned_class item_0        .github/workflows/ci.yml:17
```

Cause: `orphans.ts:191` stamps every symbol candidate 0.6, so
`orphans.ts:235` (`b.conf - a.conf || a.file.localeCompare(b.file)`) degenerates
to pure alphabetical path order. The page is the top of the alphabet.
`p0` probe: `bb_tests/bb_patterns/probes/probe-p0-baseline.ts`.

### F2 — `orphaned_file` is unreachable at the shipped default, twice over
Census at `minConfidence 0` is `{"orphaned_class":2902, "orphaned_function":907,
"orphaned_file":1264}` = 5,073. At the default `confidenceThreshold: 0.6`
(`tool-handlers.ts:650`, `:662`) the file count is **0** — `orphans.ts:229` gives
files 0.5 and `:230` drops anything below the threshold at candidate-build time.
And even at `minConfidence 0` the 100-row page contains **0** file findings,
because 3,809 symbol candidates at 0.6 all sort ahead of 1,264 files at 0.5.
The user cannot reach this rule without knowing two undocumented incantations.

### F3 — 76.7% of cross-file usage evidence is thrown away before it is read
`orphans.ts:74-80` loads only six symbol types; `orphans.ts:99` keys the file map
on that subset; `orphans.ts:106-107` looks up **both** endpoints in it. So an
edge is invisible unless both ends are one of the six. Measured over the 46,730
resolved cross-file usage edges:

```
edges usable by the 6-type engine  : 10,895
edges INVISIBLE                    : 35,835   (76.7%)
  target is a constant   9,686 | property 9,065 | variable 2,570
  target is a type         429 | enum_member 188
  ...and 13,857 more whose SOURCE end is a constant/property, e.g.
     7,235 function + 5,197 method + 1,232 interface + 217 class edges
```
A module-level `const x = helper()` or a class field initialiser is the most
common shape in TypeScript, and it is the shape the engine cannot see.

### F4 — 14.4% of `orphaned_file` findings are false positives, measured
Oracle: the identical cross-file-usage question asked over *every* symbol type.
Files the engine reports orphaned that the oracle says have a real incoming
cross-file edge: **181 of 1,259 (14.4%)**. Named, real, live files:

```
script/verify-doc.ts            script/dead-scan.mjs
script/verify-analysis-governance.ts   script/gen-fp-observed.ts
script/test-stale-handle.ts     docs/TOOLS_OVERVIEW.md
build-shims/bun-sqlite-stub.ts  plans/M14-issues.json
```
Distribution: `script` 166, `docs` 5, `validation` 2, `plans` 2, `grammars` 3,
`src` 1, `ide` 1, `build-shims` 1. `probe-p2-orphan-file-truth.mjs`.

### F5 — the other direction is wrong too: documentation is reported as dead code
The 1,078 "true" orphans are led by `README.md`, `CHANGELOG.md`,
`docs/BB_PATTERNS.md`, `docs/ARCHITECTURE.md`, `SESSION-HANDOFF.md`,
`EMBEDDINGS.md`. `md` is not in `NOISE_DIR_SEGMENTS` and is not in
`NOISE_FILE_PATTERNS` (`analysis-exclusions.ts:7-40`), so prose is scanned for
orphan symbols and reported. A user asking "what is dead code here?" is told
its README is dead.

### F6 — `importedPathTails` mislabels 313 of 1,654 files (19%)
Transcribed from `orphans.ts:207-217` and measured on the real index: 3,554
`imports` rows collapse to 292 distinct stems, and **313 files** have their
orphan verdict suppressed by a bare stem collision. `node:fs`/`node:path`/
`node:crypto` builtins alone produce the stem `"node"` **1,158 times**, so a
local `node.ts` is "imported" by the runtime itself. The collision list is
mostly Markdown: `docs/analyzers/real-bash-analyzer.md` is suppressed because
`real-bash-analyzer.ts` is imported. `probe-p1-import-tail.mjs`.

### F7 — `RuleOptions.maxResults` is dead, and the rules threshold is inverted
`rules.ts:24` declares `maxResults`; it is passed at `tools.ts:154` and read
nowhere. The three rule queries and the framework loop are unbounded.
`rules.ts:46` compares `complexity / 15` — but the SQL at `:42` already
guarantees `complexity >= 15`, so the ratio is always ≥ 1.0 and the check can
never fire for any legal threshold. `rules.ts:99` compares `members / 20` with
`members > 10` guaranteed, so at the default 0.6 an **11-member** class is
dropped while a 0.65-confidence complexity finding is kept. The filter is not a
confidence filter; it is a ratio on two unrelated scales.

### F8 — `totalFound` is the page length, printed under the words "N found"
`tools.ts:182` sets `totalFound = displayedPatterns.length` while `byType`,
`bySeverity` and `averageConfidence` (`:183-185`) describe the unbounded census.
`tool-handlers.ts:692` prints that page length as `patterns (N)`. With the
default `limit: 20` the tool fetches 100, prints 20, and reports the 100. The
census (`scan.findingsBeforeDisplayLimit`) is never printed. Measured:
`scan.candidatesEvaluated` 4,678 against a printed 100.

### F9 — `recordRun` persists a page, not the analysed set
`tool-handlers.ts:675-678` and `docs/BB_PATTERNS.md:92-97` both promise the full
analysed set. Since M57.T3 bounded the page inside `detectPatterns`,
`allPatterns` at `:665` is `min(census, max(limit,100))`. The auto-resolve pass
will mark every finding past that page as resolved on the next run — the exact
failure the comment says it prevents.

### F10 — fabricated metrics on every file finding
`orphans.ts:141-146` emits `location.line = 1` and `linesOfCode = 0` for a file
of any size, while `brain_file.line_count` is in the row the query already
selects' table and is used elsewhere (`analysis/project-stats.ts:23`).
`docs/BB_PATTERNS.md:19` promises "exact indexed span, never an invented
average", and `:54` lists invented sizes as a fixed bug. `0` here means
"unknown" but reads as "empty". Verified on all 15 file findings printed.

### F11 — `scannedFiles` under-reports its own scope
`orphans.ts:111-113` counts distinct files among the six-type symbols (1,400)
while the file branch at `:199-201` iterates all 1,654 `brain_file` rows.

## 3. Test-suite gaps (from the coverage inventory)

- No test anywhere runs `bb_patterns` **through the handler or a transport**
  against a repo larger than a handful of files. Every large-corpus run calls
  the engine directly.
- `ENTRY_POINT_SUFFIXES` (`Handler`, `Controller`, `Route`, `Command`, `Plugin`)
  is untested in both directions. So is the file-level `["index","main","app","mod"]`
  skip.
- `orphaned_file` `line_count`, and the `minConfidence` 0.5/0.6 boundary, are
  never asserted.
- `rules.ts` has no mutation test; `orphans.ts` has exactly one.
- `validation/m20/results/P1..P3.json` declare `"negativeCases": 1` while
  containing no negative assertion, and all three share one
  `sourceFingerprint`, so the seal does not scope per-file.
- `validation/m13/results/p4.json` is `known-gap` (its corpus path
  `/home/ishaq2321/bb_tests/repositories` does not exist here) while
  `verify-patterns-docs.ts` asserts it is `verified`.

## 4. Todos

- [x] T0 Install a runtime, prove which driver works, build a Node-native CLI
      entry, copy a real index, get direct SQL.
- [x] T1 Baseline what `bb_patterns` actually returns on the real index.
- [x] T2 Verify the file-level evidence model independently (F3, F4, F5, F6).
- [ ] T3 Fix F1/F2: make the page a ranking, and make every rule reachable at
      the default. Non-code files excluded from symbol orphans; a real severity
      or "evidence" ordering so the page is the worst first, not the alpha-first.
- [ ] T4 Fix F3/F4: `referencedFiles` over all symbol types; one end of an
      edge must qualify, and the evidence should be counted in the finding.
- [ ] T5 Fix F6: replace stem matching with a resolved, path-aware import
      comparison; keep the heuristic only as a declared limitation.
- [ ] T6 Fix F7: give `detectIndexRules` a real bound, and filter on the
      confidence the finding actually carries.
- [ ] T7 Fix F8/F9: one honest count in the header, the census printed, and
      `recordRun` persisting what it claims to persist.
- [ ] T8 Fix F10/F11: stop fabricating line/lineCount; report the real scope.
- [ ] T9 Corpus suite: a per-finding oracle over the real index, a
      handler-path lane, cross-language, and mutation coverage for `rules.ts`.
- [ ] T10 Update `docs/BB_PATTERNS.md` and `docs/tools/bb_patterns.md` so no
      sentence describes behavior the tool no longer has.
