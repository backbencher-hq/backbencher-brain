# M52: Health Latency Truth — Same Data, 70× Faster

> GitHub milestone #51 ("M52: Health Latency Truth — Same Data, 70x Faster").
> Issues: #721 (P1), #722 (P2), #723 (V1), #724 (X1).

## The milestone invariant (verbatim, enforced by X1)

> **Every latency optimization to a read surface must be proven data-identical
> to what it replaced (byte-equal values, guaranteed ordering contract kept),
> its warm cost measured through the real MCP surface on the real index, and
> guarded by a gate that provably fails when the optimization is removed.**

## Origin: the user report, measured

A user measured ~37s warm `bb_health` per MCP call on a 2,681-file repo and
raised their client timeout to 180s as a band-aid. Diagnosis (2026-09, this
repo's real index):

| Query in the default health path | Measured (legacy) | Why slow |
|---|---|---|
| `GROUP_CONCAT(DISTINCT vector_dimension)` over embeddings | 9.4s | No covering index → SQLite reads full rows **including 2048-dim vector BLOBs** (~1.3GB heap) to answer a metadata question |
| `COUNT(DISTINCT entity_id)` over embeddings | 3.3s | Same BLOB heap scan |
| Language breakdown (files ⋈ symbols, 2× `COUNT(DISTINCT)`) | 3.7s | Scans the whole file×symbol fan-out |
| Everything else | <1s | fine |

Freshness was **refuted** as a suspect (default is sampled, 200 files, ~ms);
`integrity` is opt-in. The TS-analyzer `statSync` module-resolution smell is
real but **index-time only** — registered separately for the analyzer lane,
not fixed here.

## What was done

**P1 (#721) — covering index.** `brain_embed_health_idx` on
`brain_semantic_embedding(project_id, embedding_model, entity_id,
vector_dimension)`: created in fresh DDL **and** via idempotent
`ensureHealthIndexes()` on **every DB open** (existing DBs upgrade in place,
verified live). The embedding aggregates now answer from index key columns;
the BLOB heap is never touched.

**P2 (#722) — language breakdown split.** The joined GROUP BY with two
`COUNT(DISTINCT)` became two bounded grouped queries merged in code. The
symbol-side `DISTINCT` was provably redundant; the file-side one is
load-bearing (file ids repeat across the join) and is kept. Zero-symbol
languages survive (LEFT-JOIN semantics preserved via the file-side query).

**V1 (#723) — verification layer** (`script/m52/verify-v1-parity-latency.ts`):
- **Parity**: legacy SQL vs M52 implementation on the real index, byte-equal
  after normalization: P1 modelRows (13ms→4ms), P2 entities (21ms→4ms),
  P3 languageRows **multiset** byte-equal + **ordering contract** (files DESC)
  proven on both sides (141ms→5ms).
- **Latency**: warm default `bb_health` over **real MCP stdio** (JSON-RPC
  initialize → tools/call, user-probe pattern): **26ms** vs the ~37,000ms
  baseline — well under the 2000ms budget.
- **Mutation**: on a real-schema copy of the DB, DROP the index → the plan
  loses the covering index; re-CREATE → it comes back. The gate provably
  detects the exact regression it guards.

**X1 (#724) — closure gate**: live re-runs of V1 + m13 + m21 R2 + m51 A2,
evidence conformance, and a real-repo receipt (covering-index plan + per-query
in-process costs).

## The ordering honesty note (found by the gate, not by review)

Legacy `ORDER BY files DESC` left ties to SQLite's unspecified sorter.
Observed on this index, the tie at `files=1` ordered `[yaml, javascript]` —
the *reverse* of lexicographic — and could flip across SQLite versions or
query plans. Chasing byte-parity with an unspecified tie order would make the
gate flaky and the product output unstable. M52 therefore **defines** the tie
order (`files DESC, language ASC, NULL first`), and V1 proves: (a) row
**multiset** byte-equality under that total order, (b) the only ordering the
legacy query guaranteed (`files DESC`) holds on both sides.

## Data/quality: the explicit answer to "is less time less data?"

No. The verified claim is **identical outputs at ~70× less wall time**:
same models/counts/dimensions, same entity count, same language rows
(multiset + ordering contract). Nothing is sampled, cached, rounded, skipped,
or deferred. Freshness sampling (200 files default) and opt-in `integrity`
are unchanged from before M52 — their semantics were never touched.

## Runtime/platform facts discovered (recorded for future milestones)

1. **MCP stdio requires a runtime that keeps the event loop alive.** Under
   node/tsx, `src/cli/index.ts mcp` drains and exits 13 ("unsettled top-level
   await") before the JSON-RPC handshake; under **bun** it serves correctly
   (verified). The V1 child therefore runs `bun src/cli/index.ts mcp`.
   Production `bin/bb` runs compiled dist under node — worth a dedicated
   investigation if the stdio server is ever served from dist under node.
2. **WAL copy discipline**: any verifier copying a live DB must checkpoint
   first (`PRAGMA wal_checkpoint(TRUNCATE)`) or lose recent commits.
3. **FK enforcement is runtime-dependent** (from M51, still true): node's
   better-sqlite3 enforces declared FKs; bun does not.

## Gates and chain

- `npx tsx script/m52/verify-v1-parity-latency.ts` — V1 (#723)
- `npx tsx script/m52/verify-closure.ts` — X1 (#724); re-runs V1 + m13 +
  m21 R2 + m51 A2 live
- `npm run verify:m52` — both, in order
- Downstream conformance updated: m13 (17/17), m21 R2 (13/13), m51 A2 (11/11)

## Evidence

`validation/m52/results/V1.json` (parity timings, stdio latency, mutation),
`validation/m52/results/X1.json` (closure receipt). Stamped at the final commit.

## Known limitations (honest)

- The ~37s→26ms claim is measured on this machine's real index (0.19GB DB,
  2,681 files, ~158k embeddings at diagnosis; 6,907 embedded entities at
  gate time). Machines with colder caches pay one disk-read of the covering
  index (~few MB) instead of the 1.3GB heap — the shape of the win holds.
- The mutation copies the real DB (real schema); it is bounded in runtime by
  index drop/create, not by row count.
- `bb_health` default still performs sampled freshness stats (unchanged
  semantics); only the three pathological queries were fixed.
- The TS-analyzer `statSync` module-resolution issue is NOT fixed here
  (index-time only; owned by the analyzer lane).
