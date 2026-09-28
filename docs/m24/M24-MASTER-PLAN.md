# M24: bb_lsp — The Server (IDE Program v0)

Status: `closed` — all 11 issues (#487–#497) verified and closed; final
audit in [M24-FINAL-AUDIT.md](./M24-FINAL-AUDIT.md). Program status lives in
[../IDE-PROGRAM-STATUS.md](../IDE-PROGRAM-STATUS.md).
GitHub milestone: `24` (IDE program v0 — "The Server")
Parent program: [IDE Program Decision Record](../IDE-PROGRAM-DECISIONS.md)
Governing contract: [IDE Honesty Contract](../IDE-HONESTY-CONTRACT.md)

## Purpose

Stand up the Backbencher language server: a standalone LSP 3.18 binary that
reads the persisted `brain.db` index and exposes hover, definition,
references, document symbols, workspace symbols, and call hierarchy
(incoming/outgoing) for the five launch languages — java, groovy, kotlin,
scala, typescript (the #419-CONFORMANT set).

The extension rule (contract §9): these five are the opening set, never the
ceiling. Language N+1 joins by passing the standing gates as a routine wave.

The complement stance (contract §7): no completion, no diagnostics, no
rename. Graph, navigation, cross-language, and evidence only. We layer on top
of first-party language servers; we never fight them.

## Issue groups

| Code | Issue | Deliverable |
|------|-------|-------------|
| G1 | Governance | master plan, ledger, closure gate, `npm run verify` wiring |
| P1 | Position mapping | dedicated conversion component (LSP 0-based UTF-16 ↔ index 1-based lines/byte ranges) with its own mutation suite — blood-tested foundation #2 |
| P2 | Freshness | file-watch → incremental reindex → machine-readable stale markers; declared debounce/catch-up guarantees — blood-tested foundation #1 |
| L1 | LSP skeleton | server lifecycle (initialize/shutdown), capabilities advertisement, stdio transport, project resolution. Declared scope: single-root workspaces only; unsupported languages get declared-absent responses (verifiable by negative test) |
| L2 | Hover | signature + usage count + evidence class + stale marker, per contract §2 claim levels |
| L3 | Definition + references | go-to-definition, find-references over brain_symbol/brain_relationship |
| L4 | Symbols | document symbols + workspace symbols from the index |
| L5 | Call hierarchy | prepare/incoming/outgoing over the bounded traverseGraph engine |
| V1 | Verifier harness | reference LSP client harness (the I1 gate); latency-budget gate per contract §3 |
| D1 | Docs | tool documentation truthful per contract §1 vocabulary; claim levels published |
| X1 | Gate | closure gate + planted mutations (contract §6 mutant set) + budget checks |

## Authority order

1. Executable implementation and public LSP handler behavior
2. Versioned machine-readable evidence and the verifier that produced it
3. The IDE Honesty Contract and the decision record
4. Per-feature documentation
5. GitHub issue text and human summaries

A lower authority cannot upgrade a higher-authority failure. Documentation may
explain a limitation, but it cannot turn a failed or missing behavioral check
into `verified`.

## Ledger states

- `planned`: no executable evidence yet; never a release claim.
- `verified`: a real check passed on the current commit with a persisted
  evidence file, positive AND negative check counts, current commit, and
  evidence file recorded.
- `known-gap`: a real check or required corpus failed; the limitation remains
  open.
- `blocked`: required environment, corpus, or dependency was unavailable.

## Scope

M24 is audited through the LSP server surface (`src/lsp/`), the position
mapping and freshness components, the reference client harness, and all
evidence under `validation/m24/`. Gates cover protocol conformance, position
honesty, freshness honesty, latency budgets, mutation resistance, and
documentation truth. Never as `verified`: anything resting only on docs or
issue text.

## Issue order

G1 is the governance prerequisite (M20 #428 pattern). P1 and P2 land before
any L-feature may close (the foundations gate everything). L2–L5 may proceed
in parallel after P1+P2, each with its verifier from V1's harness. X1 closes
last; nothing closes without it.

## Protocol (every issue)

1. Verifier first — script under `script/m24/` that CAN FAIL; no auto-pass.
2. Evidence file `validation/m24/results/<CODE>.json`: currentCommit,
   sourceFingerprint, verifierCommand, evidenceFile, generatedAt, passed,
   failed, negativeCases, limitations — machine-emitted, never hand-edited.
3. Claim levels: features close at I1 (protocol-passed) minimum; I2 requires
   the P1+P2 gates green for that language. I3/I4 (editor/fork) belong to
   M25 and are never claimed here.
4. Latency budgets per contract §3, measured with machine + repo + commit
   recorded. A budget miss is a failed gate.
5. Missing corpus, editor, or dependency = `blocked` with reason, recorded —
   never silently skipped.
6. Closure comment quotes real run output + evidence path.
7. Ledger: `validation/m24/results/manifest.json`; only closed issues require
   clean evidence.

## Completion bar for v0 (M25 may not start until ALL are true)

1. All five launch languages serve hover, definition, references, document
   symbols, workspace symbols, and call hierarchy at I2 with latency budgets
   met (p95, warm).
2. Position-mapping and freshness gates are permanent parts of
   `npm run verify`.
3. Closure gate green, including the contract §6 mutation set.
4. Documentation states claim levels and limitations per contract §1; no
   banned vocabulary in any M24 artifact.
5. Ledger clean: no PENDING cell in any dependency path.

## Negative list (what M24 does NOT claim)

- No editor extension, no OpenVSX publish, no fork claims (M25).
- No graph webview, no cross-language hover UI (M26).
- No claims for languages beyond the five; unlisted languages are declared
  absent, not "coming soon".
- No completion, diagnostics, or rename — ever (complement stance).
- No multi-root workspace claims — single-root is a declared limitation of v0.
- No wall-clock claims beyond measured budgets on the named machine.
