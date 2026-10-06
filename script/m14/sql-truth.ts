/**
 * SQL's audited-label set, read by `script/m60/rel-type-coverage-gate.ts` through
 * `readOwnOracleLabels` (which looks for `export const [A-Z_]*ORACLE_LABELS` in
 * `script/m14/<lang>-truth.ts`). Re-exported rather than restated, so the set cannot
 * drift from the oracle that produces it — the restatement the gate's own comment warns
 * about ("Restating it would be a copy that drifts the moment a lane appends a term").
 *
 * ## WHAT THIS DOES AND DOES NOT CLOSE
 *
 * It closes one of seven DERIVATION findings, and the honest width of that is the point.
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 reports for `sql`:
 *
 *   DERIVATION|sql|emits `calls` | contains | imports | references | uses` but the
 *   differential audits ["extends","implements","instantiates","overrides"]
 *
 * That is five, and it is WRONG IN THE OPTIMISTIC DIRECTION. The `audited` set it reports
 * is an ALLOWLIST read out of `differential.ts`, not a check that an oracle exists — and
 * `differential.ts` cannot audit SQL at all. `LANG_REPOS` has no `sql` key, so the harness
 * says so out loud instead of reporting a fabricated 0/0:
 *
 *   $ npx tsx script/m14/differential.ts --lang sql --sample 60
 *   [lane] SKIP sql: no corpus repo mapped in LANG_REPOS and none checked out —
 *   declared unrun, not measured
 *   probe run (--lang sql): measured 0 lane(s) — M14.0.F5 NOT written.
 *
 * So the true figure is **7 of 7 emitted types compared against nothing**, and this file
 * plus `validation/m14/fixtures/sql/sql-contains-oracle.mts` moves it to **6 of 7**.
 *
 * ## WHAT THE ORACLE MEASURED, AND WHAT IT CANNOT SEE
 *
 * `contains` at the full 1,962-file corpus, production `parseFile` against a second
 * derivation over the same grammar:
 *
 *   oracle 12,877   analyzer 12,018   agreed 11,895
 *   oracle-only 926, split by cause — 456 the owner is not declared in this file, 404 a
 *     `RETURNS TABLE` function where the two readings differ, 47 a composite type's
 *     attributes (recorded as `fields` on the type symbol, not published per-attribute),
 *     9 a column named after its own table, 6 a name `RESERVED_AS_COLUMN_NAME` declines,
 *     4 a name carrying embedded quotes and `;`
 *   analyzer-only 119 — 117 recovered from an ERROR node, 1 the schema-qualifier
 *     fabrication this pass fixed, 1 residue
 *
 * Artifact: `validation/m14/fixtures/sql/measurements/pass15-contains-oracle.txt`.
 *
 * NOT independent, stated rather than implied: the oracle walks the SAME wasm grammar, so
 * a grammar bug shared by both paths is invisible to it. It is a second implementation
 * reading one tree, not a second language. The 117 recovered-from-ERROR edges are exactly
 * where that limitation lives, and they are counted as recoveries rather than as agreement
 * for that reason.
 *
 * ## THE OTHER SIX
 *
 * `calls`, `uses`, `references`, `imports`, `overrides`, `instantiates` have no
 * independent derivation and naming them here would be the `#910` shape the shared
 * allowlist documents at length: a kind the allowlist names that no oracle derives is
 * compared against nothing, and reads as coverage. Each needs its own derivation, which is
 * stated as §8 work rather than claimed as done.
 */

/**
 * The literal is WRITTEN OUT rather than re-exported, because the gate reads it with a
 * text pattern (`/export const [A-Z_]*ORACLE_LABELS[^=]*=\s*\[([^\]]*)\]/`) rather than by
 * importing: `readOwnOracleLabels` says so it can stay synchronous and need no TS loader.
 * A re-export satisfies neither the pattern nor the loader, and the gate then silently falls
 * back to the shared allowlist — reporting the same five un-audited types as before this
 * file existed, which is the shape of a fix that reports green for having done nothing.
 *
 * So this literal is the CONTRACT, and the assertion below is what keeps it from drifting
 * from the oracle that produces it.
 */
export const SQL_ORACLE_LABELS: readonly string[] = ["contains"]

// The drift check. `readOwnOracleLabels` cannot execute this, so it does not — and a
// contract nothing checks is the restatement problem the gate's own comment names. The
// import is dynamic and lazy: the oracle module pulls in `web-tree-sitter` and
// `src/ast/pool-worker`, which must not be loaded by a gate that only wanted four strings.
if (process.env.BB_SQL_ORACLE_SELFTEST === "1") {
  const { SQL_ORACLE_LABELS: fromOracle } = await import("../../validation/m14/fixtures/sql/sql-contains-oracle.mts")
  const same = fromOracle.length === SQL_ORACLE_LABELS.length && fromOracle.every((l, i) => l === SQL_ORACLE_LABELS[i])
  console.log(
    same
      ? `sql-truth: contract matches the oracle (${JSON.stringify(SQL_ORACLE_LABELS)})`
      : `sql-truth DRIFT: contract ${JSON.stringify(SQL_ORACLE_LABELS)} vs oracle ${JSON.stringify(fromOracle)}`,
  )
  if (!same) process.exit(1)
}