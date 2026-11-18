# ISSUE-11 — Index caveats: `status=complete` beside `1972/1973 INCOMPLETE`; "24 LESS" errors are 16 `.less` + 8 `.scss`; 42.9% embedding coverage

Lane: `embeddings-health` (owner of verdict)
Adjudication: **PARTIAL** (sub-claims enumerated below; two reproduce literally, one is
`REAL-BUT-MISDESCRIBED` in count/attribution, and the central contradiction is disclosed by the
product rather than silent — but its stored `status` field and its own remedy are wrong)
Severity: **medium** — every caveat is visible to a careful reader (and `[INCOMPLETE_INDEX]` is an
`error`-severity warning), but the index line contradicts itself, the missing file is a *deliberate*
size-tier skip that `force=true` cannot fix, and the embedding coverage number has no
"backfill pending" explanation. A user cannot tell whether to rebuild, ignore, or reconfigure.
Confidence: **high** (health/stats outputs + read-only DB rows + source paths quoted)
Product: HEAD `be4c0ef25`, `node bin/bb --version` = 0.1.6, date 2026-11-18 UTC.
Project: bettercap (`4c7590f1…`), read-only; **not reindexed**; config unchanged.

## 1. Why it matters to a user

`bb health` prints, on one line, counts that say the index is INCOMPLETE and a stored `status` field
that says `complete`:

```
index: version=v1.0.0 indexedFiles=1972/1973 — INCOMPLETE, 1 file(s) found by the walk were never written status=complete errors=0
```

The error line below it is explicit and honest — but it recommends
`Run refresh=true, force=true to rebuild from scratch`, and that cannot fix the shortfall because the
"missing" file is deliberately skipped by the size tier (`>5 MB`), so it will be skipped again on
every rebuild. Meanwhile `42.9%` embedding coverage is printed without saying that the configured
model's coverage is ~0% and that a backfill is pending (ISSUE-09). The "24 LESS syntax errors"
drift also matters: only 16 are `.less`; 8 are `.scss`, a *different* grammar lane with a different
fix.

## 2. Reproduce

```bash
cd /home/ishaq2321/mcp/backbencher-brain
E=docs/bb-bettercap-triage/evidence/embeddings-health
node bin/bb health /home/ishaq2321/bettercap > $E/04-health-plain.txt 2>&1   # exit=1
node bin/bb stats  /home/ishaq2321/bettercap > $E/05-stats.txt 2>&1
DB=/home/ishaq2321/.bb/projects/4c7590f1cba319aac298a50453c0ec440f2dc857/brain.db
sqlite3 -readonly -header "$DB" "SELECT status,total_files,indexed_files,total_symbols,indexing_errors FROM brain_index_status;"
sqlite3 -readonly -header "$DB" "SELECT language,COUNT(*) FROM brain_file WHERE has_syntax_errors=1 GROUP BY language;"
sqlite3 -readonly -header "$DB" "SELECT embedding_model,vector_dimension,COUNT(*) FROM brain_semantic_embedding GROUP BY 1,2;"
```

## 3. Observed (bounded; full outputs in evidence files)

Health (`04-health-plain.txt`, exit code 1):

```
files=1972 symbols=55785 relationships=111408 imports=1948 syntaxErrors=24
embeddings: 23925 rows / 23925 entities / 42.9% of symbols
models: local-word-vectors-v3:23924[50] nvidia/nemotron-3.5-embed-8b:1[4096]
index: version=v1.0.0 indexedFiles=1972/1973 — INCOMPLETE, 1 file(s) found by the walk were never written status=complete errors=0
index run: schemaVersion=1 runs=2 latestWallMs=262910 (the last INDEX RUN, not this call)
warning: [SYNTAX_ERRORS] 24 indexed files have syntax errors: modules/ui/ui/assets/fontawesome/less/_animated.less, …
error: [INCOMPLETE_INDEX] the last index run recorded 1972 of 1973 files as indexed — 1 file(s) were found by the walk but never written, so the index is INCOMPLETE even though the status field says "complete". …
```

`bb stats` (`05-stats.txt`): `files 1972 | symbols 55785 | relationships 111408 | embeddings 23925`.

DB (`07-db-forensics.txt`, all read-only):

```
status=complete  total_files=1973  indexed_files=1972  total_symbols=55785  indexing_errors=[]
performance_stats last run counts: totalFiles=1973 processedFiles=1973 successFiles=1972 skippedFiles=1
                                  errorFiles=0 timeoutFiles=0 parsedFiles=1972
syntax-error files by language: css=16, scss=8
```

