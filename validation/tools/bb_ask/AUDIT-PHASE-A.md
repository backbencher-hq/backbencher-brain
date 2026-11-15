<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the Phase-A audit of bb_ask: the contract, the engines it calls, the
answers it shapes, every gate that claims to cover it, the measured latency on all three tiers,
the real MCP stdio door, regex and comment inventories, and the defect register Phase B fixes.

WHO IT IS FOR — the repository author reviewing the tool before Phase-B edits, and any later
owner returning to this lane.

EDIT TOGETHER WHEN THIS CHANGES — validation/tools/bb_ask/LATENCY.json, validation/tools/bb_ask/audit.json,
the probe scripts under validation/tools/bb_ask/work/, and the tool sources it audits.
-->

# bb_ask — Phase A audit

Scope: `src/mcp/tools/bb_ask/{descriptor,handler}.ts`, `src/intelligence/search/{quick-answer,semantic-search}.ts`,
`script/tool-docs/curation/bb_ask.ts`, `docs/tools/bb_ask.md`, `docs/BB_ASK.md`, and the gates
`script/m13/verify-ask-*.ts`, `script/m15/verify-ask-deep.ts`, `script/m16/verify-ask-stats.ts`,
`script/verify-semantic.ts`. Read-only for `src/` and `docs/` in this phase; all writes are under
`validation/tools/bb_ask/`.

Base commit: `b76d8b370239211dc16c87930eda549d8d7299cc`.

## 1. What the tool actually does

`bb_ask` is a text-first tool. `quickAnswer()` chooses one of five routes before any retrieval:

| route | answer | confidence | sources | retrieval metadata |
|---|---|---|---|---|
| `aggregate` | exact SQL count / largest file / most complex function | 0.9–0.95 | empty by design | none |
| `retrieval` (vector) | "closest matches", each `--- File: …` + snippet + similarity | mean of returned cosines, clamped 0.2–0.85 | every result | method / models / dimension / coverage / reason |
| `retrieval` (keyword fallback) | same shape, no similarity printed | declared constant 0.2 | every result | method=keyword-fallback + reason |
| `retrieval` (exact-name) | the named symbol first, then its neighbours | 0.8 (stale) / 0.9 | exact + neighbours | method=exact-name |
| `symbol-name` | symbol matches from the symbol search | 0.2–0.8 from `_relevance` | every match | inherits the retrieval block |
| `none` | explicit "could not find"; refusal-by-name for uncountable nouns | 0.1 (0 on tool failure) | empty | none |
| `no-index` | "index it first" / "index unreadable" | 0.1 / 0 | empty | none |

The engine (`semanticVectorSearch`) enforces model consistency (query model must equal stored
`embedding_model` and `vector_dimension`), skips non-finite cosines, caps the dense scan at
`BB_VECTOR_SCAN_CAP` (20,000 rows) ordered by `entity_id`, floors local cosines at
`LOCAL_VECTOR_FLOOR = 0.5` and non-local at 0.35, and falls back to `content-search` with a named
reason. Every path is honest about *which* route answered, and the handler refuses to append
"no matches" to an aggregate answer (that contradiction is already fixed in the source).

## 2. Defect register (Phase A findings)

Severity is what the evidence supports: **critical** = a contract/read-write violation or a
self-contradicting answer; **high** = an honest reader is misled or the client budget can be
breached; **medium** = docs/contract drift or a gate that cannot report; **low** = dead code,
narration, small inconsistency.

### C1 — The read path opens the index **read-write** and writes it (critical)

`quick-answer.ts` (`indexState`, every stat branch, `exactSymbolMatch`) and `semantic-search.ts`
(`semanticVectorSearch`, `resolveEntities`, `keywordFallback`) call
`BrainDatabase.getRawInstance(projectId)` with no `readonly` option. That open runs
`ensureSchemaIfNew` — the additive migrations/healers — and returns a writable connection
(`database.ts:242`).

Measured consequences, all on scratch or copy indexes, never the shared `.bb-data`:

