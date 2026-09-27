# M13 — Tool Trust Rebuild: Master Plan

Status: **PROPOSED — awaiting approval. No milestone, issue, or code change has been created from this document.**

This plan is a system-wide trust rebuild for the ten public tools. It exists because the
previous "M12 complete" claim was too broad: it proved fixture-backed behavior, not
AST honesty, mutation safety, or contract truth. This plan defines, per tool, what must
be true before that tool may be called **verified**, and records the measured gaps.

---

## 1. The single contract authority (decision, researched)

**Decision: the executable registry (`TOOL_DESCRIPTORS` / `PUBLIC_TOOL_DESCRIPTORS` in
`src/mcp/tool-registry.ts`) is the single source of truth for the public contract.**

Evidence for this decision (not opinion):

- The MCP server (`src/mcp/server.ts:45`) and the CLI gateway (`src/cli/index.ts:132`)
  both dispatch and validate through this registry via `validateToolArguments`.
- `script/verify-tool-docs.ts` already **generates** `docs/data/public-tools.json` and
  `docs/tools/*.md` from the registry (`generatedFrom: ["src/mcp/tool-registry.ts", ...]`),
  and fails when the generated artifacts are stale.
- The registry is typed and self-validating (`satisfies readonly ToolDescriptor[]` +
  `validateToolDescriptors()` on import).

The two hand-maintained files inside `src/contracts/tool-contracts.ts` are the drift
source, and the drift is exactly the dishonesty we are removing:

| Tool | Registry (executable) | `TARGET_TOOL_CONTRACTS` (aspirational, unshipped) |
| --- | --- | --- |
| bb_ask | `answer` | `answer` **`explain` `feature`** |
| bb_patterns | `orphaned` `all` | `orphaned` **`quality` `architecture`** `all` |
| bb_security | `findings` | `findings` **`flow` `summary` `hotspots`** |
| bb_health | mutability `read` | mutability **`index`** |
| bb_visualize | `project` `file` **`module`** `symbol` `feature` `text` `json` `html` | omits `module`, `text`, `json`, `html` |

Advertising a mode the runtime cannot execute is a false capability claim. The
resolution is mechanical:

1. `TOOL_DESCRIPTORS` remains the human-edited source of truth.
2. `TARGET_TOOL_CONTRACTS` and `CURRENT_MCP_TOOL_CONTRACTS` are **deleted as parallel
   authorities** and replaced by artifacts **generated from the registry**.
3. Any aspirational mode (e.g. `bb_ask explain/feature`) is moved to an explicit
   `plannedModes: string[]` field on the descriptor. `plannedModes` is a roadmap, never
   advertised as executable, and never present in `modes`.
4. A drift test enforces the invariant **registry modes === runtime modes ===
   documented modes === generated contract modes** on every `npm run verify`. Any
   divergence fails the build.
5. The contract `schemaVersion` is bumped on any breaking change, and changes are
   classified as additive (safe) or breaking (gated).

This makes "advertised === executable" a machine-checked invariant, not a hope.

---

## 2. Measured current state

### Tool inventory