The 24 files are all FontAwesome style sheets (`10-less-errors.txt`): 16 of the 18 `.less` files and
8 `.scss` files. The report's "24 LESS syntax errors" is wrong by attribution: **16 LESS + 8 SCSS**.

Embedding coverage arithmetic: 23,924 local + 1 remote = 23,925 distinct entities / 55,785 symbols
= **42.887% → 42.9%** (honest). Configured-model coverage = 1/55,785 ≈ 0.0018% → `0%` when rounded
(see ISSUE-09).

The **one never-written file** is identified by elimination: the walk found 1,973 eligible files,
parsed 1,972 and counted exactly **1 skip**; the only eligible file on disk over the 5 MB
size-tier limit and absent from `brain_file` is `modules/ui/ui/vendor.js` (5,430,946 bytes;
`vendor.js.map` is 5,698,295 bytes but `.map` is not a discovered language). The indexer's size-tier
code skips it deliberately:

`src/ast/parallel-indexer.ts:1005-1013`
```ts
  // SIZE TIER 3: Skip files over 5MB entirely
  if (fileStat.size > STRUCTURAL_LIMIT) {
    log.debug("skipping file over 5MB", { filePath: fullPath, sizeBytes: fileStat.size })
    stats.skippedFiles++
    return
  }
```

## 4. Expected vs observed (contract and honesty)

- **Sub-claim A — "1972/1973 with status=complete"**: literally **REAL**. The health line prints
  both. But it is not a *silent* contradiction: the tool explicitly emits `[INCOMPLETE_INDEX]`
  (`error` severity), names the contradiction in words ("even though the status field says
  \"complete\""), and returns exit code 1. What is genuinely wrong: (i) the stored `status` field is
  computed without `skippedFiles`, so it cannot mean "index covers the project"; (ii) the
  recommended remedy (`force=true`) cannot fix a deliberate size-tier skip, so this project will
  report `[INCOMPLETE_INDEX]` forever.
- **Sub-claim B — "24 LESS syntax errors"**: **REAL-BUT-MISDESCRIBED**. 24 files, but 16 are `.less`
  (routed to the CSS grammar) and 8 are `.scss` (its own grammar lane). The `.less` failures are a
  genuine grammar gap (LESS variables/interpolation in tree-sitter-css), not a router bug per se —
  the routing is declared in a code comment and was simply never measured on a corpus containing
  `.less` (bettercap is that corpus).
- **Sub-claim C — "only 42.9% embedding coverage overall"**: **REAL**. 23,925/55,785 = 42.9%;
  health prints it honestly with the per-model split. The gap is that health does not say *why* it
  is 42.9% nor that a backfill is pending (ISSUE-09 root cause), and the run's embedding outcome
  (queued/embedded/failed/dropped) is not persisted anywhere, so the number cannot be explained
  from the index.

## 5. Root cause (file:line + quoted code)

**5.1 `status` is decided from errors only, while `INCOMPLETE` is decided from file counts — two
different definitions on one line.**
`src/ast/parallel-indexer.ts:7989-8005` (main status write; repeated at 8167 after post-processing):

```ts
    await BrainDatabase.updateIndexStatus(projectId, {
      lastIndexed: Date.now(),
      filesIndexed: Math.max(stats.totalFiles, coveredFiles),
      filesParsed: coveredFiles,
      ...
      // "complete" is a claim about the INDEX, so it is decided by the index: parse
      // errors, or files this run discovered that are still absent after recovery.
      status:
        stats.errorFiles > 0 || (stats.summary?.missingAfterRecovery ?? 0) > 0 ? "partial" : "complete",
```

`stats.skippedFiles` (size-tier skip at `parallel-indexer.ts:1013`, or unchanged-file skip at
`1023-1031`) is not part of this decision. For bettercap: `errorFiles=0`, `missingAfterRecovery=0`
→ `status="complete"`, while `filesParsed=coveredFiles=1972 < filesIndexed(discovered)=1973`.

`src/brain/database.ts:446-448` shows the column mapping that makes the health shortfall possible:

```ts
    const filesTotal = data.filesIndexed ?? data.files ?? 0   // -> total_files
    const symbolsTotal = data.symbolsIndexed ?? data.symbols ?? 0
    const filesParsed = data.filesParsed ?? filesTotal          // -> indexed_files
```

