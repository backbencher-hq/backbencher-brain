# OWNER SPOT-CHECK PACK — r
generated: 2026-09-28T17:54:50.841Z
HEAD: 88dff7629cbc26a2840c0eef90d67e42255c1604

## Fixture inventory (15)
  F01-assignments
    provenance: (uncommitted)
  F02-s3
    provenance: (uncommitted)
  F03-r6
    provenance: (uncommitted)
  F04-s4
    provenance: (uncommitted)
  F05-r5
    provenance: (uncommitted)
  F06-s7
    provenance: (uncommitted)
  F07-imports
    provenance: (uncommitted)
  F08-closures
    provenance: (uncommitted)
  F09-negative
    provenance: (uncommitted)
  F10-literals
    provenance: (uncommitted)
  F11-triple-colon
    provenance: (uncommitted)
  F12-edges
    provenance: (uncommitted)
  F13-invalid-r
    provenance: (uncommitted)
  F14-local-boundary
    provenance: (uncommitted)
  F15-dotdot
    provenance: (uncommitted)

## Live re-run

## Sample 4 fixture(s) for manual inspection

  --- F11-triple-colon ---
  source: validation/m14/fixtures/r/F11-triple-colon.R

  --- F04-s4 ---
  source: validation/m14/fixtures/r/F04-s4.R

  --- F06-s7 ---
  source: validation/m14/fixtures/r/F06-s7.R

  --- F09-negative ---
  source: validation/m14/fixtures/r/F09-negative.R

## Gates snapshot

Verify independently:
  bun run script/m14/run-fixtures.ts --lang r
  bun run script/m14/audit-analyzer-grammar.ts --prove-java
  bun run script/m14/differential.ts --repo <corpus>
