# The unrouted-extension census — every extension the corpus carries that no router accepts

- Instrument: `script/m60/unrouted-extension-census.ts`
- Artifact: `validation/m14/measurements/unrouted-extension-census.json`
- Checkpoint (resumable): `validation/m14/measurements/unrouted-extension-census.rows.jsonl`
- Run: `npx tsx script/m60/unrouted-extension-census.ts` (repeat if it prints a resume hint; `BB_UEC_RESET=1` starts over)
- Typecheck, which is NOT `npx tsc --noEmit`: `npx tsc --noEmit -p tsconfig.m60.json` (see "Verification trail")

## The class, and what it has already cost

An extension the router does not know is not mis-analysed. It is **never read**: the walk's admission
test is `hasValidExtension` = `detectLanguageFromPath(...) !== null`, so an unrouted file is absent from the
store while still appearing in the population every per-lane census counts. Four instances landed inside one
week, each found by hand:

| instance | population | what it cost | fixed by |
| --- | --- | --- | --- |
| `.graphqls` | **97 files** | answered by the REGEX fallback — **0 symbols, 0 relationships** across all 97 | `1150b2140` (15:12 today) — one map entry |
| `.cts` | **3,118 files** | unrouted while `ts`, `tsx`, `mts`, `js`, `cjs`, `mjs`, `jsx` were all present | `6ed5d0508` (14:52 today) |
| `.mts` | not counted here | **18,586 symbols invisible in this repository alone** (the fix commit's measurement) | `0fe665715` (12:23 today) |
| `**/testData/**` — not an extension, the same shape | **156 files** | the `ignore` package folds case, so the glob swallowed lowercase `testdata/` corpus-wide: **12,479 routed-extension files** | `1c530e78b` (14:25 today) |

## `.graphqls` — the first measured row, and why it is a SETTLED row

`.graphqls` is this census's first entry because it is the one the class was found through. It is also
no longer unrouted: `language-detection.ts` gained `graphqls: "graphql"` at 15:12 **while this census was
being built**, so a live walk can no longer contain it — which is exactly what "fixed" means. The census
therefore carries a **settled ledger**: the rows this wave fixed, each priced on its real file pool, with
the artifact that priced it replayed from disk rather than transcribed.

| arm of `unrouted-population-price.json` | files | symbols | relationships |
| --- | --- | --- | --- |
| A — the 97 `.graphqls` **as they sat** (unrouted) | 97 | **0** | **0** |
| A2 — the same 97 contents routed to the analyzer | 97 | 83,371 | **195,108** |
| C — control: 250 files production does read | 250 | 16,719 | 39,563 |

Arm A is the finding: the fallback extractor cannot see a type definition, so the cost of the missing
entry was not degradation but **zero**, and the same content through the analyzer yields **195,108
relationships** — `references` 70,812 · `contains` 69,625 · `uses` 18,784 · `overrides` 18,162 ·
`exports` 13,746 · `implements` 3,979. Arm A2 is a temp-dir copy, so it is the analyzer's yield on the
CONTENT, not a store edge count; that caveat is the artifact's own and is carried forward here.

The fix also moves the graphql lane's own population: its census reads `1,911 = 305 .gql + 1,606 .graphql`
**precisely because the unrouted 97 were excluded**, and the router now accepts them. Every rate published
over that population is a rate over the smaller set, and no number has been re-derived over the larger one —
re-running the lane's census over it is the falsifier and it is still owed.

## The gate is ONE gate, and the instrument asserts it rather than quoting it

`parallel-indexer.ts:693` reads `hasValidExtension(p) => detectLanguageFromPath(p) !== null`, so "the router
refuses it" and "the walk never admits it" are the same condition, and a file in this census is not merely
mis-analysed. The instrument re-tests the gate on every file it counts (`assertSingleGate`, per bucket,
three files per bucket) instead of quoting that line: an edit that split the two gates would otherwise make
this document describe the wrong gate while still producing a table. Its artifact records
`singleGate.disagreements: 0` for the run rather than a claim in prose.

## Why this is not `script/m60/routing-outlier-census.ts`

The sibling census measures extensions routed to a grammar that **cannot represent** the format — `.pyx` and
`.pxd` as Python, `.gsp` as Groovy, `.lhs` as Haskell. Those files are READ; they produce wrong or empty
output through a real analyzer, and separating "this grammar is weak on its own language" from "this
extension is not that language" is a human ruling. An unrouted file is never read at all. The two classes
have different fixes (a routing ruling vs one map entry) and, until this instrument, only the first had a
census: `grep -c graphqls script/m60/routing-outlier-census.ts` is **0**, and the same `.graphqls` measurement
is 0 rows there and the first row here.

## The taxonomy is a parse result, not a string

Candidates are proposed by **spelling** and disposed by a **parse**. The first version proposed them by
prefix and was measurably wrong within twelve rows — `.csv` "shares" `.cs`, `.txt` "shares" `.t`,
`.expect` "shares" `.ex`, `.golden` "shares" `.go`. So a candidate must produce real symbols on bounded
sample files, and a bucket whose candidates all score zero is reported as **no DECLARED extension shares its
spelling** or **every candidate grammar produced 0 symbols** — two different facts, neither of them
"nothing reads this" by assertion.

Four buckets, and what each one means:

| bucket | meaning |
| --- | --- |
| `sibling-grammar-reads-it` | a grammar already in the fleet produced real symbols on the sample, separated from the runner-up: **the extension is missing, the analyzer is not**. This is the fixable class, and it is PRICED. |
| `no-grammar-reads-it` | text, and no candidate grammar produced symbols: the fleet has nothing to read it with. |
| `binary-only` | no text file in the bucket: nothing should route it. |
| `extensionless` | the walk's other admission path is a `#!` read, so a shell script is admitted and nothing else is. |

## What the instrument got wrong, and what caught each one

An instrument that measures a defect class carries its own failure modes into the census, so they are
recorded with the same specificity as the findings:

| # | the wrong rule | what it published | what caught it | the fix |
| --- | --- | --- | --- | --- |
| 1 | text/binary from hint bytes only (a NUL, or >5% control characters) | **`.png` — 7,716 files, 390 MB, the corpus's largest unrouted bucket — filed under "nothing reads these"**, because a small image can hold no NUL in its first 4 KB and the PNG signature's leading `0x89` is not a control byte | the checkpoint's own top-by-bytes table, before any doc quoted it | UTF-8 validity added; rows written under the old rule **self-invalidate** (`textRule`) instead of being reused |
| 2 | candidates from extensions the walk had OBSERVED | `.rst` filed as "no routed extension shares its spelling" in a corpus holding no `.rs` file — so whether an extension looked fixable depended on the rest of the corpus | the smoke corpus, on its first run | candidates come from the router's **declared** map (`EXTENSION_LANGUAGE`): 105 declared vs 3 observed in the smoke corpus |
| 3 | candidates per EXTENSION | `.graphqls2` filed as "no separation from the runner-up (5 vs 5)" — its two nearest spellings route to the SAME grammar, so they can only ever tie, and two of its own spellings read it perfectly | the same smoke run | one candidate per **LANGUAGE**; separation is measured between languages, and the row records the language, not just the spelling |
| 4 | no per-file cap and no interruptible parse | the first version fed an **809 KB shared library to the Solidity grammar** (`.so` → `.sol`) and died in an uninterruptible WASM loop | the run itself, ~20 minutes in, silent | per-file text gate + size caps, a slow-parse stop, a per-extension checkpoint, and an **inflight marker**: a killed extension is published as `unmeasured-did-not-return` rather than filled in |

The pattern in all four is the same one the census exists to find: **a rule that produces a table is
trusted until the table is read**. Each was caught by reading the artifact's own output — never by
re-reading the code.

## Scope and caps, all declared in the artifact

| cap | value | why it exists |
| --- | --- | --- |
| files per extension | 1 MB | larger files are counted but not sampled, and the count of them is in `scope.filesOverTheCapNotCounted` |
| parse size | 256 KB | above this a grammar's cost is unbounded (see self-correction #4) |
| sample | 4 files per candidate | separates two candidates; a candidate at 0 symbols stops after 2 |
| price | 25 files / 600 KB per extension | the stride whose symbols and relationships are reported |
| slow parse | 4,000 ms | stops that candidate and that extension; the stops are counted |
| total parses | 20,000 | an exhausted budget stops the run WITH the checkpoint intact and says so |

**A priced number is the analyzer's yield on the CONTENT through the winning grammar, under these caps, and
is not a store edge count** — a rerouted copy has no cross-file resolution. Where a price is a stride, the
artifact also reports the stride **scaled to the whole text pool** as an `EXTRAPOLATION`, named as one
(the stride is the first N files in walk order, not a random sample); where the whole pool was priced, the
same field is marked `exact` and is a measurement. The two are never mixed in the totals.

## Results

<!-- LIVE TABLE — filled from the completed artifact; nothing here is quoted from memory. -->

TBD

## Verification trail

Every command below is quoted with its exit status, and the statuses that are NOT 0 are kept rather than
smoothed:

| command | exit | what it proves |
| --- | --- | --- |
| `npx tsc --noEmit -p tsconfig.m60.json` | **2** | **126 pre-existing errors in `script/m60`, 0 in this instrument.** Non-zero is the project's recorded debt (`validation/m14/measurements/scripts-typecheck-baseline.md`), and this project is the only one that opens this file at all: `tsconfig.json` includes `src/**/*.ts` only, so a green `npx tsc --noEmit` says nothing about `script/m60`. |
| smoke run over a synthetic corpus (`BB_CORPUS_ROOT=/tmp/uec-smoke`, checkpoint and artifact in `/tmp`) | **0** | the settled ledger prices and cites all three fixed extensions, the scaling is filled at assembly, and all five buckets are produced — including the two rows (`.graphqls2`, `.rst`) whose misclassification self-corrections #2 and #3 fix |
| the fleet run itself | see the artifact's `generatedAt` | the row counts, buckets and prices in `Results` above |

The smoke corpus is not decoration: it is what found self-corrections #2 and #3 **before** the fleet run was
trusted, and it runs in under a minute because it needs no production data.

## Limitations

- **`.graphqls` is priced from two directions and they are not equal**: the settled entry prices a capped
  stride of the corpus's `.graphqls` files, while `armA`'s 97-file / 83,371-symbol / 195,108-relationship
  figure is the lane's pre-fix measurement over all 97. Both are shown; the larger is the citation.
- **The stride is not a random sample** (first N in walk order), which is why the scaling is labelled an
  extrapolation wherever it is not exact.
- **Windows and `git ls-files` only**: the population is tracked files in the corpus's git repositories.
  Untracked files, ignored files, and files over 1 MB are outside it, and the over-cap ones are counted.
- **A `no-grammar-reads-it` row is not a statement that no grammar could ever read the format** — it is a
  statement about the candidates the router's own table makes plausible, tested on up to 4 files each.
- **The class is not registered as a standing rule.** `script/m60/verify-standing-rules.ts` adjudicates
  R7–R11 against their artifacts and this census is not among them, so nothing in the fleet's own gates
  fails when a new unrouted extension appears. That is the obvious next move and it is not done.