| observation | evidence |
|---|---|
| A read **created a 32,992-byte WAL** and the close checkpointed the database (db mtime moved) on a fresh index | `read-path-steps.json` steps 1 and 4 |
| A read of a project with **no index created a full database** (`brain.db`, `-wal`, `-shm`) | `missing-index-and-network.json` `missingIndex.createdDatabase` |
| At T2 scale, one read call created a **98,912-byte WAL** on the 3.6 GB copy | `t2-copy-write-delta.json` |
| The local query-embedding path opens its own **rw** handle through `engine.localVocabulary` → `BrainDatabase.getRawInstance` | `src/brain/semantic/engine.ts` (`localVocabulary`) |
| On the T2 copy, the db mtime moved during a read-only measurement run (backup 17:19:33 → copy db mtime 17:20:36) | `t2-backup.json` + `t2-copy-index-facts.json` |

Second write path on a read: `semantic-search.ts:222-235` schedules
`promoteMissingBlobsInBackground` when stored rows lack the float32 accelerator. The promotion
guard refuses only when `raw.readonly === true`, and the read path never opens read-only, so a
plain `bb_ask` call rewrites `brain_embedding.embedding_blob` on a legacy index in the background.
This violates the campaign ruling "read paths do not write the index" and makes a
`dbUnchanged:true` claim for T2 end-to-end impossible.

### C2 — `limit: 0` contradicts itself and does not bound work (critical)

- `semantic-search.ts:129` `const maxResults = options.maxResults || 50` turns the caller's `0`
  into `50`; the full dense scan and up to 50 resolved results are built.
- `quick-answer.ts:617-626` prints **every** semantic result block into the answer, ignoring
  `limit` entirely.
- `handler.ts:81-88` then slices the source list to 0 and appends
  `limit was 0, so no matches were requested or returned` — while the answer body above it
  already printed the matches. That is the same class of self-contradiction the handler's own
  comment says it removed for aggregate answers.

Measured: `limits.json` row `limit 0` — 1,525 chars, retrieval metadata present, `limitWasZeroNotice:true`,
identical work to the default call (14.9 ms vs default 99.8 ms warm-cache on the T1 index; the
scan itself is performed either way).

### C3 — `limit` has no declared ceiling and the answer payload is unbounded (high)

- The door accepts `limit: 5000` (`limits.json`); `bb_search` refuses `> 2000` with the explicit
  "refused rather than clamped" precedent, `bb_ask` has neither a ceiling nor a stated bound.
- The engine resolves up to `min(maxResults*10, 500)` ranked candidates and `resolveEntities`
  returns up to `maxResults`; `quick-answer` prints a 30-line snippet block per result with no
  truncation declaration. On T2 every scan keeps 19,957–19,980 of 20,000 candidates above the
  0.35 floor (`t2-components-remote.json`), so a large `limit` is reachable, not theoretical.
- Nothing in the answer declares `truncated` or the number of matches not shown.

### C4 — `confidence` contradicts the answer's own disclosure (high)

On the reference index every default call prints

```
Note: this ranking does not distinguish its top results — 49 other symbol(s) scored within that
margin … treat the ORDER as unreliable and the scores as a weak signal at best.
```

and still prints `confidence: 0.62 … 0.74`, computed as the mean of those same scores
(`t2-latency-end-to-end-phaseA.json` five runs). The number is presented as measured evidence
while the sentence beside it says the scores are not evidence. `docs/BB_ASK.md:107-109` documents
the mean-of-similarities rule but never says the non-discriminative case must cap it.

### C5 — The reported embedding coverage is model-blind (high)

`semantic-search.ts:47-66` counts `COUNT(DISTINCT entity_id) FROM brain_semantic_embedding` across
**all** models, but the scan only compares rows whose model and dimension equal the query vector's.
On the reference index (measured, `t2-components-*.json`):

| query space | comparable rows | reported coverage |
|---|---|---|
| `nvidia/nemotron-3-embed-1b` (2048-dim) | 30,906 of 310,423 | 10.6 % |
| `local-word-vectors-v3` (50-dim) | **1,931** of 310,423 | 10.6 % (same number) |

So at 11 % "coverage" the local path can compare 0.6 % of the index. `docs/BB_ASK.md:133` claims
the number is "the fraction of the index that can be compared at all" — it is not.

### C6 — Coverage is measured before the query embedding and can contradict the results (high)

`measureCoverage` runs before `await SemanticEngine.embed(...)`. The indexer's embedding drain is
asynchronous, so a query issued while a fresh index is draining can report 0 embedded rows and
still return vector matches computed after the drain wrote them. Observed in the committed
baseline gate log (`work/baseline/verify-ask-provenance.log`): the no-match probe failed with

