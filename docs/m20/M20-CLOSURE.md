# M20 Closure — Niche Intelligence Tools Correctness & Trust

Status: **closable** (all 16 non-closure issues carry final persisted evidence;
governance C1 verified; this artifact and the C3 verifier document the closure
audit).

Authority: this file is the closure artifact required by M20.C3 (#444). The
executable authority is `script/m20/verify-governance.ts` (C1) and
`script/m20/verify-closure-C3.ts` (C3). Per-tool docs and this summary cannot
upgrade a failed or missing behavioral check.

## Final ledger summary

Source of truth: `validation/m20/results/manifest.json`. Every non-closure
issue has a persisted evidence record in `validation/m20/results/*.json`
(with a matching ledger entry) that re-reads clean at the current commit and
reports zero failed checks. Statuses:

| Code | Issue | Status | Checks / negatives |
|------|-------|--------|--------------------|
| C1 | governance + closure gate | verified | 15 / 5 |
| C2 | corpus identity & availability | verified | 20 / 3 |
| M1 | migration ordering | verified | 13 / 3 |
| M2 | migration methodology | verified | 17 / 3 |
| M3 | migration unsupported cases / mappings | verified | 15 / 5 |
| P1 | patterns parameter-complete scans | verified | 6 / 1 |
| P2 | patterns orphan semantics | verified | 6 / 1 |
| P3 | patterns pagination + history | verified | 8 / 1 |
| S1 | security flow / source-sink evidence | verified | 8 / 3 |
| S2 | security adversarial + heuristic boundary | verified | 21 / 7 |
| S3 | security history-state persistence | verified | 13 / 3 |
| D1 | bb_doc mode/option contract | verified | 24 / 1 |
| D2 | bb_doc citation resolution + freshness | verified | 10 / 3 |
| D3 | bb_doc examples + diagrams honesty | verified | 10 / 3 |
| X1 | cross-tool engine/handler/CLI/MCP parity | verified | 12 / 4 |
| X2 | real repositories + complexity ledger | verified | 12 / 1 |
| C3 | final closure audit (this verifier) | verified by run | see `C3.json` |

## Unresolved claims (honest, not hidden)

1. **Active checkout state (C2).** Three declared active checkouts do not match
   their pinned revisions and five are locally dirty. They were not mutated.
   C2 uses six immutable Git-archive snapshots, extracted from the exact pinned
   local Git objects, with sidecars proving source, ID, revision, archive format,
   tracked-file count, and deterministic content digest. The active checkout
   state remains visible in `C2-registry.json`; the snapshot-backed corpus is
   now evidence-eligible. The extra local repositories in `$HOME/` and
   `$HOME/fixtures/repositories` are preserved separately.
2. **Security sink classification is heuristic.** `bb_security` produces
   findings for sinks that are written with parameterized/escaped queries
   (e.g. SQL where the data flow is not literally concatenated). The tool
   reports the flow; the docs (`docs/BB_SECURITY.md`) state that parameterized
   or escaped sinks may still be flagged. This is a documented limitation, not
   a shipped "exploit-proof" guarantee.
3. **Pattern observability is syntax/AST-scoped.** Orphan and framework
   detection cannot observe dynamic, reflection, or configuration-driven
   wiring. The analyzers return syntax/AST-derived candidates; heuristic
   observations are labelled as such and never presented as runtime proof.
4. **Source vs. inferred separation is explicit.** Tool docs differentiate
   AST-derived facts from heuristic observations; none of the M20 tools claims
   analyzer completeness for the full source-graph challenge that M14 owns.

## Dependency list (M14 analyzer work owned by the co-agent)

M20 verifies the *tools* (migrate, patterns, security, doc) under the current
analyzer surface. The correctness of symbol extraction, relationship
resolution, and cross-language grammar coverage is owned by the M14 analyzer
milestone being run by the co-agent and is **not** re-verified here. Concretely:

- Migration (`bb_migrate`) orders and maps against relationship/dependency
  rows produced by the analyzers.
- Patterns (`bb_patterns`) classifies candidates from symbol/relationship data.
- Security (`bb_security`) builds source/sink flows from parsed occurrences and
  relationship edges.
- Documentation (`bb_doc`) cites resolved symbols and relationship-resolved
  references.

If M14 changes any of those analyzer outputs, the M20 evidence must be
re-run — the fingerprint gates in `src/intelligence/{migration,patterns,
security,documentation}/evidence.ts` encode those exact source boundaries so a
tool-source change invalidates the corresponding evidence automatically.

## Gate output

The final committed gate state:

- `bun run script/m20/verify-governance.ts` → **C1: VERIFIED (15/15, 5 negative)**
- `bun run script/m20/verify-corpus-registry.ts` → **C2: VERIFIED (20/20, 3 negative)**; all 30 declared rows are exact and clean as evidence sources, including six immutable snapshots for active checkouts
- `bun run script/m20/verify-closure-C3.ts` → **C3: VERIFIED** when C1 is current (see `C3.json`)
- `bunx tsc --noEmit` → passes
- Each tool verifier wired into `package.json` `verify` chain passes with the
  persisted evidence records above.