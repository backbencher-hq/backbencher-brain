# Phase 0 — Honesty Demotion & Matrix Contract

## Objective
Demote `bb_security` from "security scan" to explicit lead-generator; add per-language security tier (scan|leads|unsupported) to the language-tool matrix; invert gates so known false positives fail. All changes must be evidence-backed and read-only until the contract is finalized.

## Scope
- `src/mcp/tools/bb_security/handler.ts` — banner, tier declaration, no `confirmed`/`critical` on leads
- `src/mcp/tools/bb_security/descriptor.ts` — wording, categories, defaults
- `src/cli/onboard.ts` — remove "find taint flows and injection findings" line
- `script/verify-language-tool-matrix.ts` — add per-language security tier check with fail conditions
- `validation/languages/results/tool-matrix.json` — new `securityTier` field per row
- `docs/tools/bb_security.md`, `docs/BB_SECURITY.md` — honest limitations first
- Gates: precision gate inverted; real-corpus negative must fail; matrix tier check

## Evidence Requirements
Every change must cite the exact file:line and the measured defect it addresses (from the 16% precision audit, 88% SQLi no-SQL, cross-language false positives, etc.).

## Read-Only Phase
All design is documented here and in the issue tracker. No `bb_edit`, no `bb_index`, no destructive git. Implementation starts only after this document is reviewed and the contract signed off.

## Acceptance Criteria
1. `bb_security {}` answer starts with banner: "lexical token co-occurrence — not data flow; not a vulnerability finding"
2. Every language row in matrix has `securityTier: "scan"|"leads"|"unsupported"`; `unsupported` answer says "not scanned"
3. Precision gate: the `parameterized-sql-negative` case fails (or the gate is replaced)
4. Matrix check for `bb_security` is per-language, not project-wide crash test
5. No `confirmed`/`critical` vocabulary in leads/unsupported tiers
6. All changes cite the defect lines they fix (taint-analyzer.ts, parallel-indexer.ts, etc.)
