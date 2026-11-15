# bb_ask — Phase B report (fix, re-measure, red-then-green)

Author: Muhammad Ishaq Khan · Tool: `bb_ask` (read, requiresIndex true, modes: `answer`)
Phase A audit: `AUDIT-PHASE-A.md` + `audit.json` · Phase B evidence: this file,
`gates/summary.json`, `mutants.json`, `LATENCY.json`, `REAL-CORPUS.json`.

## 1. What was wrong (Phase A findings that mattered) and what changed

| # | Phase A defect | Fix |
| --- | --- | --- |
| C1 | answer path opened the index read-**write**, promoted vectors and could create/repair the DB | `quick-answer.ts` + `semantic-search.ts` read through `getRawInstance(projectId, { readonly: true })`; promotion removed; missing index answers with zero sources and creates no DB (`boundaries-phaseB.json`) |
| C2 | `limit: 0` was treated as "engine default": it printed results and then added "no matches were requested" | `0` and `>100` are refused with one sentence (`ASK_LIMIT_REFUSAL`) at the shared door **and** in the handler; no second refusal path |
| C3 | answers had no machine-readable bounds; a page could read as the whole match set | every answer carries `returned` / `totalMatches` (or explicit `unknown`) / `truncated` / `truncationReason`, rendered as `[bounds: …]` |
| C4 | a numeric confidence was printed beside a note saying the ranking was unreliable | non-discriminative ranking publishes **no number**: `confidenceKind: non-discriminative` (≤0.4) and the wire says "not a measurement" |
| C5 | coverage was counted across all models ("library coverage" presented as comparability) | `comparison` reports the query model, the symbols comparable **in that space**, and library-wide coverage separately |
| C6 | coverage was measured before the query vector existed | counts are measured after the embedding await, for the model+width actually compared |
| C7 | vector scan capped at 20,000 rows silently | cap is exported, declared in `[retrieval: scanned=N/cap]` and sets `truncated=true` with the cap named |
| C16 | provider's 30 s timeout exceeded the tool's budget | ask-time wait bounded at `min(2 s, BB_EMBEDDING_TIMEOUT_MS)`; on expiry the local model runs and the answer declares the timeout |
| — | `stale` and `missing` were the same marker | distinct `[STALE — file changed since index]` / `[MISSING — file no longer on disk]`, and `missing` is a separate result flag |
| — | descriptor advertised modes/limits/confidence the handler did not honour; page guide quoted a retired 0.15 floor and a 190-word vocabulary | descriptor rewritten (4 routes, confidence kinds, bounds, 1..100 default 5, provider transmission); page regenerated from curation; guide states 0.50/0.35 floors, 205 words / 50 dims, per-space coverage, scan cap, 2 s ceiling, both freshness markers |
| — | two regex literals in the read path (policy debt) | removed by plain string helpers; `script/tools/verify-regex-policy.ts` baseline regenerated (87→85) |
| — | unused `statProvenance` and dead `embeddingCoverage()` helpers | deleted (the count route builds provenance with its snapshot limitation inline) |
| — | `m35` red label `bb_ask: description advertises the freshness block` | the descriptor registered `freshnessModes` it never emitted the six-key envelope for; registration removed (the per-source markers stay documented). `m35/verify-envelope-contract.ts` is green |

## 2. Gates — green matrix (two runtimes, from source)

Command: `node validation/tools/bb_ask/work/run-gates.mjs` (isolated `BB_DATA_DIR` per
runtime, `BB_NO_AUTO_REFRESH=1`). Evidence: `gates/summary.json`, per-gate logs in
`gates/<runtime>/`, evidence snapshots in `gates/evidence/`.

| gate | bun | node |
| --- | --- | --- |
| verify-ask-contract | PASS | PASS |
| verify-ask-provenance | PASS | PASS |
| verify-ask-adversarial | PASS | PASS |
| verify-ask-integration | PASS | PASS |
| verify-ask-honesty (new) | PASS | PASS |
| verify-semantic | PASS | PASS |
| verify-ask-stats (m16) | PASS | PASS |
| verify-ask-deep (m15) | PASS | PASS |
| verify-ask-e2e-corpus | PASS | PASS |
| verify-ask-docs | PASS | PASS |

