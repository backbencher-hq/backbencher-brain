# M72 — bb_security rebuild: evidence-honest, per-language security

**Status:** active milestone. Supersedes `docs/m48/SECURITY-PRECISION-PROPOSAL.md` (proposal, never implemented).
**Goal:** replace the generic token co-occurrence detector with a spec-driven, per-language security engine whose claims are measured; cover every analyzer this repository offers with an explicit tier; make the public claim match the matrix.

## 1. Why (measured, not asserted)

- The current detector pairs **every** source token with **every** sink token in a symbol body (`src/ast/parallel-indexer.ts:4792-4822`), labels the pair `confirmed` when both symbol ids resolve (`src/intelligence/security/taint.ts:228-241`), and hardcodes `critical` for sql/command sinks (`parallel-indexer.ts:4801-4804`).
- The repository's own review measured **16.0% precision** on a lenient proxy and wrote: "This repository has no SQL injection. A security tool that reports 817 criticals on it... is a tool that gets ignored — or, worse, one that gets trusted." (`docs/m48/SECURITY-PRECISION-PROPOSAL.md:16-26`)
- 88% of confirmed SQL injection rows on this repository's index have no SQL keyword in the symbol body; `.exec()`, `.Query()`, `execute`, `className`, `fopen("/constant")`, comments and test files all produce criticals.
- Coverage is not what the docs claim: 31 of 53 matrix languages run taint at all, 22 run none, and only TypeScript has AST-level source/sink extraction.
- The public surface still sells it as a scanner: descriptor (`src/mcp/tools/bb_security/descriptor.ts`), website tool page (Shield icon), npm 0.1.3, and `bb onboard` writing "find taint flows and injection findings" into user projects.

## 2. Phases and acceptance

### Phase 0 — honesty demotion (in progress)
- `bb_security` answers with a first-line banner and a tier declaration; `confirmed`/`critical` vocabulary is gone from the lead path.
- Per-language tier registry: `src/intelligence/security/rebuild/registry.ts` (`scan | leads | unsupported`), covering all 53 matrix languages.
- Language × tool matrix gets a per-language `securityTier` check; an unsupported language must answer "not scanned" (never a clean-looking zero); a leads language must carry the banner.
- Precision gate inverted: known false positives fail; the `parameterized-sql-negative` real-corpus case must no longer pass.
- Descriptor/docs/website/onboard wording matches the engine (lead generator, not scanner).

### Phase 1 — engine replacement (next)
- `src/intelligence/security/rebuild/` replaces `src/ast/taint-analyzer.ts` in the parse pipeline:
  - `spec-types.ts` (contract), `specs/<language>.ts` (source/sink/sanitizer rules + lexical syntax), `matcher.ts` (comment/string masking, token matches), `flow.ts` (dynamic-argument, assignment reachability, self-pair rejection, sanitizer/parameterized checks), `engine.ts` (per-symbol leads with evidence).
  - No source×sink cartesian product. A pair is emitted only when the sink argument is dynamic and reaches a source expression in the same symbol; constant arguments, comment text, self-token pairs, test-file symbols and sanitized/parameterized sinks are excluded.
  - Conservative severity: rule-defined, never token-class-only; `critical` requires code/command execution with dynamic external input and no sanitizer.
- New persisted store `brain_security_flow` (stable id, evidence JSON, rule id, tier, source/sink offsets); old `brain_taint_flow` stops being written by the new path and is ignored by the answer. Stale rows are deleted per reindexed file; ids do not embed line numbers.
- Answer includes tier counts, supported-language list, engine/rules version, evidence, and pagination (`limit`/`offset` for leads; history stays a page).
- Cross-symbol stitching is removed until a real call/argument edge is modelled; the `crossLanguage` flag is not set by adjacency.

### Phase 2 — all-language coverage and trust
- Specs + fixtures for all 36 code languages (18 per spec owner), plus explicit `unsupported` entries with reasons for the 17 data/config/schema languages.
- Per-language fixture gate: vulnerable/clean/sanitized cases must produce the expected lead/empty result; a regression fails the language row.
- CVE-fix oracle for scan-tier languages: precision/recall measured, published per language; only `scan` languages carry vulnerability vocabulary.
- Matrix and docs/website/npm claims generated from the same registry, so the public claim cannot drift from the measurement.

## 3. Tiers

- `scan`: real rules + reachability + fixtures + oracle passing; vulnerability vocabulary allowed; `bb_security` may call the result a finding.
- `leads`: lexical rules only, no reachability proof; banner + no severity claim; the result is a lead, never a finding.
- `unsupported`: no executable source/sink model (data/markup/schema/config); the answer must say "not scanned by bb_security" — never return a clean zero.

Initial registry: all 36 code languages = `leads`; 17 data/config/schema languages = `unsupported`; promotion to `scan` only after Phase 2 gates pass per language.

## 4. Architecture (Phase 1)

```
pool-worker parse
  └─ rebuild/engine.ts        (per symbol: spec lookup → matcher → flow → evidence)
       └─ symbol.securityFlows (new optional field)
parallel-indexer store
  └─ brain_security_flow      (delete-by-file, insert; stable id; evidence JSON)
bb_security handler
  └─ store query by project + tier → answer (banner, tiers, evidence, pages)
```