```
Note: only 0 of 2 indexed symbols (0%) have embeddings …      ← coverage
sources=2                                                     ← vector matches
confidence=0.57                                               ← scores averaged
```

A deterministic re-run on a 120-file fixture did not reproduce it (`coverage-race.json`,
`anyContradiction:false`), so the report records the observed gate log as the reproduction and the
deterministic probe as inconclusive; the fix (measure coverage for the query model **after** the
model is known, at scan time) removes the class either way.

### C7 — The 20,000-row scan cap is never declared to the caller (high)

`semantic-search.ts:307` sets `provenance.truncated = rows.length >= VECTOR_SCAN_CAP` and returns
`scannedRows` / `filteredRows` in `metadata`, but `quick-answer.ts` rebuilds the provenance without
`truncated`, and the handler's `[retrieval:]` line prints neither count. On T2 the scan hit exactly
20,000 rows in all three measured scans — a capped scan is indistinguishable from a complete one.
The tool also never says how many candidates were compared at all.

### C8 — `stale` and `missing` are conflated into one marker (medium)

`resolveEntities` sets `stale` for both `"stale"` and `"missing"` freshness states
(`semantic-search.ts:367`), and every renderer prints `[STALE — file changed since index]`
(`quick-answer.ts:501,618`). A deleted file is reported as changed.

### C9 — Aggregate answers are "verified" with no index-age disclosure (medium)

The aggregate route returns exact SQL counts with `confidence 0.95` and provenance
`evidenceClass: "indexed"`. If files changed since the last index run the count is still exact
about a stale index. The generated page documents that no per-file marker is emitted, but nothing
in the answer names the index age or says a stale count is possible.

### C10 — Exact-name answers print the neighbour scan's reason as their own (low)

On the exact-name route the handler prints `method=exact-name, reason=no-vector-above-threshold`
(`limits.json` exact-name row) — the reason belongs to the neighbour scan that did not produce the
answer. The field is not wrong about the scan; it is mislabelled about the answer.

### C11 — Descriptor and curated docs overclaim (high)

`descriptor.ts:16`: *"Returns matched symbols with similarity scores."* False on the aggregate
route (a count, no symbols), the keyword fallback (no scores are computed; `similarity: null` is
deliberate), and the exact-name route (a name lookup). `script/tool-docs/curation/bb_ask.ts`:
`errors: "Unavailable index or embedding state"` — unavailable embeddings are a declared fallback,
not an error, and an unreadable index is a successful answer with a low confidence rather than an
MCP error; `safety: "It does not … silently rebuild embeddings"` — **false**: the background blob
promotion in `semantic-search.ts` is exactly that (C1).

### C12 — `docs/BB_ASK.md` is stale, mislabelled and missing its header (high)

| claim | reality |
|---|---|
| "the default similarity threshold adjusts (0.15 local vs 0.35 API)" (line 93) | `LOCAL_VECTOR_FLOOR = 0.5`; the 0.15 floor is the *old* value the source comment measures as below the false-positive median |
| "190-word programming vocabulary" (line 168) | `BASE_WORDS` has **205** unique words (`local-embed.ts`) |
| "Verified aggregate answers: high, fixed confidence (0.95)" (line 106) | count/aggregate branches use 0.95, largest-file and most-complex use 0.9 |
| "Response metadata" table lists `scannedRows`, `filteredRows` (lines 74-75) | the tool never prints either; they exist only in the engine's return object |
| no mention of the non-discriminative ranking disclosure, the exact-name route, the `limit` ceiling (there is none) or index-age staleness | all of them are user-visible behaviour |
| privacy: "API embeddings send code snippets to the configured provider at index time" (line 99) | **`bb_ask` also sends the natural-language question to the provider at ask time** — measured: `queryModel=nvidia/nemotron-3-embed-1b`, 94–435 ms per query embedding vs 2–4 ms local (`t2-components-remote.json`, `t2-components-local.json`) |
| milestone narrative `M16 regression`, `M18 evidence`, `shipped in M18.Q3`, `Q3.json` (lines 14, 196-218) and no §8 author header | campaign contract §8/§9 |

The M18 precision numbers the page quotes are real: `validation/m18/results/Q3.json` records
`warm 10/14 = 0.714286`, `cold 6/14 = 0.428571`, `negConfViolations 0`.

### C13 — The ask gates cannot report (medium; gate defect, owner scope)

