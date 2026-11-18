# ISSUE-09 — bb_ask: configured embedding model space holds 1/55,785 symbols, so semantic retrieval is ~0% and falls back to keywords

Lane: `embeddings-health` (owner of verdict)
Adjudication: **REAL** (mechanism and symptom reproduced at current HEAD; one sub-claim about
"backfill on configure" is better described as a design gap around an existing best-effort pass —
see §Verdict)
Severity: **high** — semantic retrieval (the only feature that distinguishes `bb_ask` from lexical
search) is unusable on this project; the user gets keyword results while the warnings say why, but
nothing tells them the state is "backfill pending" or repairs it.
Confidence: **high** (CLI outputs + read-only DB counts + source paths quoted below)
Product: repo `/home/ishaq2321/mcp/backbencher-brain`, HEAD `be4c0ef25` (`Release 0.1.6: five
analyzers, one graph`), `node bin/bb --version` = 0.1.6, date 2026-11-18 (all captures UTC).
Project under test: bettercap, projectId `4c7590f1cba319aac298a50453c0ec440f2dc857`, DB
`/home/ishaq2321/.bb/projects/4c7590f1cba319aac298a50453c0ec440f2dc857/brain.db` (read-only
queries only; **never reindexed**; config **not** modified; API key never printed — config keys were
read via a redacting script, key rendered `<REDACTED len=70>`).

## 1. Why it matters to a user

`bb_ask` is *sold* as semantic retrieval. With this config the tool embeds the question into the
newly configured remote space (`nvidia/nemotron-3.5-embed-8b`, 4096-d) and scans **1** stored vector
out of 55,785 symbols. The answer is either a single accidental hit or a keyword fallback; the
retrieval line reports `embeddingCoverage=0% (1/55785 symbols embedded in this model space)` and
`libraryCoverage=43% (23925/55785 across all models)`. The 43% is the *old local space*, which is
never compared when the remote query vector succeeds. Worse, when the remote provider exceeds the
2000 ms query ceiling the tool falls back to the local 50-d space, and that space is weak:
query 2 returned `ranking=non-discriminative`, query 3 returned 0 candidates above the 0.5 local
floor. Either way the user's natural-language question is answered lexically.

## 2. Reproduce (read-only; one process at a time)

```bash
cd /home/ishaq2321/mcp/backbencher-brain
E=docs/bb-bettercap-triage/evidence/embeddings-health
node bin/bb tool bb_ask --dir /home/ishaq2321/bettercap \
  --args '{"query":"how does bettercap discover and load modules at startup"}'  > $E/01-ask-q1.txt 2>&1
node bin/bb tool bb_ask --dir /home/ishaq2321/bettercap \
  --args '{"query":"LoadModules session module startup wiring"}'               > $E/02-ask-q2.txt 2>&1
node bin/bb tool bb_ask --dir /home/ishaq2321/bettercap \
  --args '{"query":"ARP spoofing and packet sniffing attack implementation"}'  > $E/03-ask-q3.txt 2>&1
node bin/bb health /home/ishaq2321/bettercap   > $E/04-health-plain.txt 2>&1
node bin/bb stats  /home/ishaq2321/bettercap   > $E/05-stats.txt 2>&1
node bin/bb doctor                             > $E/06-doctor.txt 2>&1
sqlite3 -readonly <DB> "SELECT embedding_model, vector_dimension, COUNT(*) FROM brain_semantic_embedding GROUP BY 1,2;"
```

## 3. Observed (bounded; full outputs in evidence files)

Embedding rows (DB, read-only; evidence `07-db-forensics.txt`):

```
local-word-vectors-v3|50|23924|1795039247364|1795039634642
nvidia/nemotron-3.5-embed-8b|4096|1|1795039249969|1795039249969
=> the single remote row is entity_id "…:core/options.go:ParseOptions:26"
```

The 1 remote vector **is `ParseOptions`** — the symbol the report saw in its first query at 0.367.
So the report's "first query returned only ParseOptions" is not a ranking accident: that space
contains exactly one vector.

Retrieval metadata lines (verbatim):

```
Q1 [retrieval: method=keyword-fallback, queryModel=none, indexModel=none, embeddingCoverage=0% (1/55785 symbols embedded in this model space), libraryCoverage=43% (23925/55785 across all models), reason=no-vector-above-threshold, scanned=1/20000, filtered=1, candidates=0]
Q2 [retrieval: method=vector, queryModel=local-word-vectors-v3, indexModel=local-word-vectors-v3, dimension=50, embeddingCoverage=43% (23924/55785 symbols embedded in this model space), libraryCoverage=43% (23925/55785 across all models), scanned=20000/20000 (cap reached), filtered=20000, candidates=44, embeddingTimeout=2000ms (fell back to local-word-vectors-v3), ranking=non-discriminative (6 within the margin of the best)]
Q3 [retrieval: method=keyword-fallback, queryModel=none, indexModel=none, embeddingCoverage=43% (23924/55785 symbols embedded in this model space), libraryCoverage=43% (23925/55785 across all models), reason=no-vector-above-threshold, scanned=20000/20000 (cap reached), filtered=20000, candidates=0, embeddingTimeout=2000ms (fell back to local-word-vectors-v3)]
```