`GATES: ALL VERIFIED (10 gates × 2 runtimes, 75 negative cases)`.

## 3. Red-then-green — every gate is falsifiable

A mutation is planted in the tool source, the gate is run from source under node, the
mutation is restored byte-identically (sha256 compared). Evidence: `mutants.json`
(`allRed: true`, 13/13 observed red, 13/13 restored byte-identically).

| mutant (planted defect) | gate that turned red | red observation |
| --- | --- | --- |
| confidence cap removed | verify-ask-honesty | FAIL: non-discriminative confidence published |
| engine opens read-write | verify-ask-honesty | FAIL: read-only leg / db frames changed |
| fallback similarity becomes 0 | verify-ask-honesty | FAIL: fallback similarity is null, not 0 |
| coverage ignores model | verify-ask-honesty | FAIL: comparable count no longer equals scanned rows |
| handler limit clamp instead of refusal | verify-ask-honesty | FAIL: handler refuses `limit: 0` |
| truncation not declared | verify-ask-honesty | FAIL: a truncated page is not declared |
| stale flag dropped | verify-ask-integration | FAIL: STALE marker missing |
| provenance line dropped | verify-ask-e2e-corpus | FAIL: both transports lose `[provenance:` |
| regex re-introduced | verify-ask-deep | FAIL: read path contains a regex literal |
| function|method union narrowed | verify-ask-stats | FAIL: Ruby methods reported as 0 functions |
| NaN guard removed | verify-semantic | FAIL: non-finite candidates enter the scored set |
| aggregate provenance mislabelled | verify-ask-provenance | FAIL: aggregate class is not `indexed` |
| descriptor drifts from page | verify-ask-docs | FAIL: generator verify (page stale) |

Green on the fixed tree: `gates/summary.json` (above). The docs gate's own release probe is
also falsified: a tampered evidence document cannot claim `verified`.

## 4. Real corpus through the real MCP stdio door

Evidence: `REAL-CORPUS.json` (3 corpora, 13 door calls, `allDbUnchanged: true`).
Isolated `BB_DATA_DIR` under `validation/tools/bb_ask/bbdata/real-corpus`; source repos are
read in place from `/home/ishaq2321/bb_tests/repositories`; the door is the source
`src/mcp/server.ts` over stdio with the environment forwarded.

| corpus | indexed | space | call | ms | route |
| --- | --- | --- | --- | --- | --- |
| rake/lib (Ruby) | 497 symbols / 44 files | provider 2048-dim (353 embeddings) | semantic question | 1356 | vector (provider) |
| | | | exact symbol `Rake` | 233 | exact-name |
| | | | aggregate count | 41 | aggregate |
| | | | local question vs provider index | 436 | **keyword-fallback (declared model mismatch)** |
| graphql-js/src (TypeScript) | 8,057 symbols / 375 files | local 50-dim (1,991 embeddings) | semantic question | 151 | vector (local) |
| | | | exact symbol `GraphQLSchema` | 45 | exact-name |
| | | | aggregate count | 5 | aggregate |
| rebar3/apps (Erlang) | 4,832 symbols / 203 files | local 50-dim (3,996 embeddings) | semantic question | 182 | vector (local) |
| | | | exact symbol `rebar3` | 58 | exact-name |
| | | | aggregate count | 34 | aggregate |

Every call returned declared bounds; `brain.db` bytes and WAL frames were unchanged before
and after each door session (`dbUnchanged: true`), including the provider-embedded index
questioned from the local space (the honest model-mismatch fallback).

## 5. Measured latency (Phase B)

Evidence: `LATENCY.json` (`phaseB.tiers`), measured on an isolated copy of the 3.64 GB
reference index unless stated otherwise.

