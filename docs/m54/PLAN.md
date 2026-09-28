# M54: Runtime Truth — FK Enforcement + stdio Gate

> GitHub milestone #53 ("M54: Runtime Truth — FK Enforcement + stdio Gate").
> Issues: #727 (P1), #728 (P2), #729 (X1).

## The milestone invariant (verbatim, enforced by the P1 gate)

> **Every SQLite connection bb opens enforces the declared foreign keys — on
> both runtimes, read-write and readonly — and legacy orphan rows are healed
> at open, never silently ignored.**

## Why this milestone exists (findings, each measured, none assumed)

1. **Runtime asymmetry (the headline).** bun:sqlite defaults `foreign_keys`
   OFF; better-sqlite3 (node) defaults it ON. The same statement therefore
   kept data under bun (the indexing runtime) and cascade-deleted it under
   node. Proven in `script/m54/probe-fk.ts` A1/A2/A3:
   - A1: `INSERT OR REPLACE` of a symbol that is a relationship source, FK ON
     → the edge is **silently cascade-deleted** (row count 0 after).
   - A2: same REPLACE of an edge **target** → edge survives with
     `target_symbol_id` SET NULL (lossy but repairable by the resolution pass).
   - A3: FK OFF (bun's old default) → same REPLACE is a no-op. Data kept.
2. **The FK surface is small and precise.** Exactly 4 REFERENCES clauses:
   `brain_symbol.file_id` (CASCADE), `brain_relationship.source_symbol_id`
   (CASCADE), `brain_relationship.target_symbol_id` (SET NULL),
   `brain_import.file_id` (CASCADE). No other table declares FKs.
3. **The store path is already FK-ON-safe by ordering.** `storeResults`
   pre-deletes relationships (by source AND by target) before symbols, so the
   REPLACE cascade hazard (A1) never fires inside the real write path. Probe
   B replays the exact statement sequence under FK ON: clean pass. This
   ordering is now LOAD-BEARING and documented in code.
4. **Legacy orphans were real but small — and most "orphans" were not.**
   Decision-time measurement on the real repo index: 4,154 relationship rows
   LEFT-JOIN to a missing symbol, of which **4,122 have
   `source_symbol_id IS NULL`** with `source_external` carrying the name —
   the **by-design external-source edge representation** (M51.A3), FK-legal,
   never touched by the heal. Only 32 were true danglers (non-NULL missing
   source), already removed by re-stores. The heal deletes ONLY rows whose FK
   value is non-NULL and unresolved.
   Honesty note: our own first gate draft re-counted the 4,122 as violations —
   the exact cry-wolf conflation M51.A2 killed (its docstring names this very
   population). The gate now uses health's own definition.
5. **storeResults' per-call `PRAGMA foreign_keys = OFF` leaked.** The happy
   path restored ON, but any exception between OFF and the restore left the
   shared cached connection FK-OFF for its process lifetime. Now wrapped in
   try/finally that restores the open-time policy on EVERY exit. The
   historical "compiled binary's SQLite can spuriously reject valid data"
   claim was never reproduced — and the post-closure soak
   (`script/m54/probe-fk-store-soak.ts`, 7/7) proves store-phase enforcement
   loses no data on a multi-language corpus, so the shipped state runs FK ON
   through the store as well.
6. **stdio production shape (M52 leftover, now permanent).** The M52-era
   concern was dev-mode (src under tsx drains the event loop and exits before
   the handshake). Production (`node bin/bb mcp`, compiled dist) serves
   correctly — 16 tools over stdio, proven in P2 and encoded as a permanent
   regression gate with a self-mutation mode proving silent child death is
   detected.

## The changes

| File | Change |
|---|---|
| `src/storage/db.bun.ts` | `PRAGMA foreign_keys = ON` at open (rw + ro, uniform policy; `BB_FK_ENFORCE=0` escape hatch) |
| `src/storage/db.node.ts` | Explicit `foreign_keys = ON` (rw + ro; same escape hatch — policy by contract, not by shared default) |
| `src/brain/schema-ddl.ts` | `cleanupOrphanedFkRows(raw)`: deletes only non-NULL unresolved FK rows (relationship source, symbol file_id, import file_id); per-handle memoized (WeakSet); returns counts for gates |
| `src/brain/database.ts` | Heal wired into `ensureSchemaIfNew` (both open paths); in `getInstance` it runs only when this process actually opened the file (M52 lesson: no per-call scans) |
| `src/ast/parallel-indexer.ts` | `storeResults` body wrapped in try/finally restoring the FK policy on every exit; `wipeProjectData` restores the policy; honest comments |
| `script/m51/probe-a1-mutant.ts` | Mutant child runs under the documented legacy posture (`BB_FK_ENFORCE=0`) — pre-M51 code also ran FK-OFF; without this the mutant's phantom edges are rejected at write time (which is M54's own S2 proof) and the batch rolls back |