| Tool | Mutability | Executable modes | Engine (real) | Verify script today |
| --- | --- | --- | --- | --- |
| bb_search | read | symbols/content/symbol/file | intelligence/search/* | verify-search-modes.ts (M13.01 partial) |
| bb_ask | read | answer | quick-answer + semantic-search | verify-semantic.ts (engine only) |
| bb_health | read | status/refresh | health/health-provider | verify-health.ts + verify-freshness.ts |
| bb_patterns | read | orphaned/all | patterns/orphans.ts **only** | verify-patterns.ts (orphans only) |
| bb_security | read | findings | security/taint + cross-language adapter | verify-security.ts (taint engine only) |
| bb_visualize | read | project/file/module/symbol/feature + text/json/html | visualization/visualization-engine | verify-visualize-migrate.ts |
| bb_migrate | read | plan | migration/migration-engine | verify-visualize-migrate.ts |
| bb_analyze | read | 11 modes | analysis/*, graph, testing/* | verify-analyze/graph/test-intel/test-quality/analysis-history |
| bb_doc | read | 7 modes | documentation/doc-engine | verify-doc.ts + verify-doc-design.ts |
| bb_edit | **write** | write/update/insert/delete/refactor | edit/edit-engine | verify-edit.ts (TS positive only) |

### Confirmed defect register (grounded in source)

- **Contract drift** — §1 table (5 drift points).
- **bb_edit.refactor** is text substitution inside byte spans (`identifierOffsets`),
  not AST reference identity. Reproduced: renames unrelated same-name bindings and
  comment text in Python.
- **bb_edit.codeMask** understands only `' " \` // /* */`, applied to all 41
  languages. Breaks `#` comments, `"""docstrings"""`, heredocs, `--`, `{- -}`, etc.
  **PARTLY STALE (measured on yaml, M14 #286 lane, 2026-09-27).** The premise is out of
  date: `src/ast/safety-primitives.ts` replaced the hand-rolled character scanner with
  `buildSyntaxMask`, which derives comment/string ranges from the **grammar's own**
  `comment`/string nodes. Measured on a yaml file with 4 comment nodes — a trailing
  comment, a `# TODO:` comment naming the symbol to rename, a comment with no space after
  `#` (`#replicas`), and a comment ending mid-token — the mask covered **100% of comment
  bytes, 0 live bytes leaked**, and `extractIdentifierOccurrences` produced **no occurrence
  inside any comment**, so a rename provably cannot reach comment text. The `identifierOffsets`
  half of this bullet is stale **repo-wide**: that function has no definition and no call
  site left in `src/`; it survives only as a word in the file's own header comment. What
  remains unmeasured is every OTHER language on the list, which is the tool owner's claim to
  make, not this lane's.
- **bb_edit refactor is a silent no-op on every YAML symbol** (measured, M14 #286 lane,
  2026-09-27). Same failure class as the stale-caller bullet above — a rename that renames
  nothing and reports completion — but with a different and more total cause. In the yaml
  grammar a mapping key is `block_mapping_pair > flow_node > plain_scalar > string_scalar`,
  and `isIdentifierNodeType` (`src/ast/safety-primitives.ts:118`) accepts only `identifier`,
  `*identifier`, and seven hand-listed per-language types (PHP/Bash/PowerShell/Haskell/Ruby)
  — of which none is a yaml node type. So `extractIdentifierOccurrences` returns **0 for a
  yaml file**, including for the live keys. Consequence, traced through
  `src/intelligence/edit/edit-engine.ts`: `declStart` is `undefined` (line 542), the entire
  in-file reference-rename block is skipped (line 555), no caller span yields a site, and
  `if (sites.size === 0) continue` (line 582) returns
  `{ changes: [], warnings: ["refactor X → Y: 0 site(s) across 0 file(s)"] }` — **no error is
  thrown**. The declaration is never renamed and the call is not refused.
  **Owner action, and it is expressible with data already carried:** a yaml
  `plain_scalar`/`string_scalar` **in key position** is a reference site, and key position is
  exactly what `IdentifierOccurrence.parentField` already records — the yaml grammar's entire
  field surface is 2 fields, `key` and `value`. Renaming by `parentField === "key"` rather than
  by node type would fix the lane without touching the value-position case, which must NOT be
  renamed. A guard that **throws** when a refactor resolves zero sites would convert the whole
  silent-no-op class into a refusal, and is worth more than the yaml entry: no language should
  be able to report a completed rename that changed nothing.

- **bb_edit** cross-file caller spans are not freshness-checked; stale callers are
  silently skipped → partial rename reported as success.
- **bb_edit insert inside-*** requires `{ }` bodies (JS-only).
- **bb_patterns scope=all** emits `framework_pattern_stub` / `anti_pattern_stub` at
  confidence 0.0 (stubs advertised as features).
- **bb_health verbose** is in the schema but never passed to `getUnifiedHealth`.
- **bb_security handler** returns a transformed `CrossLanguageSecurityFindings`
  shape; `verify-security.ts` tests `analyzeTaintFlows` directly, so the adapter and
  handler output are unverified.
- **bb_edit** mode-specific required fields are not enforced at the boundary
  (`validateModeSpecificArguments` handles only `bb_search`/`bb_ask`).
- **Analyzer dependency** — Groovy `scoped_type_identifier` is a confirmed gap, and it
  is the *pattern*, not the exception. Every tool reads the index these analyzers
  build, so analyzer honesty is a hard prerequisite. This is scheduled as the next
  program (per-family analyzer milestones), referenced here, not part of M13.

### Verification vocabulary (no more binary "PASS" overstatement)

| State | Meaning |
| --- | --- |
| `verified` | unit + integration + e2e + corpus adversarial tests pass; evidence recorded |
| `partially-verified` | some layers pass; known gaps remain |
| `known-gap` | confirmed defect, not yet fixed |
| `untested` | no evidence exists |

A tool is `verified` **only** when every layer in its issue set passes and its
evidence file records it. A green positive fixture is never sufficient.

---

## 3. Dependency order

```
Phase 0 — Baseline (B1–B5)
        │
        ├──► bb_edit (write; highest risk; needs AST identity + per-language mask + freshness)
        │
        └──► bb_search → bb_ask → bb_health → bb_patterns → bb_security
             → bb_visualize → bb_migrate → bb_analyze → bb_doc
                    │
                    └──► Analyzer-family milestones (M14+): a hard dependency for full honesty
```

---

## 4. Issue plan (58 issues, a floor not a cap)

Every issue must produce: (a) its own test, (b) a machine-readable evidence file, and
(c) a pass/fail gate. If the baseline audit (§5, B1) finds additional defects, each
becomes a new issue — the total is a **floor**, never reduced.

### Phase 0 — Baseline (5)

- **B1** Contract authority consolidation: single registry truth, delete parallel
  authorities, `plannedModes` for aspirational modes, generated contract artifacts,
  drift test, versioned schema.
- **B2** Shared evidence schema + harness: one per-tool evidence JSON shape; one
  runner that emits it for every tool.
- **B3** Shared adversarial test harness: unit/integration/e2e with negative fixtures
  across language families (no positive-only suites).
- **B4** Shared safety primitives: AST reference-occurrence identity, per-language
  comment/string masking, freshness on every read path.
- **B5** Corpus mapping: map the 29 pinned repos → tools/languages; produce a gap
  register; pin the minimum additional repos to close measured gaps.

### bb_edit (12)

- **E1** Contract: enforce mode-specific required fields (`filePath`, `symbolName`,
  `newContent`, `newName`, `position`, `lineStart`) at the boundary.
- **E2** Refactor identity: replace `identifierOffsets` text-scan with AST reference
  occurrence identity (rename only actual reference sites).
- **E3** Language-aware masking: per-language comment/string rules (not one JS mask).
- **E4** Insert bodies: language-aware body detection (not `{ }`-only).
- **E5** Cross-file caller freshness: freshness-check every caller span; fail loudly,
  never silently skip a stale caller.
- **E6** Atomicity/rollback: verify multi-file rollback on partial failure.
- **E7** Unit tests: positive + adversarial (unrelated same-name binding, comment,
  docstring, heredoc, triple-quote, block comment, interpolation).
- **E8** Integration: edit + index + freshness + reindex consistency.
- **E9** E2E: real MCP session + compiled CLI for all five modes and error paths.
- **E10** Real-repo corpus: dry-run refactor across pinned repos; assert no corruption
  vs. reindex; record pass **and** fail.
- **E11** Honesty audit: prove no text substitution where AST identity is claimed;
  document and justify every remaining regex.
- **E12** Docs + evidence + release gate.

### bb_search (5 — completes M13.01)

- **S1** Mode negatives + freshness on content/regex/symbol/file.
- **S2** E2E: real MCP + compiled CLI for every mode and error path.
- **S3** Real-repo corpus.
- **S4** Honesty audit (AST vs lexical; freshness truthfulness).
- **S5** Docs + evidence + release gate.

### bb_ask (6)

- **A1** Contract: `answer` vs `explain`/`feature`; boundary rejection of empty query.
- **A2** Provenance honesty: `evidenceClass`, `unknowns`, no fabricated claims.
- **A3** Unit/adversarial: empty query, missing index, missing embeddings, model
  mismatch, corrupt vector.
- **A4** Integration: ask + index + embeddings + freshness.
- **A5** E2E + real-repo corpus.
- **A6** Honesty + docs + gate.

### bb_health (6)

- **H1** Mutability contract (`read` vs `index`).
- **H2** Wire `verbose` (schema → `getUnifiedHealth` → output).
- **H3** Integrity 12-point + schema + embedding coverage correctness.
- **H4** Refresh/force failure injection (no silent success).
- **H5** Integration + e2e + corpus.
- **H6** Honesty + docs + gate.

### bb_patterns (5)

- **P1** Contract: `orphaned` vs `all`/`quality`/`architecture`.
- **P2** Remove or implement the `framework_pattern_stub` / `anti_pattern_stub` stubs
  (never advertise a stub as a feature).
- **P3** Orphan detection cross-language negatives (not TS/Py only).
- **P4** Integration + e2e + corpus.
- **P5** Honesty + docs + gate.

### bb_security (4)

- **Sec1** Contract: `findings` vs `flow`/`summary`/`hotspots`.
- **Sec2** Handler adapter end-to-end: `analyzeSecurityAcrossLanguages` →
  `CrossLanguageSecurityFindings` shape, source/sink coverage, no regex-as-AST.
- **Sec3** Unit/integration/e2e/corpus (adversarial taint, cross-language).
- **Sec4** Honesty + docs + gate.

### bb_visualize (4)

- **V1** Contract mode cleanup (`module` vs `text`/`json`/`html`).
- **V2** Node/link fidelity, no dropped edges, truncation correctness.
- **V3** Unit/integration/e2e/corpus.
- **V4** Honesty + docs + gate.

### bb_migrate (3)

- **M1** Mapping accuracy, unsupported cases, no fake translation.
- **M2** Unit/integration/e2e/corpus.
- **M3** Honesty + docs + gate.

### bb_analyze (4)

- **An1** All 11 modes verified with per-mode negatives.
- **An2** Handler↔engine parity for all 11 modes (the handler, not just the engine).
- **An3** Unit/integration/e2e/corpus.
- **An4** Honesty + docs + gate.

### bb_doc (4)

- **D1** Fact classification + citation completeness (no uncited facts).
- **D2** Mode completeness + negatives.
- **D3** Unit/integration/e2e/corpus.
- **D4** Honesty + docs + gate.

**Total: 5 + 12 + 5 + 6 + 6 + 5 + 4 + 4 + 3 + 4 + 4 = 58.**

---

## 5. Corpus grounding

The 29 pinned repositories under `$HOME/fixtures/repositories` are the
starting corpus (JVM, .NET, web, systems, functional, dynamic, data families).
B5 maps each tool to the repos that actually exercise it and records per-language
gaps. Corpus verification must record **both pass and fail**; a report that silently
drops failing files is treated as a failed gate.

---

## 6. Release gate

A tool is `verified` when all of the following hold simultaneously:

1. Its issue set is closed with passing tests (unit, integration, e2e, corpus).
2. Its evidence file is committed and machine-readable.
3. Its honesty audit reports no hidden text substitution where AST identity is
   claimed, and every remaining regex is documented and justified.
4. The contract drift test passes (advertised === executable).
5. Its docs are generated from the registry (no hand drift).

The system as a whole is complete only when all ten tools are `verified` **and** the
analyzer-family program (M14+) has established analyzer honesty, since every tool
depends on the index those analyzers build.

---

## 7. What is NOT claimed here

This plan does not claim any tool is currently complete. `bb_search` has one landed
commit (M13.01) that is a narrow, honest first step and will be folded into the S1–S5
set. The other nine tools remain `untested` or `known-gap` until their issue sets pass.