So `total_files=1973` (discovered) and `indexed_files=1972` (covered) are the two populations the
health check compares.

**5.2 The health layer correctly catches it and names the contradiction — but the line still prints
both fields side by side.**
`src/intelligence/health/health-provider.ts:1170-1171` (error):
> `the last index run recorded ${indexed} of ${total} files as indexed — ${missing} file(s) were found by the walk but never written, so the index is INCOMPLETE${contradicted ? " even though the status field says \"complete\"" : ""}. … Run refresh=true, force=true to rebuild from scratch.`

`src/intelligence/health/health-provider.ts:1434` (the `index:` line) appends
`status=${report.indexStatus.status}` unconditionally, including when `isIncomplete` is true.
A second layer, `src/brain/brain-index-health.ts:347-359`, independently reports the same
contradiction. So the product *knows* both facts; it just prints them in a shape that reads as
self-contradictory, and the shortfall is computed from counts that include deliberate skips.

**5.3 "24 LESS" routing/grammar.**
`src/ast/language-detection.ts:78` maps LESS into the CSS lane:

```ts
  scss: "scss", sass: "sass", less: "css",
```

and the parser picks `tree-sitter-css.wasm` for it (`src/ast/engine.ts` CSS case). The engine's own
comment (`src/ast/engine.ts:1073-1080`) declares the limitation and says it was never exercised:

```ts
        // scss is its OWN grammar and its own lane, not a dialect flag on the CSS one.
        // ... 254 `.scss` files were routed to a grammar with no `$variables`, ...
        // `.sass` (indented syntax, a genuinely different grammar) and `.less` stay on the CSS wasm
        // and stay DECLARED — measured 0 files of each in 13 corpora, so neither is a claim this
        // repo can support or refute.
```

bettercap contains 18 `.less` files (FontAwesome), 16 of which fail: the error reports
(`brain_file.error_report`, sampled in `10-less-errors.txt`) are "the grammar could not read this
token" over valid LESS such as `.@{fa-css-prefix}-spin { … }` and `@fa-font-path: "../webfonts";`.
The 8 `.scss` failures are a *second* gap: SCSS has its own wasm grammar
(`tree-sitter-scss.wasm`) yet FontAwesome's SCSS (`@mixin`, `@function`, `#{}` interpolation,
`@each`) still produces syntax-error records. Both are genuine analyzer/grammar coverage gaps, not
router mistakes: `.less` deliberately rides the CSS grammar; `.scss` has its own and still fails.

**5.4 42.9%: per-batch local fallback + a remainder the index cannot explain.**
Same mechanism as ISSUE-09 §5.3/5.5: `SemanticEngine.embedMany` degrades to local word vectors for
each provider-failing batch (`src/brain/semantic/engine.ts:412-431`), so the modern full index run
wrote 23,924 local rows; the queue cap (`EMBED_QUEUE_ITEM_CAP = 25000`,
`src/ast/parallel-indexer.ts:2582`) drops overflow batches with only a `log.debug`/metric
(`3176-3191`), and the drain wait defaults to 300 s (`src/cli/index.ts:390`). The run's embedding
outcome (`stats.summary.embedOutcome`) is not persisted, so `bb health` cannot distinguish
"never attempted" from "provider failed" — the coverage number is honest but unexplained.

## 6. Generality table

| language / surface | project | fixture / repro | same class? | evidence |
|---|---|---|---|---|
| Go index health | bettercap | `bb health` + read-only DB | **YES — reproduced**: shortfall 1972/1973, status=complete, 24 style errors, 42.9% | `04-*`, `07-*` |
| mixed (22 corpora) | workspace | MCP `bb_health verbose=true` | **YES class**: same `brain_index_status` semantics; here `status=partial errors=1000` (honest because indexing errors exist); mixed-model embeddings 127.7% of symbols | `09-workspace-generality.txt` |
| style sheets (`css`/`scss`) | bettercap (FontAwesome) | DB `has_syntax_errors` split + `error_report` + file samples | **YES, two lanes**: `.less`→CSS grammar gap (16), SCSS grammar gap (8); report's "24 LESS" conflates them | `10-less-errors.txt` |
| all languages | fresh tiny `/tmp` fixture | `node bin/bb index` | **CANNOT-VERIFY** — sandbox cannot create a new project DB (`mkdir ~/.bb/projects/<hash>` → `ENOENT`, Lead-measured; not reattempted). Bettercap's 2026-11-18 index run already demonstrates the mechanism from a fresh index. | environment note |
| health status semantics | any project with a deliberate >5 MB skip | static: `parallel-indexer.ts:1005-1013` + `7989-8005` | **YES generality** — any project containing a >5 MB eligible file will (a) report `[INCOMPLETE_INDEX]` forever and (b) be told to `force` rebuild, which re-skips it. Bettercap's `modules/ui/ui/vendor.js` is the instance. | `07-*`, source quotes |