Health (evidence `04-health-plain.txt`):

```
embeddings: 23925 rows / 23925 entities / 42.9% of symbols
models: local-word-vectors-v3:23924[50] nvidia/nemotron-3.5-embed-8b:1[4096]
```

Config (`~/.bb/config.json`, keys only, secret redacted): `embedding_base_url =
https://integrate.api.nvidia.com/v1`, `embedding_model = nvidia/nemotron-3.5-embed-8b`,
`embedding_api_key = <REDACTED len=70>`.

**Model space the query used, and how it was chosen** (three paths observed):
- Q1: provider answered inside the 2000 ms ceiling → query vector in the *configured remote* space
  → scan filtered to that space → 1 row → `candidates=0` → keyword fallback.
- Q2: provider exceeded the ceiling → local fallback *for the query vector* → compared the populated
  local space (23,924 rows, scan cap hit) → 44 candidates, but declared non-discriminative.
- Q3: timeout again → local space → `candidates=0` above the local 0.5 floor → keyword fallback.

Arithmetic: 23,925/55,785 = 42.887% → `42.9%`; 1/55,785 = 0.0018% → rounds to `0%`. Both numbers are
honest; the report's "regressed to 0% semantic coverage" describes the *configured model space*.

## 4. Expected vs observed (contract)

- `docs/EMBEDDINGS.md` §2: the query vector's producing model is authoritative, cross-model
  comparison is prohibited, `tfidf-v1` excluded — **observed: honoured.**
- `docs/EMBEDDINGS.md` §3: coverage "never hidden — even when 0" — **observed: honoured**
  (`embeddingCoverage=0% (1/55785 …)`).
- `docs/EMBEDDINGS.md` §4: fallback ladder with explicit `fallbackReason` — **observed: honoured**
  (`reason=no-vector-above-threshold`).
- *Missing* contract (the defect): there is no rung for "configured model space is empty while a
  populated dense space exists", no "backfill pending" state, and configuring a new provider does
  not by itself trigger or even announce pending backfill. The report's requested behavior
  ("trigger a backfill or fall back to the populated local space") is **not implemented at query
  time**, and the backfill pass that does exist is only reachable from a later `bb index`.

## 5. Root cause (file:line + quoted code)

**5.1 Query-time model selection: authoritative query model, no populated-space preference.**
`src/intelligence/search/semantic-search.ts:259-280` — 2000 ms ceiling, local vector only when the
provider *times out*; on success `queryModel = SemanticEngine.getLastEmbeddingModel()`.
`src/intelligence/search/semantic-search.ts:329-333` — the scan is hard-filtered to the query model:

```ts
  const fromWhere =
    "FROM brain_semantic_embedding " +
    "WHERE project_id = ? AND embedding_model = ? AND vector_dimension = ? " +
    "ORDER BY entity_id LIMIT ?"
  const args = [projectId, queryModel, dimension, VECTOR_SCAN_CAP] as const
```

There is **no** comparison of candidate-space coverage and no fallback to another dense space when
the chosen space is empty — by design for correctness (never compare cross-space), but the design
has no *preference* step, so an empty configured space yields `reason=no-vector-above-threshold`
instead of a declared, populated-space fallback.

**5.2 The retrieval line hides which model space was compared** on the keyword path:
`src/intelligence/search/semantic-search.ts:583-598` hardcodes `queryModel: "none"` /
`indexModel: "none"` and drops the dimension, while `embeddingCoverage` is filled from
`facts.comparison.libraryCoverage` (the *library-wide* number). Consequence: Q1's line says
`queryModel=none` while `embeddingCoverage=0% (1/55785 symbols embedded in this model space)` —
the reader is told the compared space has 1 vector but not which model it is. This is a metadata
honesty defect adjacent to the main one (see UNLOCKED block).

**5.3 Index-time embedding downgrades to local per batch, so the configured space is never filled
when the provider is flaky.** `src/brain/semantic/engine.ts:358-439` (`embedMany`): try the API; on
failure record `_lastEmbeddingError`, apply 429 backoff, then — unless the caller passed
`allowLocalFallback: false` — return local word vectors *for that batch*:

```ts
    // A caller repairing an existing index must not replace a good provider vector
    // with a local fallback just because the provider was rate-limited: ...
    if (opts.allowLocalFallback === false) return []
    // Layer 2: Word vectors (always available, offline)
```

