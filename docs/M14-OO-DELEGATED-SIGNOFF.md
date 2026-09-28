# M14 ManagedOO delegated sign-off record

Status: CLOSED — delegated owner authorization recorded and the ManagedOO analyzer
issues #264 (csharp + dart), #266 (swift), #267 (objective-c), #268 (php), and the
ruby family-tail analyzer were closed on the owner's behalf after the final gates
and a confirming deep family review. No personal owner execution is claimed.

Authorization: on 2026-08-31, the project owner authorized the agent to work on
the ManagedOO-family closure, to perform the last checks and a manual review, and
then to close the ManagedOO analyzer issues on the owner's behalf.

This record is a governance disposition, not a substitute for machine-emitted
evidence. Supporting machine evidence remains under `validation/m14/results/`.

## Scope

| Issue | Analyzer | Fixture rerun | Delegated disposition | Discrepancies |
|---|---|---:|---|---|
| #264 | C# | 1/1 pass | CLOSED on owner's behalf | none observed |
| #264 | Dart | 2/2 pass | CLOSED on owner's behalf | none observed |
| #266 | Swift | 2/2 pass | CLOSED on owner's behalf | none observed |
| #267 | Objective-C | 2/2 pass | CLOSED on owner's behalf | none observed |
| #268 | PHP | 1/1 pass | CLOSED on owner's behalf | none observed |
| — (family tail) | Ruby | 1/1 pass | CLOSED on owner's behalf | none observed |

## Supporting gates

The delegated review relied on the following passing machine checks and their
recorded limitations:

- `M14.0.F1.json` — grammar audit evidence (all six OO analyzers 0 unknown refs).
- `M14.0.F2.json` — evidence-harness validation evidence.
- `M14.0.F3.json` — fixture evidence (all 20 fixture languages pass, no regressions;
  F3 restored to full 20-language coverage during this closure — the ruby wave's
  `--lang ruby` runs had narrowed it to a single check).
- `M14.0.F4.json` — mutation evidence (172/172 caught, incl. 38 ManagedOO mutants:
  csharp 3, dart 3, swift 7, objc 11, php 8, ruby 6).
- `M14.0.F5.json` — differential evidence (family floors: powershell:csharp 1366,
  proxicall:dart 1620, swift-nio:swift 1935, Clyde:objc 207, phpunit:php 834,
  rake:ruby 1174 — all 100% covered / 0 missing / 0 unexplained).
- `M14.0.SPEC.json` — completeness A–H evidence (all six OO languages 8/8).
- `M14.CC1.json` — cross-language consistency evidence, extended during this
  closure to cover the ManagedOO family: `oo-ranges-1based`, `oo-kind-consistency`,
  `oo-complexity` all pass (4 JVM + 5 systems + 6 OO languages).
- `M14.0.F2.json` freshness — honesty gate re-run at closure HEAD.

## Confirming deep family review (final pass, 2026-08-31)

The owner required a confirming family-level review beyond the gated checkpoints
before sign-off. The cross-language consistency probe (the same gate class that
caught the scala column-base finding and the zig 0-based-column defect in the
systems closure) surfaced a REAL family-wide defect that individual analyzer gates
had missed:

1. **Objective-C and Swift emitted 0-based columns.** `real-objective-c-analyzer.ts`
   `getRange()` and `real-swift-analyzer.ts` `createSymbol()` + import ranges used
   `node.startPosition.column` (0-based) while csharp/dart/php/ruby — and every
   other gated analyzer — emit `column + 1` (1-based). Symbols, properties, and
   methods in objc/swift reported columns one less than their true position. Fixed
   in both analyzers; the CC1 gate now asserts `oo-ranges-1based` so this class
   can never silently regress again.

2. **Differential baseline pollution.** 17 bogus `rake:<lang>` rows (0-file runs
   with null perf from a timed-out `--update-baseline` run) were removed; only
   genuine rows (`rake:c`, `rake:ruby`) remain.

3. **F3 evidence narrowed to ruby-only** by per-language fixture runs during the
   ruby wave; restored to full 20-language coverage and re-verified (0 failures).

All fixes were verified, gated, and committed before closure. Differential floors
for all six OO languages re-confirmed 0/0 at the gate sample after the fixes.