| gate | canonical `bun run` result | cause |
|---|---|---|
| `m13/verify-ask-contract.ts` | exit 1, 14/15 | CLI legs pass; **MCP leg fails "No index found"** because the gate's `StdioClientTransport` does not forward `BB_DATA_DIR` and the SDK's child-env allowlist drops it — the leg can only pass by reading the user's real `~/.bb` |
| `m13/verify-ask-provenance.ts` | exit 1, 15/19 | no-match probe returns real vector matches on a 2-symbol fixture (C6); the probe query is not a no-match and the assertion is wrong for the shipped model |
| `m13/verify-ask-adversarial.ts` | exit 0, 17/17 | pass |
| `m13/verify-ask-integration.ts` | exit 0, 10/10 | pass |
| `m13/verify-ask-docs.ts` | exit 1, 24/28 | `import.meta.dir` is `undefined` under node/tsx (crash, `ERR_INVALID_ARG_TYPE`) — Bun-only gate; generator leg runs the **full**-repo generator (mid-campaign red by Lead ruling; must use `--only bb_ask`); evidence leg requires committed `a1/a2/a5.json` that are `known-gap` while their sibling gates fail |
| `script/verify-semantic.ts` | exit 0, PASS | pass |
| `m13/verify-ask-e2e-corpus.ts` | exit 1, 23/24 | same MCP env-forwarding defect; all four corpus legs pass on `~/bb_tests/repositories` |
| `m16/verify-ask-stats.ts` | exit 0, VERIFIED 8/8 (last section) | pass |
| `m15/verify-ask-deep.ts` | **exit 2, crash** | `reg.split('name: "bb_ask"')` → `undefined.split` at line 349: the inline registry block the gate scrapes no longer exists after the handler/descriptor split. A2 also reads `src/mcp/tool-handlers.ts` (now an assembler) and asserts on it. The gate cannot run at all. |

The faithful runner is `bun run …` (that is how `npm run verify` wires them) with
`BB_DATA_DIR=<lane>/bbdata/<tier>`; without a writable `BB_DATA_DIR` every gate dies on a
read-only `~/.bb` in this sandbox. Exit codes for both runners are in §5.

### C14 — `handler.ts` is 87-unused-imports and carries milestone narration (medium)

The split left the handler importing nearly the whole repository: 87 of its ~90 named imports are
never referenced (`node` script over the file, recorded in the Phase-A shell log; the exact list is
reproducible with the same script in `work/`). The import block also carries
`M28.T1 (issue #624)`, `M48.P1 (#696)`, `M55.T5 / §15.1` comments — banned authoring narrative.

### C15 — Dead code and numbering (low)

- `quick-answer.ts:215` `embeddingCoverage()` is never called (superseded by `coverageFrom`).
- `quick-answer.ts:192` "this lane added"; `:382` "caught by … the M15.A2 gate";
  `semantic-search.ts` four `M50.A2 (#764)` references — §9 narration.
- `m15/verify-ask-deep.ts` header "GENUINE deep redo", "this lane's own review"; `m16/verify-ask-stats.ts`
  header milestone framing — the gates are campaign files too.

### C16 — Query embedding can exceed the client budget (high; code fact, one probe)

`embedding-config.ts:118` defaults `BB_EMBEDDING_TIMEOUT_MS` to **30,000 ms** for the whole HTTP
request, and `SemanticEngine.embed` only falls back to local vectors *after* that failure. The
tool's declared budget is 5 s and the MCP client timeout is 30 s.

Measured two ways (`missing-index-and-network.json`):

- unreachable host (connection fails fast): the call returned in 354 ms with
  `method=keyword-fallback` — no budget problem in that case.
- **provider that accepts the connection and never responds** (a loopback server that reads and
  stalls; `BB_EMBEDDING_TIMEOUT_MS=3000` for the probe): the call blocked **3,024 ms** — the full
  configured bound — before falling back. At the shipped 30,000 ms default the same provider would
  hold a default `bb_ask` call for 30 s, which is exactly the MCP client timeout.

So a reachable-but-stalled provider turns a default `bb_ask` call into a client timeout, and the
caller learns nothing until it returns.

### C17 — Regex inventory (low; needs a cross-scope baseline update)

`validation/tools/regex-policy.json` PASS: 89 uses, 2 allowlisted, 87 frozen debt, 0 new. The
bb_ask path owns exactly **two** regex literals, both in `quick-answer.ts` and both removable with
plain string operations:

