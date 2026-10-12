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
| `.graphqls` | **97 files** (+3 over the cap) | answered by the REGEX fallback — **0 symbols, 0 relationships** across all 97 | `1150b2140` (15:12 today) — one map entry |
| `.jsonl` | **31 files** (+1 over the cap) | **4,676 symbols and 4,651 relationships**, priced by THIS census while the extension was unrouted | `bd8703156` (15:58 today) — a lane read this census's price and routed it **the same minute** |
| `.cts` | **3 files in this corpus** — see the note below | unrouted while `ts`, `tsx`, `mts`, `js`, `cjs`, `mjs`, `jsx` were all present; the fix commit cites **3,118** over a WIDER population this census does not walk | `6ed5d0508` (14:52 today) |
| `.mts` | **140 files in this corpus** | **18,586 symbols invisible in this repository alone** (the fix commit's measurement, over a different population: the repository, not the corpus) | `0fe665715` (12:23 today) |
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

The settled entry reports **97 counted + 3 over the 1 MB sampling cap**, and **the corpus holds 100 tracked
`.graphqls` files** — `graphql-java`'s three test schemas at 5.3 MB, 6.07 MB and 7.19 MB are the difference.
So the arithmetic anywhere else that moves the graphql lane's population should read **+97 under this cap and
+100 without it**, and the 97 in `armA` above is the cell that agrees with this census's count.

The fix also moves the graphql lane's own population: its census reads `1,911 = 305 .gql + 1,606 .graphql`
**precisely because the unrouted 97 were excluded**, and the router now accepts them. Every rate published
over that population is a rate over the smaller set, and no number has been re-derived over the larger one —
re-running the lane's census over it is the falsifier and it is still owed.

## This census's first result was used while it was still running

The class's SECOND settled row is the instrument being consumed: `.jsonl` was priced by this census while the
extension was unrouted and routed by another lane in the same hour (`bd8703156`, 15:58), whose message cites
**"4,651 relationships the fleet census priced"**. Two independent paths land on that number inside the
artifact, and that is the point of recording it — the row this census wrote while the extension was still
unrouted holds **4,651**, and the settled entry, priced AFTER the fix at the extension's real name (json),
reproduces **4,651** as well. A measurement that gets a fix and then survives a second, differently-routed
path to the same value is the strongest confirmation this class of instrument has. It is also a warning about
sequence: the census is a live instrument, and the thing it measures can be fixed between two of its own runs.

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

Completed run `2026-10-12T20:47:35Z` over `$HOME/fixtures/repositories` (199 repositories), after the
extension-shape correction recorded below. Every number here is read from
`validation/m14/measurements/unrouted-extension-census.json`, and the artifact's own arithmetic was re-checked
independently: the bucket counts sum to the row count, each bucket equals its conclusion field, no fixable row
lacks a language or a scaled price, and `singleGate.disagreements` is 0.

| | |
| --- | --- |
| extensions the corpus carries | **1,158** |
| extensions the router declares | 106 — of which 100 are observed in this corpus |
| keys the walk REFUSED | **1,058** — all measured, `complete: true` |
| … of which extension-shaped | **1,000** — the other **58 are filename fragments**, labelled, never work items |
| files under those keys | **142,423** (plus 461 over the 1 MB cap: counted, never sampled) |

| bucket | keys | meaning |
| --- | --- | --- |
| `sibling-grammar-reads-it` | **147** = **135 extension-shaped** + 12 fragments | a grammar already in the fleet reads the content |
| `no-grammar-reads-it` | 798 | text, and no candidate the router declares produced symbols |
| `binary-only` | 111 | nothing should route it |
| `extensionless` | 1 | 15,922 files whose only admission path is a `#!` read |
| `unmeasured-did-not-return` | 1 | `.csprojtemplate` (54 files): a parse did not return and the run was killed — published as unmeasured, not guessed |

Across the fixable rows: **35,051 symbols and 22,358 relationships** measured on the priced strides, and
**266,539 relationships** when each stride is scaled to its whole text pool. The scaled figure is the size of
the class and the measured figure is the floor: every capped row says which it is, per row.

### The published numbers, and the correction that supersedes them

This census was published as COMPLETE in `ed636a1c1` (15:54), from the artifact `generatedAt
2026-10-12T19:49:25Z`. Those numbers were correct **for that artifact**, and every one of them moved when the
candidate universe and the text rule were corrected. The deltas are named rather than left as drift:

| line | `ed636a1c1` (artifact 19:49:25Z) | this artifact (20:30:06Z) | why it moved |
| --- | --- | --- | --- |
| extensions refused | 1,060 | **1,059** | `.jsonl` (31 files) was routed at 15:58 — it is no longer a refusal, and it appears here as `routedSinceMeasured` plus the second settled entry |
| files refused | 142,459 | **142,428** | the same 31 `.jsonl` files, exactly. The delta is not noise: it is one extension leaving the class |
| fixable | 145 | **148** | candidates come from the router's DECLARED map, so four rows whose sibling extension never appears in this corpus became visible (and `.jsonl` left) |
| nothing reads | 805 | **798** | the seven rows that left went to fixable (+4), `binary-only` (+2) and unmeasured (+1) |
| binary-only | 109 | **111** | UTF-8 validity is the difference: hint bytes alone called two binary extensions text |
| unmeasured | 0 | **1** | `.csprojtemplate` (54 files): a parse did not return in a later run — the earlier run never reached it, so its `0` was a statement about a shorter run |
| priced | 40,088 sym · 27,308 rels | **35,459 · 22,761** | different winning candidates under the corrected universe |

The `unmeasured` line is the one to keep in view. A published **0** for "no parse failed to return" is only as
strong as the run that produced it, and the run that produced it had not yet reached the extension that hangs.

**A THIRD correction landed after that table: the extension-shape rule.** Taking everything after the last dot
published **58 keys that are not extensions at all** — `.nvmrc from source`,
`.sh with --install should install the default` (a shell suite's descriptive filenames),
`.0_darwin_amd64_sha256sum`, `.jsongenerator$converter`. **Twelve of them were inside the fixable class**, and
the ruled worklist below then proposed routing them. Nothing was dropped — the shape test *labels*, and the
files stay counted — so the actionable class is reported separately: **135 extension-shaped fixable keys**, with
the 12 fragments named in `suspectNameFragments`. That correction is why the numbers above read 1,058 keys and
142,423 files rather than 1,059 and 142,428.

### The fixable class, largest first

| extension | files | candidate | language | priced stride (25 files) | whole pool |
| --- | --- | --- | --- | --- | --- |
| `.mdx` | 3,380 | `.md` | markdown | 875 rels · 718 sym | ~118,300 |
| `.hrx` | 3,041 | `.h` | c | 515 rels · 37 sym | ~62,562 |
| `.pyx` | 1,540 | `.py` | python | 394 rels · 244 sym | ~24,223 |
| `.resx` | 2,207 | `.r` | r | 138 rels · 856 sym | ~12,177 |
| `.rd` | 1,366 | `.r` | r | 221 rels · 211 sym | ~12,075 |
| `.jsonschema` | 3 | `.json` | json | 7,255 rels · 6,553 sym | **7,255 — EXACT**: the whole bucket was priced |
| `.zsh-theme` | 144 | `.zsh` | bash | 972 rels · 350 sym | ~5,599 |
| `.erlsrc` | 6 | `.erl` | erlang | 2,919 rels · 220 sym | **2,919 — EXACT** |

**A sibling row is a PARSE RESULT, not a ruling, and the table above contains the proof.** `.pyx` and `.pxd`
are the examples `script/m60/routing-outlier-census.ts` uses for extensions routed to a grammar that cannot
REPRESENT the format (Cython, not Python), and this census reports the Python grammar yielding 244 symbols on
a `.pyx` stride. Both are true and they are not in conflict: a grammar can parse a format it cannot represent,
which is why the sibling census separates its measurement from its ruling and why these rows are labelled
`the extension is missing, the analyzer is not` rather than `route this`. What each row supports is narrower
than it looks — a grammar READS the content — and whether the routing is semantically right is still a human
ruling over the format's own literature. The same caution applies down the list: `.hrx`→`.h`(c) and
`.cabal`→`.c` are the `.csv`/`.cs` shape, proximity by spelling, disposed only by the parse.

## The fixable class after the join: 13 proposals, and NONE of them is a routing entry

A census row says a grammar READS the content. Whether an entry may be added is a different question, owned by
the lane whose grammar would receive it — so the rows are joined against every ruling that already exists and
against the receiving grammar's own declaration: `script/m60/unrouted-extension-rulings.ts` →
`validation/m60/results/unrouted-extension-rulings.json`, with a stride of up to 25 sniffed files per key.

| disposition | keys | why |
| --- | --- | --- |
| closed by an existing ruling | 1 | `.pyx` — declared `other-format`, RETIRED (`#913`, 2026-09-24). **It is the fixable class's third-largest prize (≈24,223 relationships) and routing it would fail R11**, the gate that exists to convict exactly that |
| not a work item | 12 | filename fragments |
| mixed stride, no proposal | 11 | the stride disagrees with itself: `.cfg` alone sampled `braces-unparsed 19 / unknown 5 / xml-declaration 1`, so no single entry would be right — and three XML `.cfg` samples would have proposed `xml` for 151 files |
| **content proposal** | **13** | a dominant language-bearing signature at ≥80% of the stride |
| … of those, declared by their own grammar | **0** | the standard the XML lane states: *routing is taken from the grammar's own declaration rather than from taste* |

So **nothing was routed by this work.** `.resx` — 2,207 files, 24 of 25 sniffed files opening with an XML
declaration, ≈12,177 relationships behind it — is refused by the same declaration test that refuses
`.wsdl`/`.pom`/`.plist`, and it now sits on that lane's owed list with its measurement
(`reviews/xml/master-review.md`, item 2). `.jsonschema` (7,255 relationships from three files) was already
weighed and deferred by the json lane in its own source. A census can honestly produce evidence for the lane
that owns the decision; what it must not produce is a routing claim no grammar backs.

## Verification trail

Every command below is quoted with its exit status, and the statuses that are NOT 0 are kept rather than
smoothed:

| command | exit | what it proves |
| --- | --- | --- |
| `npx tsc --noEmit -p tsconfig.m60.json` | **2** | **126 pre-existing errors in `script/m60`, 0 in this instrument.** Non-zero is the project's recorded debt (`validation/m14/measurements/scripts-typecheck-baseline.md`), and this project is the only one that opens this file at all: `tsconfig.json` includes `src/**/*.ts` only, so a green `npx tsc --noEmit` says nothing about `script/m60`. |
| smoke run over a synthetic corpus (`BB_CORPUS_ROOT=/tmp/uec-smoke`, checkpoint and artifact in `/tmp`) | **0** | the settled ledger prices and cites all three fixed extensions, the scaling is filled at assembly, and all five buckets are produced — including the two rows (`.graphqls2`, `.rst`) whose misclassification self-corrections #2 and #3 fix |
| `npx tsx script/m60/unrouted-extension-rulings.ts` | **0** | the join runs: 147 fixable keys, 1 closed by ruling, 12 fragments, 11 mixed strides, 13 proposals, 0 declared by their grammar. Importing the sibling census is side-effect free (`import.meta.main` guard, verified by mtime) |
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
  **A fourth class is now counted rather than passed over**: tracked files that are not on disk — measured at
  **22,861 of 525,586** tracked entries (2026-10-12, `scope.trackedButNotOnDisk`), concentrated in three
  partially-materialized `pb-*` repos (`pb-grpc` 9,792, `pb-googleapis` 9,153, `pb-reference` 2,797) plus
  `julia` (1,107). They cannot be read, so they are outside the walk's verdict — and the artifact says so
  instead of reporting a denominator it never reached.
- **A `no-grammar-reads-it` row is not a statement that no grammar could ever read the format** — it is a
  statement about the candidates the router's own table makes plausible, tested on up to 4 files each.
- **The class is now enforced, not only measured — the move this bullet used to say was not done.**
  `script/m60/unrouted-extension-gate.ts` → `validation/m60/results/unrouted-extension-gate.json` exits 1
  when the corpus carries an extension-shaped, TEXT-BEARING key the router refuses with neither a census row
  nor a ruling. Its register IS this census (`rows` + `routedSinceMeasured`) plus the rulings join, and it
  walks the corpus through the SAME `corpus-extension-walk.ts` this instrument uses, so the two cannot drift.
  Every run self-tests on four synthetic git corpora — a new text key must FAIL, a new binary-only key and a
  registered key must PASS, and a routed extension must not be refused at all — and it participates in the
  local `npm run verify` chain rather than GitHub CI, because its population is the machine-local corpus.
  What it still cannot do: see a format no walked corpus contains, re-price keys already registered (that
  stays this census's job), or decide anything about the 121 keys with no ruling and the 13 content
  proposals — those remain owner decisions, and a gate that ruled on them would be the taste the lanes'
  own standard refuses.