## Verification (all commands re-runnable)

- `script/m54/probe-fk.ts` — the evidence probe (A1/A2/A3/B/C/D truth table).
- `script/m54/verify-p1-fk.ts` — **15/15**: policy on both runtimes (rw+ro),
  violation rejected on both, escape hatch mutates, indexing parity FK-ON vs
  FK-OFF byte-equal (same directory, in-place wipe), heal precision +
  memoization + open-path wiring, real-DB conformance (0 true danglers).
- `script/m54/verify-p2-stdio.ts` — production stdio handshake (16 tools) +
  `--self-mutation` proves the gate detects a dead server.
- `script/m54/apply-real-heal.ts` — one-time measured production heal
  (through the real open path; before 4122 counted → after: 0 true danglers,
  4122 by-design external edges preserved — verified, not assumed).
- Downstream: m21 D2 28/28, m51 A1 10/10, m51 A2 11/11, m13 H3 17/17,
  m21 R2 13/13, m52 V1 10/10 (warm bb_health still 37ms).

## Post-closure hardening (evidence, not memory)

- **Independent latency re-proof** (`script/m54/probe-health-latency.ts`,
  sharing no harness with m52's verifier): 3 fresh `node bin/bb mcp`
  launches, strict request→response round-trips, default `bb_health`, real
  index — **median 413ms per call** (388–415ms) vs the ~37,000ms user-reported
  baseline. Receipt: `validation/m54/results/LATENCY.json`.
- **FK-in-store soak** (`script/m54/probe-fk-store-soak.ts`): same corpus
  directory indexed twice — `BB_FK_ENFORCE=0` (legacy) vs the M54 posture —
  byte-equal file/symbol/relationship/import inventories (26 symbols, 6
  files, 44 relationships), zero FK rejections under store-phase enforcement.
  Receipt: `validation/m54/results/SOAK.json`.
- **32-row delta (4,154 counted pre-heal → 4,122 measured at heal)**: the
  earlier explanation ("removed by re-stores between measurements") is
  plausible but post-hoc and unverifiable now; treat the exact mechanism as
  unproven. What IS proven: at heal time the true-dangler count was 0 and
  every counted row was either a by-design NULL-source edge or a resolved
  non-NULL source.

1. ~~storeResults still runs FK-OFF during bulk store~~ **Resolved
   post-closure:** the shipped code (from `0d768b2a` on) already ran FK ON
   through the store (the store-phase OFF pragma was removed when the
   finally-restore landed; a stale comment claimed otherwise — caught by the
   soak probe's anchor check and corrected). The soak
   (`validation/m54/results/SOAK.json`, 7/7) proves byte-equal inventories
   legacy-vs-M54 on a TS/Python/Go/Rust corpus with zero FK rejections.
2. The heal is per-process-per-handle; a DB dirtied by an FK-OFF window (the
   escape hatch) is healed at the next open by a NEW handle, not retroactively
   in other live processes.
3. readonly connections carry the FK pragma for uniformity; on bun it is
   best-effort (sqlite may ignore pragma sets on ro handles) — S1c proves it
   engages on this platform; a runtime that refuses it is inert (reads cannot
   violate FKs anyway).
4. The escape hatch `BB_FK_ENFORCE=0` exists for legacy-posture tooling
   (documented; m51's mutant child uses it) — it is also the P1 gate's
   mutation lever, so a regression that disables enforcement fails the gate.