| site | use | non-regex replacement |
|---|---|---|
| `quick-answer.ts:249` | `.replace(/[.,;:!?]+$/, "")` strip trailing sentence punctuation | walk back over the `.,;:!?` set with `includes`/`slice` |
| `quick-answer.ts:251` | `/\s/.test(name)` reject a multi-word symbol name | iterate characters; `char.trim() === ""` identifies whitespace |

Removing them drops frozen debt to 85, so `validation/tools/regex-baseline.json` (Lead-owned) must
be updated in the same integration step or the gate reports `staleBaseline`.

### C18 — Cross-scope needs (reported to the Lead, not applied here)

1. `src/brain/semantic/engine.ts` `localVocabulary()` must open the index read-only (shared engine,
   outside this lane's scope) — otherwise C1 returns as soon as the API path is unavailable.
2. `validation/tools/regex-baseline.json` update after C17 (Lead owns the gate baseline).
3. `package.json` / `script/verify-quality-gate.ts` wiring for the new falsifiable honesty gate
   (`script/m13/verify-ask-honesty.ts`, Lead owns the central wiring).
4. `docs/EMBEDDINGS.md` bb_ask rows (precision table is real; the page is not in this lane's scope).
5. `docs/data/public-tools.json` and `website/src/data/tools.generated.ts` regeneration (Lead does
   central regeneration once at integration).
6. `dist/` is stale (built 2026-10-20); the compiled-CLI door stays blocked until the Lead's
   integration rebuild.

## 3. Real MCP stdio door (source entry)

`work/mcp-door.mts` spawns the real stdio server (`node --import tsx → src/mcp/server.ts`) with the
environment forwarded, lists the 16 tools, and issues 12 calls on the T1 index
(`mcp-door.json`, `failures: 0`):

- success: aggregate question (`provenance: indexed`), semantic question (retrieval block present),
  exact symbol name ("Matched by NAME"), `limit:1` (exactly 1 numbered source).
- refusals, all `isError: true` with the named message: empty query, whitespace query, missing
  query, unknown option (`mode`), negative `limit`, fractional `limit`, `limit` wrong type, and an
  unknown tool name.
- no stdout pollution: server stderr empty for the session; every response parsed as JSON-RPC.

## 4. Latency (measured, exact commands in `LATENCY.json`)

Warm, five distinct natural-language queries per tier (the in-process embedding cache keys on the
query text, so distinct queries are required to avoid measuring cache hits), one warmup excluded.
`BB_NO_AUTO_REFRESH=1` on every read.

| tier | population (files / symbols / embedding rows) | configuration | p50 | p95 |
|---|---|---|---|---|
| T0 `test/fixtures/polyglot` | 5 / 13 / 9 | local word vectors (`BB_EMBEDDING_DISABLED=1`) | 17.4 ms | 28.9 ms |
| T0 same fixture | 5 / 13 / 9 | provider configured, index embedded locally (falls back: `no-matching-model-embeddings`) | 175.2 ms | 189.6 ms |
| T0 same fixture, API-embedded index | 5 / 13 / 9 | provider configured (`nvidia/nemotron-3-embed-1b`) | 108.3 ms | 131.6 ms |
| T1 `.perf-fixtures/bb-scale/n100` | 97 / 3,512 / 1,185 | local word vectors | 101.8 ms | 232.0 ms |
| T1 same index | 97 / 3,512 / 1,185 | provider configured, local index (fallback path) | 277.3 ms | 331.7 ms |
| T2 reference index (read-only copy, 3.64 GB) | 6,452 / 310,423 / 32,837 | provider configured (as `bb.json` ships) | **1,789.9 ms** | **2,095.6 ms** |

T2 source index facts (`t2-index-facts.json`): 6,452 files / 310,423 symbols / 820,040
relationships / 32,837 embedding rows; `brain.db` 3,639,963,648 bytes, mtime
`2026-11-01T22:09:34.843Z`; opened with `getRawInstance(…, {readonly:true})`, `dbUnchanged:true`,
`walContentChanged:false`.

Warm T2 is inside the 5 s default budget; the honest qualifications are:

- **cold process, cold page cache: 9.2–10.2 s** for the first default call
  (`t2-copy-write-delta.json` 9,215 ms; `t2-latency-end-to-end-phaseA.json` warmup 10,173 ms)
  because the scan loads 20,000 × 2048-dim vectors (164 MB) into memory;
  this is why the budget figure above must be read as "warm".
- component decomposition (`t2-components-remote.json`): coverage aggregate 146 ms, query
  embedding 94–435 ms (network), candidate load 1,411–5,540 ms, cosine scoring 203–217 ms,
  exact-name lookup 1.2 ms, index-state count 1.9 ms.
- T2 end-to-end was measured on a **consistent read-only backup copy**
  (`t2-copy/`, produced by `t2-backup.mts` through a read-only source handle, 11.8 s, source db
  byte-identical) because the live read path writes (C1) and the shared index must not be touched.

## 5. Gate results (baseline, before Phase-B edits)

Two runners, same tree: `bun run <gate>` (the `npm run verify` invocation) and
`npx tsx <gate>`, both with `BB_NO_AUTO_REFRESH=1` and an isolated
`BB_DATA_DIR=validation/tools/bb_ask/bbdata/bun`. Logs: `work/baseline-bun/`, `work/baseline-tsx/`.

| gate | bun exit | tsx exit | verdict line |
|---|---|---|---|
| `script/verify-semantic.ts` | 0 | 0 | `SEMANTIC: PASS` |
| `script/m13/verify-ask-contract.ts` | 1 | 1 | `A1: KNOWN-GAP (14/15)` |
| `script/m13/verify-ask-provenance.ts` | 1 | 1 | `A2: KNOWN-GAP (15/19)` |
| `script/m13/verify-ask-adversarial.ts` | 0 | 0 | `A3: VERIFIED (17/17, 7 negatives)` |
| `script/m13/verify-ask-integration.ts` | 0 | 0 | `A4: VERIFIED (10/10, 2 negatives)` |
| `script/m13/verify-ask-docs.ts` | 1 | 1 (crash) | `A6: KNOWN-GAP (24/28)` |
| `script/m13/verify-ask-e2e-corpus.ts` | 1 | 1 | `A5: KNOWN-GAP (23/24)` |
| `script/m16/verify-ask-stats.ts` | 0 | 0 | `A4: VERIFIED (8/8)` |
| `script/m15/verify-ask-deep.ts` | 2 | 2 (crash) | `TypeError: Cannot read properties of undefined (reading 'split')` |

`npx tsx script/verify-tool-docs.ts --only bb_ask` → `TOOL DOCS: PASS (16 public tools, 1 artifacts)`:
the generated page is byte-fresh against the current registry, so C11 is a *descriptor/curation*
problem, not generator drift.

`npx tsc --noEmit` → exit 0 (clean baseline).

`npx tsx script/tools/verify-regex-policy.ts` → `REGEX POLICY: PASS — 2 allowlisted, 87 frozen debt,
0 new, 0 baseline rows now paid`.

## 6. Blocked legs (declared, not green)

| leg | reason |
|---|---|
| compiled-CLI transport (`node bin/bb tool bb_ask`) | `dist/` is stale (Lead ruling: source door only until the central rebuild); the CLI legs of the m13 gates were run against it and their results were not used as evidence |
| T2 end-to-end on the **live** shared index | the current read path writes it (C1); measured on a read-only backup copy instead and the copy's population is recorded |
| T2 end-to-end after the read-path fix | Phase B, after the read-only switch, same copy |
| provider-slow case for C16 at the shipped 30 s default | measured with a loopback stalling server at a shortened 3,000 ms bound (3,024 ms observed, proportional to the bound); the 30 s run was not executed to avoid a 30 s blocked call in every gate run |
| `~/.bb` default data dir | read-only in this sandbox; every gate needs `BB_DATA_DIR`, which is exactly why the MCP env-forwarding defect (C13) matters |

## 7. Evidence files

`validation/tools/bb_ask/` — `audit.json` (machine-readable register), `LATENCY.json`,
`t0-index*.json`, `t1-index.json`, `t2-index-facts.json`, `t2-copy-index-facts.json`,
`t2-components-remote.json`, `t2-components-local.json`, `t2-latency-end-to-end-phaseA.json`,
`t0-latency-*.json`, `t1-latency-*.json`, `limits.json`, `mcp-door.json`, `read-path-steps.json`,
`read-path-writes.json`, `read-path-writes-steps.json`, `t2-backup.json`, `t2-copy-write-delta.json`,
`coverage-race.json`, `missing-index-and-network.json`, and the probe sources under `work/`.