The ordinary index path does **not** pass `allowLocalFallback:false`, so a failing provider yields
local rows. This is exactly what the DB shows: 23,924 local rows written across the 2026-11-18
22:00:47→22:06:14 UTC run, plus **one** remote row at 22:00:49 (ParseOptions) — i.e. a single
request succeeded while the rest degraded. The `ParseOptions` row's `time_created` sits in the
*middle* of the local row time range, so it was written by the ordinary per-file/per-batch path, not
by the post-drain repair pass.

**5.4 A backfill/reconcile pass exists but is `bb index`-only and best-effort.**
`src/cli/index.ts:427-433` states the intent in code comments:

```ts
  // VECTORS ARE DERIVED DATA THAT A MODEL CHANGE INVALIDATES. The incremental path
  // only queues symbols from files it parsed; an unchanged index parsed nothing, so
  // changing the provider left every old vector in place (measured on bettercap:
  // new model saved, `bb index` said "nothing to index", DB still held the old
  // model's vectors). This runs AFTER the ordinary drain, ...
```

and calls `reconcileEmbeddingModel` at `src/cli/index.ts:445`. Its implementation
(`src/ast/parallel-indexer.ts:2966-3130`) is provider-only (`allowFallback: false`), batch 250,
and it **stops after two consecutive batches that convert nothing**:

```ts
    // A provider that is rate-limiting or down converts nothing. Stop after two
    // consecutive empty batches: continuing would print one failure per batch and
    // churn 49,985 symbols to reach the same "0 converted". The next run resumes.
```

Evidence that the pass ran or was reached but converted ~nothing: the run's
`postProcessingMs=191332` (191 s; two provider-only batches at the 120 s reconcile timeout is the
same order), while the stored configured-model coverage is 1/55,785 and `indexing_errors=[]`. The DB
contains no durable record of the reconcile outcome, so "the pass ran and converted 0" cannot be
proven from the index alone — exactly the missing "pending backfill" state. What **is** proven: a
fresh full index under the current config produced a configured-space coverage of 1/55,785.

`grep -rn reconcileEmbeddingModel src/` returns only `src/cli/index.ts` (import at 384, call at 445)
— there is **no config-change hook, no `bb setup` trigger, no watcher, and no query-time repair**
(a read must not write, per `semantic-search.ts:9-11`). So "configuring the provider triggers a
backfill" is not implemented; the closest behavior requires a subsequent `bb index`, and even then
the pass can stop early and leaves no visible pending state.

**5.5 Index-time drop/queue path leaves a remainder unembedded (contributing to 42.9%).**
`src/ast/parallel-indexer.ts:2582` `EMBED_QUEUE_ITEM_CAP = 25000`; overflow is dropped with a
`log.debug` and only a metric (`3176-3191`), never persisted; drain wait is
`BB_EMBEDDING_DRAIN_WAIT_MS || 300000` (`src/cli/index.ts:390`). The index run records embedding
counts nowhere durable (`stats.summary.embedOutcome` is in-memory only), so `bb health` can report
42.9% but cannot say "23,860 symbols were never attempted because the queue dropped them".

## 6. Generality table

| language | project | fixture / repro | same class? | evidence |
|---|---|---|---|---|
| Go | bettercap (55,785 syms) | CLI `bb_ask` ×3 + `bb health` + read-only DB counts | **YES — reproduced** (configured space 1/55,785; 0% retrieval; keyword fallback; local-timeout path 43%) | `01-*`…`07-*` |
| Go | bettercap *fresh* index under current config | same index's embedding row timestamps (22:00:47–22:06:14 UTC) + 1 remote row at 22:00:49 | **YES** — a from-scratch index run under the configured remote still landed local fallback vectors (23,924) + one remote vector; provider coverage was never filled | `07-db-forensics.txt` |
| mixed (22 corpora, 34,385 files) | workspace (`backbencher-brain`) | MCP `bb_health verbose=true` + `bb doctor` | **YES class** — same mixed-model state (new model 2,420 rows vs old nvidia 315,514 vs local 326,482); `bb doctor` DETECTS foreign-model vectors and only offers `Fix: bb index --force`; no pending-backfill state, no query-time preference | `09-workspace-generality.txt`, `06-doctor.txt` |
| any language | fresh tiny `/tmp` fixture | `node bin/bb index /tmp/…` | **CANNOT-VERIFY** — sandbox blocks a new project DB: `mkdir '/home/ishaq2321/.bb/projects/<hash>'` → `ENOENT` (Lead-measured; not reattempted). The bettercap run above already provides a same-config fresh-index measurement, so the mechanism is not blocked. | Lead environment note |
| workspace `bb_ask` end-to-end | mixed corpus | MCP `bb_ask` | **CANNOT-VERIFY** — MCP server failed at capture time: `Cannot find module '…/dist/content-search-ZPL5L7JT.js' imported from …/dist/chunk-PZ3XJRPH.js` (dist churn during triage window). Source path is shared with bettercap, so the class is not project-specific. | `09-workspace-generality.txt` |