Conclusion: **tool-wide, not Go-specific.** The status/shortfall semantics are language-agnostic; the
syntax-error split is a style-sheet-analyzer gap that bettercap happens to expose.

## 7. Fix sketch (implementation-ready)

1. **Make `status` mean what the health line needs.** In the two `updateIndexStatus` calls
   (`parallel-indexer.ts:7989`, `8167`), decide status from the index: `partial` when
   `coveredFiles < stats.totalFiles` OR `errorFiles > 0` OR `missingAfterRecovery > 0`. Keep a
   separate `skippedFiles` counter (size-tier/unchanged) so an intentional skip is not a parse
   failure.
2. **Split the shortfall by cause.** Persist `skipped_too_large` (and `unchanged`) in
   `performance_stats`; the `INCOMPLETE_INDEX` check should compare only files that *should* have
   been written. When the shortfall is a deliberate size-tier skip, emit a `SKIPPED_TOO_LARGE`
   warning naming the file and the reason, **not** the error-severity `INCOMPLETE_INDEX` whose remedy
   cannot work; the remedy should be "raise the size tier or add the file to `.bbignore`", and the
   line should not print `status=complete` beside it.
3. **Never print `status=` while `isIncomplete`.** Render
   `recordedStatus=complete (contradicted — see INCOMPLETE_INDEX)` or omit the field; better: rename
   the stored column's meaning (`runStatus`) so nobody reads it as index completeness.
4. **LESS/SCSS syntax accounting.** Either wire `tree-sitter-less` for `.less` (and split `.sass`),
   or declare `.less`/`.sass` as "partial extraction" and stop counting their grammar gaps as
   `syntaxErrors` in the header; fix the SCSS lane's gaps (`@mixin`/`@function`/`@each`/interpolation)
   or downgrade their severity so `syntaxErrors=24` does not overstate a real corpus. At minimum,
   the `[SYNTAX_ERRORS]` summary should split by language (`16 css(.less), 8 scss`).
5. **Explain embedding coverage.** Persist the run's `embedOutcome`
   (`queued/embedded/failed/dropped/skipped`) in `brain_index_status.performance_stats`, and have
   health print `42.9% (23,925/55,785) — configured model 0% — N unembedded (local fallback due to
   provider failure)` (ties into ISSUE-09 §7.1).

## 8. Gate / test proposals

- **Status semantics unit test**: index a fixture containing one >5 MB eligible file; assert
  `brain_index_status.status` is not silently `complete` beside a shortfall — either
  `status="partial"` or a distinct `skippedTooLarge` state — and that the health `index:` line does
  not print `status=complete` while `isIncomplete`.
- **Health-message golden test**: project with a deliberate skip must not emit
  `INCOMPLETE_INDEX` with `force=true` as the remedy; must emit a
  `SKIPPED_TOO_LARGE`/`SIZE_TIER` warning naming the file.
- **Analyzer gate for style sheets**: parse FontAwesome `.less`/`.scss` fixtures; assert either zero
  syntax errors (grammar added) or that the summary declares `css(.less): N, scss: M` and the
  coverage contract for partial extraction. This is the missing test the engine comment admits to.
- **Embedding outcome persistence test**: mock provider failure during an index run; assert the run's
  `embedOutcome` is readable from the DB and health prints the unembedded count/backfill state.

## 9. Evidence paths

- `docs/bb-bettercap-triage/evidence/embeddings-health/00-ground-truth.txt`
- `…/04-health-plain.txt` (verbatim indexedFiles/INCOMPLETE/status=complete + `[INCOMPLETE_INDEX]`)
- `…/05-stats.txt`, `…/06-doctor.txt`
- `…/07-db-forensics.txt` (status/total_files/indexed_files, skippedFiles=1, per-language syntax errors, per-model embedding rows, timings)
- `…/08-source-quotes.txt` (file:line quotes reproduced above)
- `…/09-workspace-generality.txt`, `…/10-less-errors.txt` (24 files, language split, sample content + error reports)
