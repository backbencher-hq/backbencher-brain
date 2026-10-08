# DERIV_EXPORTS_SWIFT3 — ontology measurements (Swift)

Every number here was produced by a run recorded in this file, with the command
that produced it. Verdict vocabulary is the three-verdict contract in
`docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1: EMITTED / RULED / GAP.

## Instrument note (defect found, not fixed — shared file)

`script/m14/firing-check-v2.mjs:36` hardcodes
`const REPO = "$HOME/backbencher-brain"` and imports
`${REPO}/src/ast/real-swift-analyzer.ts`. The main checkout is on
`analyzer/DERIV_TS`; a language lane lives in its own git worktree. So the
documented command

    cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs DERIV_EXPORTS_SWIFT3

grades **the main checkout's analyzer**, not the lane's, and after any lane edit
it silently keeps grading the unedited file. Two consequences, both reported
rather than fixed (script/m14/** is master-owned):

1. The lane argument `DERIV_EXPORTS_SWIFT3` does not resolve. `resolveLane`
   splits on non-alphanumerics giving the token `SWIFT3`; rule 3 tests
   `norm(k).startsWith(t)` i.e. `"SWIFT".startsWith("SWIFT3")` = false, and
   rule 4 tests the reverse. It exits 2 with a message, so it is a loud
   failure, not a silent pass. The correct argument today is `SWIFT`.
2. To measure the lane's own edits the harness needs a `REPO` override. Lane-local
   instrument: `script/m14/firing-check-v2.swiftlane.mjs` — a copy with
   `REPO` defaulting to the lane worktree and an explicit `BB_REPO` env override.
   It is byte-identical to the shared file apart from that one line, so the
   number it prints is comparable with the shared instrument's.

## Baseline (before any lane edit)

Command:

    cd $HOME/backbencher-brain && NFILES=200 bun script/m14/firing-check-v2.mjs SWIFT

Result, 2026-10-04/05, corpus `$HOME/fixtures/repositories/swift-corpus`:

    SWIFT           8/10  200/200 parsed · imports[] 472 in 199 files
       fired:  calls extends implements uses contains references overrides instantiates
       silent: imports exports
       counts: calls:2875  contains:1716  uses:1683  instantiates:676
               references:472  implements:135  overrides:58  extends:53
       e.g. benchmark/cxx-source/CxxSpanTests.swift  benchmark/cxx-source/CxxStringConversion.swift

Eight of the ten production types fire on 200 sampled files. `imports` is the
separate `ParseResult.imports` channel (472 in 199 files — EMITTED there, not a
defect on the relationship channel). `exports` is the only genuinely silent type.