Conclusion: **tool-wide, not Go-specific and not bettercap-specific.** The defect lives in the
embedding-engine/retrieval layer shared by every language; bettercap is simply a project whose
provider change happened after a full local index.

## 7. Fix sketch (implementation-ready)

1. **Durable backfill state.** After the drain/reconcile, persist an embedding-layer state on
   `brain_index_status` (new columns or `performance_stats.summary.embedding`): configured model,
   stored models + counts, per-model coverage, and `backfill: pending|in-sync|incomplete` with
   `remaining` symbols. `bb health` prints e.g.
   `embeddings: 42.9% overall — configured nvidia/…: 1/55785 (0.0%) — BACKFILL PENDING (55,784 missing; provider failures)`.
   `bb_ask` (and `bb doctor`) surface the same line. This is the state the user needs; today the
   index cannot distinguish "provider down, retry pending" from "never intended".
2. **Query-time declared preference.** In `semanticVectorSearch`, after computing the query vector,
   measure comparable coverage; if `comparableEmbeddings === 0` (or below a declared floor) and
   another dense model space has meaningful coverage, do **one** of:
   (a) *declared fallback*: embed the query with the populated model (local engine), compare there,
   and emit `queryModel=local-word-vectors-v3, fallbackReason=configured-model-space-empty,
   configuredModelSpaceCoverage=1/55785`; or
   (b) *declared absence*: return the existing keyword fallback but with a new reason
   `configured-model-space-empty` and a provenance line naming the configured model + pending
   backfill. Chosen policy must be documented in `docs/EMBEDDINGS.md` §4 (new rung) and never
   compare across spaces.
3. **Stop the silent downgrade when a remote provider is configured** (or record it): when
   `isEmbeddingConfigured(cfg)` is true and `embedMany` falls to local for a batch, store a marker
   (e.g. `semantic_context.embeddedBy = "fallback"`, or a per-run counter) so the layer can report
   "N vectors are local fallbacks, not the configured model" instead of only totals. Alternatively
   pass `allowLocalFallback:false` for index runs that have a configured provider (write nothing and
   let reconcile retry), keeping one space per intent.
4. **Trigger + resumability.** On `bb setup`/config write, and on `bb index` startup, compare the
   configured model with the stored model set and print the pending state + exact command. Make
   reconcile persist `remaining` and honor provider `Retry-After`/backoff across runs instead of
   stopping after 2 stalled batches; add `bb index --reconcile-only` so a user can fill the
   configured space without any parse/derived pass.
5. **Metadata fix** (small, independent): `keywordFallback` must not hardcode
   `queryModel:"none"`/`indexModel:"none"` when it measured `facts.comparison`; print the compared
   model + dimension (or explicitly `queryModel=<model>, compared=true, no-vector-above-threshold`).

## 8. Gate / test proposals

- **Deterministic engine test** (`script/m18`-style, fake fetch): provider returns `[]`/times out for
  index batches → run index → assert rows are either not written (preferred) or marked fallback;
  assert stored configured-model coverage is reported as 0 and `backfill.pending` is set. This is
  the missing state the current `verify-coverage.ts` cannot see.
- **Retrieval contract wire-test**: store N rows in model A, 2 rows in model B; make the query embed
  with model B (mock `getLastEmbeddingModel`). Assert: no cross-model comparison; when B coverage is
  empty the answer's `[retrieval:]` names B *and* the populated A space (declared fallback/absence),
  and `queryModel` is never `none` while coverage refers to "this model space".
- **Config-change e2e**: index a tiny corpus with local provider; change config to a dead remote;
  `bb index`; assert health/`bb_ask` both declare BACKFILL PENDING and the retrieval line names the
  populated space. (Requires the fixture index capability currently blocked by the sandbox.)
- **Honesty gate**: no `bb_ask` answer may print `embeddingCoverage=…% (… symbols embedded in this
  model space)` without naming the model space in the same line.

## 9. Evidence paths

- `docs/bb-bettercap-triage/evidence/embeddings-health/00-ground-truth.txt`
- `…/01-ask-q1.txt`, `…/02-ask-q2.txt`, `…/03-ask-q3.txt` (full answers + retrieval/bounds/provenance lines)
- `…/04-health-plain.txt`, `…/05-stats.txt`, `…/06-doctor.txt`
- `…/07-db-forensics.txt` (per-model counts, the single ParseOptions remote row, index_status, timings)
- `…/08-source-quotes.txt` (file:line quotes reproduced above)
- `…/09-workspace-generality.txt`, `…/10-less-errors.txt`