Spec shape (frozen contract): see `src/intelligence/security/rebuild/spec-types.ts`.
- `LanguageSecuritySpec` carries `language`, `tier`, `tierReason`, lexical comment/string syntax, `sources`, `sinks`, `sanitizers`, `limits`.
- `SinkRule` carries `vulnerability`, `severity`, argument selector, `requiresDynamicArgument`; a sink with a constant argument is never a lead.
- `SanitizerRule` covers parameterized/placeholder queries, escaping, prepared statements; a sanitized sink is excluded or downgraded to `mitigated` evidence.

Non-goals for Phase 1: external SAST engine integration; cross-symbol dataflow; framework-specific rules beyond the spec table; CVE corpus (Phase 2).

## 5. Workstreams and write scopes

| Workstream | Owner | Scope (advisory) |
|---|---|---|
| Plan, spec contract, tier registry, integration review | Lead | `docs/m72-security-rebuild/**`, `src/intelligence/security/rebuild/spec-types.ts`, `registry.ts`, `specs/index.ts` |
| Engine core (matcher, flow, engine, unit tests) | engine-core | `src/intelligence/security/rebuild/{matcher,flow,engine}.ts`, `script/m72/engine/**` |
| Store + pipeline (new table, stale deletion, wiring, old path retirement) | pipeline-store | `src/ast/pool-worker.ts` taint stage, `src/ast/parallel-indexer.ts` taint blocks, `src/brain/schema-ddl.ts`, `src/brain/brain.sql.ts`, `src/intelligence/security/rebuild/store.ts` |
| Answer surface (handler, descriptor, docs/website/onboard) | answer-claims | `src/mcp/tools/bb_security/**`, `src/security/cross-language-security.ts`, `src/intelligence/security/taint.ts`, `docs/tools/bb_security.md`, `docs/BB_SECURITY.md`, `src/cli/onboard.ts`, website tool data |
| Matrix + gates (per-language tier check, new m72 gates, oracle harness) | gates-matrix | `script/verify-language-tool-matrix.ts`, `script/m72/**`, `validation/languages/results/**`, `validation/m72/**` |
| Language specs A (18 code languages) | specs-a | `src/intelligence/security/rebuild/specs/<lang>.ts`, `validation/m72/fixtures/<lang>/**` |
| Language specs B (18 code languages) | specs-b | same, disjoint languages |

Language assignment is recorded in `docs/m72-security-rebuild/LANGUAGES.md`; one language has one owner (standing rule), and the ledger is the durable brief for a restarted owner.

## 6. Verification

- `npx tsx script/m72/verify-security-engine.ts` — matcher/flow unit matrix (self-pair, comment/string, constant argument, sanitizer, reachability).
- `npx tsx script/m72/verify-security-store.ts` — stable ids, delete-on-reindex, no stale rows, tier column.
- `npx tsx script/m72/verify-security-answer.ts` — banner, tier declaration, unsupported = "not scanned", pagination/evidence.
- `npx tsx script/m72/verify-security-matrix.ts` — one row per language with tier contract; unsupported cannot pass clean.
- `npx tsx script/verify-language-tool-matrix.ts` — the repo-wide matrix with the new security axis.
- `npx tsc --noEmit` for the touched trees; `npm run verify:security` only after legacy gates are updated.

## 7. Rules

- Read-only tools stay read-only; `recordRun` remains the only write.
- No destructive git commands in the shared checkout (commit ids only for reverts).
- No agent attribution in commits.
- Every claim in docs/answers must be generated from, or checked against, the registry/matrix; no hand-written capability claims.

---

## Amendment (Phase 2c, 2026-11-13) — the baseline above is history

Sections 3 and 4 state the Phase-0/2a baseline: **36 code languages at `leads`, 17 at
`unsupported`**. That baseline is superseded and is kept only as a record of where the
milestone started. The measured current state is:

```
53 analyzers  /  0 scan  /  39 leads  /  14 unsupported
```

Two changes moved it, both measured rather than asserted:

- **svelte + vue** `unsupported` → `leads`: `pool-worker.ts` already extracts their
  `<script>` blocks as JS-family symbols, so 6,147 `.svelte` + 1,155 `.vue` files were
  indexed and never scanned. (`specs/{svelte,vue}.ts`, `specs/component-specs.ts`.)
- **make** `unsupported` → `leads`: the reason recorded here ("build recipes are shell
  text; make is not parsed as an execution context") was **false**. The parser emits a
  `function` symbol per recipe whose body is real shell, so `$(VAR)` → `sh -c` is command
  injection. (`specs/make.ts`, `specs/build-specs.ts`; evidence in `COVERAGE.md`.)

The remaining 14 are `unsupported` on measured evidence: their analyzers emit data/config
nodes (property, module, variable) or schema declarations with no body — no executable
source→sink surface. See `COVERAGE.md` for the per-language table.

`src/mcp/tools/bb_security/handler.ts` therefore prints `0 scan / 39 leads / 14 unsupported`
from `formatSecurityTierDeclaration()`, not the 36/17 this plan recorded.