| configuration | p50 | p95 |
| --- | --- | --- |
| provider embeddings, warm, `limit: 5` | 1.78 s | 2.19 s |
| local word vectors, warm, `limit: 5` | 0.08–0.10 s | 1.33 s (after the fallback budget fix) |
| exact symbol name, `limit: 1` | 0.93 ms | 1.26 ms |
| live shared index under fleet writes | 5.15 s | 13.31 s (wall-clock contention) |
| T0 fixture, local | 2.26 ms | 4.16 ms |
| T1 n=100 fixture, local | 72.6 ms | 200.8 ms |

Raw provider embedding calls measured 0.23–2.38 s, which is why the tool's 2 s ceiling and
declared fallback matter. The lexical fallback's own number is in
`lexical-latency.json`: p50 0.92 s / p95 1.25 s / max 1.25 s on the reference index,
inside the 5 s default-call budget. The read-only proof (`dbUnchanged: true`) held on the live shared
index too, where 4.1 MB of WAL frames were present both before and after.

## 6. Reproduce

```bash
export BB_DATA_DIR=validation/tools/bb_ask/bbdata/verify BB_NO_AUTO_REFRESH=1
node validation/tools/bb_ask/work/run-gates.mjs --mutants   # green matrix + red proofs
npx tsc --noEmit
npx tsx script/verify-tool-docs.ts --only bb_ask
BB_DATA_DIR=validation/tools/bb_ask/bbdata/m35 npx tsx script/m35/verify-envelope-contract.ts
BB_DATA_DIR=<isolated> BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_ask/work/real-corpus.mts
BB_DATA_DIR=<isolated> BB_EMBEDDING_DISABLED=1 npx tsx validation/tools/bb_ask/work/mcp-door.mts <fixture> validation/tools/bb_ask/mcp-door.json
```

## 6b. Release-blocking latency defect fixed (fallback route)

The first Phase B measurement had T2 local-only p95 **8.0 s**, over the 5 s budget for a
default call. Root cause was measured, not guessed: the giant-corpus terms route ran one
full-corpus substring needle per query word, and one needle over
`name/qualified_name/docstring/source_text` is a 310k-row scan measured at ≈0.30 s; a
five-word question therefore spent 3–8 s in the lexical fallback alone
(`lexical-latency.json`, `needleProbe`).

Fix (in `src/intelligence/search/content-search.ts`, cross-lane per Lead request): the
giant-corpus terms route probes at most `GIANT_TERM_BUDGET = 2` content words, defers the
whole-phrase needle until the terms route comes back empty, and uses a header-only coverage
predicate (`source_text IS NOT NULL` — same count as `length() > 0` on the reference index,
measured in `work/coverage-cost.mts`). The cap is declared through the existing `truncated`
flag and `termMatch.queryTerms`. No provider-path change.

| measurement (T2 isolated copy, local vectors) | before | after |
| --- | --- | --- |
| default-call p50 | 0.18 s | 0.08–0.10 s |
| default-call p95 | **8.04 s** | **1.33 s** |
| worst fallback answer | 8.04 s | 1.33 s |
| lexical content search p50 / p95 | — | 0.92 s / 1.25 s |

`dbUnchanged: true` on every run.

## 7. Remaining limits (declared, not hidden)

- The local-word-vector fallback route is bounded, not free: on the reference index it costs
  0.86–1.33 s because substring needles are still full-corpus scans. Provider embeddings
  avoid the route by clearing the floor; when the provider times out the answer declares the
  fallback and its bounded result. A cold page cache on a 3.6 GB index can still dominate a
  first call (one 11.3 s observation under heavy fleet I/O before the tightening); the
  budget claim is a warm-process claim and is labelled as such.
- Provider-embedding indexing cost is paid once per corpus (~37 s for rake/lib's 497 symbols);
  it is not part of ask latency.
- Live shared-index latency includes other processes' I/O and must not be read as tool time.
