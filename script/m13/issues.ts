// script/m13/issues.ts — M13 tool-trust issue minting.
//
// Single source of truth for the 58 M13 issues. Two modes:
//   bun script/m13/issues.ts --plan     # write plans/M13-issues.json (no issue numbers)
//   bun script/m13/issues.ts --create   # create milestone + label + 58 issues, then write
//                                       # plans/M13-issues.json WITH issue numbers
//
// Idempotent: skips the milestone/label if they already exist, and reuses existing
// issues by title if a previous run was interrupted (so a partial run is resumable).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const REPO = "backbencher-hq/backbencher-brain"
const MILESTONE_TITLE = "M13: Tool Trust Rebuild"
const MILESTONE_DESC = "Tool-by-tool trust rebuild: contract authority, honest AST behavior, mutation safety, adversarial tests, real-repo corpus evidence, and release gates for the ten public tools. Scope is the tool surface; analyzer-family honesty is the follow-on program (M14+)."
const LABEL_NAME = "m13-tool-trust"
const LABEL_DESC = "M13 tool trust rebuild program"
const LABEL_COLOR = "1D76DB"
const PLAN_PATH = "plans/M13-issues.json"

type Issue = {
  id: string // M13.XX
  code: string // B1, E1, S1, ...
  tool: string // baseline | bb_edit | bb_search | ...
  priority: string
  title: string
  goal: string
  acceptance: string[]
  evidence?: string
}

function bodyOf(issue: Issue): string {
  const toolLine = issue.tool === "baseline" ? "Cross-cutting baseline" : `Tool: \`${issue.tool}\``
  const evidence = issue.evidence ?? "tests in `script/` + machine-readable evidence in `validation/m13/results/`"
  return [
    `## Scope`,
    toolLine,
    ``,
    `## Goal`,
    issue.goal,
    ``,
    `## Acceptance criteria`,
    ...issue.acceptance.map((a) => `- [ ] ${a}`),
    ``,
    `## Evidence required`,
    `- ${evidence}`,
    `- evidence JSON: \`validation/m13/results/${issue.code.toLowerCase()}.json\` (schemaVersion 1)`,
    ``,
    `## Definition of done`,
    `All criteria pass; evidence committed; gate wired into \`npm run verify\`. Targets \`verified\` for this unit only — not a claim about any other tool or the analyzers.`,
  ].join("\n")
}

const ISSUES: Issue[] = [
  // ── Phase 0 · Baseline ──────────────────────────────────────────────
  { id: "M13.01", code: "B1", tool: "baseline", priority: "p0-critical",
    title: "Contract authority: single executable-registry source of truth",
    goal: "Make TOOL_DESCRIPTORS the sole public-contract authority; delete the hand-maintained parallel authorities and make advertised modes equal executable modes, mechanically.",
    acceptance: [
      "Delete or regenerate CURRENT_MCP_TOOL_CONTRACTS and TARGET_TOOL_CONTRACTS so they are derived from the registry, not hand-maintained",
      "Move aspirational modes (bb_ask explain/feature, bb_patterns quality/architecture, bb_security flow/summary/hotspots) to an explicit plannedModes field, never into executable modes",
      "Resolve bb_health mutability (read vs index) and bb_visualize mode-set drift to one truth",
      "Add a drift test that fails when registry modes !== runtime modes !== documented modes !== generated contract modes",
      "Bump/annotate schemaVersion semantics for additive vs breaking changes",
    ],
    evidence: "`script/verify-contracts.ts`, `script/verify-contract-diff.ts`, `script/verify-tool-docs.ts`; generated `docs/data/public-tools.json`",
  },
  { id: "M13.02", code: "B2", tool: "baseline", priority: "p1-high",
    title: "Shared machine-readable evidence schema + harness",
    goal: "Define one per-tool evidence JSON schema and one harness that emits it, so 'verified' has a single machine-checkable definition across all ten tools.",
    acceptance: [
      "Define a single evidence JSON schema (schemaVersion, tool, layers covered, pass/fail per check, limitations, timestamp, commit)",
      "Provide a shared emit function every tool verifier uses",
      "Wire evidence emission into each tool's verify script",
      "Add a validator that rejects evidence missing required fields",
    ],
  },
  { id: "M13.03", code: "B3", tool: "baseline", priority: "p1-high",
    title: "Shared adversarial test harness (unit/integration/e2e, negative fixtures)",
    goal: "Provide one harness for unit, integration, and e2e layers that REQUIRES negative fixtures — no positive-only suites.",
    acceptance: [
      "Harness supports unit, integration, and e2e layers with a shared check/rejects API",
      "Every tool must register at least one negative case per mode before it can be marked verified",
      "E2E layer drives the real MCP stdio server and the compiled Node CLI (not just engine imports)",
      "Harness records pass AND fail; a silently-skipped case counts as failure",
    ],
  },
  { id: "M13.04", code: "B4", tool: "baseline", priority: "p1-high",
    title: "Shared safety primitives: AST reference identity, per-language masking, freshness",
    goal: "Build the three primitives bb_edit (and every read tool) depends on: AST reference-occurrence identity, per-language comment/string masking, and freshness on every read path.",
    acceptance: [
      "AST reference occurrence extraction returns identity-tagged reference sites, not raw-text substring matches",
      "Per-language comment/string mask covers every shipped language family (not one JS/C mask)",
      "Freshness is applied on every symbol/relationship/file read path, not just the target symbol",
      "Primitives are unit-tested independently before any tool consumes them",
    ],
  },
  { id: "M13.05", code: "B5", tool: "baseline", priority: "p1-high",
    title: "Corpus mapping: 29 pinned repos -> tools/languages + gap register",
    goal: "Map the 29 repos under ~/fixtures/repositories to the tools and languages each actually exercises; record gaps; pin the minimum additional repos to close measured gaps.",
    acceptance: [
      "Produce a checked-in tool x repository coverage matrix",
      "Record, per tool, which languages have zero real-repo coverage",
      "Record pass AND fail (no silent exclusion) as the corpus definition",
      "Pin the minimum additional repos required to close measured language gaps",
    ],
  },

  // ── bb_edit ─────────────────────────────────────────────────────────
  { id: "M13.06", code: "E1", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: enforce mode-specific required fields at the boundary",
    goal: "Reject invalid requests at validateToolArguments (MCP + CLI), not later inside the handler.",
    acceptance: [
      "write requires filePath; update/delete/refactor require symbolName (+ newContent/newName); insert requires targetSymbolName; position enum enforced",
      "Unknown/mode-irrelevant fields rejected per mode",
      "Same validation path exercised by both MCP and compiled CLI",
    ],
  },
  { id: "M13.07", code: "E2", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: AST reference-identity rename (replace text substitution)",
    goal: "Refactor renames only actual AST reference occurrences of the target symbol, never unrelated same-name bindings or comment/string text.",
    acceptance: [
      "Replace identifierOffsets raw-text scanning with AST reference occurrence identity",
      "Unrelated same-name local/parameter/other-object method is NOT renamed (Python + TS + one more language)",
      "Reference occurrence ranges come from the index relationship/byte evidence, freshness-checked",
    ],
  },
  { id: "M13.08", code: "E3", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: per-language comment/string masking",
    goal: "Replace the JS/C-only codeMask with per-language syntax awareness so comments and strings are never treated as live identifiers.",
    acceptance: [
      "Covers # comments, triple-quoted strings, heredocs, --, {- -}, --[[ ]], and per-language quoting",
      "Adversarial fixtures per language family (Python, Ruby, Bash, Haskell, Lua, PowerShell, YAML, SQL, ...)",
      "No identifier inside a recognized comment/string is rewritten",
    ],
  },
  { id: "M13.09", code: "E4", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: language-aware insert body detection",
    goal: "inside-top/inside-bottom work for languages without brace bodies (Python indentation, Ruby do/end, Haskell layout, YAML, etc.), not { } only.",
    acceptance: [
      "Body detection is language-aware, not a { } scan",
      "Unsupported-body languages fail loudly with a clear error, never silently no-op",
      "Fixture coverage across brace, indentation, and keyword-terminated bodies",
    ],
  },
  { id: "M13.10", code: "E5", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: cross-file caller freshness (fail loud, no silent partial)",
    goal: "Every caller span must be freshness-checked; a stale caller must abort the operation, never be silently skipped.",
    acceptance: [
      "Freshness-check every caller file/span before applying any rename",
      "Stale caller aborts with an error naming the stale file; no partial rename reported as success",
      "Reproduce the known 'shrink caller file -> declaration renamed, caller skipped, success' bug and assert it is gone",
    ],
  },
  { id: "M13.11", code: "E6", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: atomicity and multi-file rollback",
    goal: "Prove a multi-file edit that fails mid-way rolls back every file to its snapshot.",
    acceptance: [
      "Inject a failure after the first write in a multi-file refactor; assert all files restored",
      "Atomic temp-write + rename preserves existing files on failure",
      "No .bb-edit-* temp files leak on failure or success",
    ],
  },
  { id: "M13.12", code: "E7", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: adversarial unit tests",
    goal: "Unit coverage of every mode with negative cases (not just the TS positive fixture).",
    acceptance: [
      "Per-mode positive + negative cases (write/update/insert/delete/refactor)",
      "Negatives: unrelated same-name binding, comment, docstring, heredoc, triple-quote, block comment, interpolation, ambiguous symbol, stale bounds, path/symlink escape",
      "No assertion is a no-op; each check verifies a specific behavior",
    ],
  },
  { id: "M13.13", code: "E8", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: integration tests (edit + index + freshness + reindex)",
    goal: "Prove edit, index freshness, and reindex form a consistent loop across languages.",
    acceptance: [
      "After a successful edit, the index reflects the new content (reindexed, fresh)",
      "A failed edit leaves the index unchanged and consistent",
      "Cross-language fixture (at least TS + Python + one more) exercises the full loop",
    ],
  },
  { id: "M13.14", code: "E9", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: e2e (real MCP + compiled CLI, all five modes)",
    goal: "Exercise all five modes and their error paths through the real MCP stdio server and the compiled Node CLI.",
    acceptance: [
      "Each mode invoked through MCP and compiled CLI",
      "Each error path (missing field, ambiguous, stale, escape, invalid) surfaces correctly",
      "Dry-run performs zero writes in both transports",
    ],
  },
  { id: "M13.15", code: "E10", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: real-repo corpus dry-run (no corruption)",
    goal: "Run refactor dry-runs across the pinned corpus and prove zero unintended mutation; record pass AND fail honestly.",
    acceptance: [
      "Dry-run refactor across repos never writes and reports exact before/after",
      "A reindex after each dry-run yields identical symbols/relationships (no corruption)",
      "Any failing file is recorded, not excluded",
    ],
  },
  { id: "M13.16", code: "E11", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: honesty audit (AST vs text/regex)",
    goal: "Prove no text substitution remains where AST identity is claimed, and document/justify every remaining regex.",
    acceptance: [
      "Enumerate every regex/text operation in the edit path with a justification",
      "Rename path uses AST identity; mask path uses language-aware rules",
      "Audit output is committed as evidence",
    ],
  },
  { id: "M13.17", code: "E12", tool: "bb_edit", priority: "p1-high",
    title: "bb_edit: docs + evidence + release gate",
    goal: "Document the true edit contract and lock the release gate.",
    acceptance: [
      "docs/tools/bb_edit.md regenerated from the registry and accurate",
      "Evidence JSON committed and passing",
      "Release gate blocks 'verified' unless E1-E11 all pass",
    ],
  },

  // ── bb_search ───────────────────────────────────────────────────────
  { id: "M13.18", code: "S1", tool: "bb_search", priority: "p2-medium",
    title: "bb_search: mode negatives + freshness on all modes",
    goal: "Complete M13.01 with adversarial negatives and freshness across symbols/content/symbol/file modes.",
    acceptance: [
      "Empty query rejected per mode; invalid regex rejected; file traversal rejected",
      "Freshness/stale flags correct on symbols, content, and file modes",
      "Content vs symbol vs regex vs file semantics verified distinctly",
    ],
  },
  { id: "M13.19", code: "S2", tool: "bb_search", priority: "p2-medium",
    title: "bb_search: e2e (real MCP + compiled CLI)",
    goal: "Verify every mode and error path through both public transports.",
    acceptance: [
      "Each of symbols/content/symbol/file exercised via MCP and compiled CLI",
      "Each error path surfaces correctly in both transports",
    ],
  },
  { id: "M13.20", code: "S3", tool: "bb_search", priority: "p2-medium",
    title: "bb_search: real-repo corpus",
    goal: "Run search across the pinned corpus; record pass and fail, verify freshness and pagination on real files.",
    acceptance: [
      "Search correctness sampled across repos and languages",
      "Failures recorded, not excluded",
      "No result is returned as fresh when the file is stale",
    ],
  },
  { id: "M13.21", code: "S4", tool: "bb_search", priority: "p2-medium",
    title: "bb_search: honesty audit (AST vs lexical; freshness truthfulness)",
    goal: "Prove search advertises lexical/indexed retrieval honestly and freshness is truthful.",
    acceptance: [
      "Document exactly what each mode searches (index, not raw AST traversal where applicable)",
      "Verify no result claims source that is not indexed",
      "Audit committed as evidence",
    ],
  },
  { id: "M13.22", code: "S5", tool: "bb_search", priority: "p2-medium",
    title: "bb_search: docs + evidence + release gate",
    goal: "Finalize bb_search documentation and lock its release gate.",
    acceptance: [
      "docs/tools/bb_search.md + docs/BB_SEARCH.md accurate and regenerated",
      "Evidence JSON committed and passing",
      "Release gate blocks 'verified' unless S1-S4 pass",
    ],
  },

  // ── bb_ask ──────────────────────────────────────────────────────────
  { id: "M13.23", code: "A1", tool: "bb_ask", priority: "p2-medium",
    title: "bb_ask: contract (answer vs explain/feature) + empty-query boundary",
    goal: "Resolve mode drift and enforce empty-query rejection at the boundary.",
    acceptance: [
      "Executable modes = [answer]; explain/feature moved to plannedModes or removed",
      "Empty query rejected at validateToolArguments (MCP + CLI)",
    ],
  },
  { id: "M13.24", code: "A2", tool: "bb_ask", priority: "p2-medium",
    title: "bb_ask: provenance honesty (no fabricated claims)",
    goal: "Every answer carries evidenceClass, engine, unknowns, and never fabricates a claim from an empty/no-match state.",
    acceptance: [
      "Provenance block always present and truthful",
      "No-match / no-embeddings path returns an explicit unknown, not a generated answer",
      "Generated explanation is labeled interpretation, not extracted evidence",
    ],
  },
  { id: "M13.25", code: "A3", tool: "bb_ask", priority: "p2-medium",
    title: "bb_ask: adversarial unit tests",
    goal: "Unit/adversarial coverage: empty query, missing index, missing embeddings, model mismatch, corrupt vector.",
    acceptance: [
      "Each negative case asserted (empty, no index, no embeddings, model mismatch, corrupt vector)",
      "No NaN similarities, no crash on corrupt rows",
    ],
  },
  { id: "M13.26", code: "A4", tool: "bb_ask", priority: "p2-medium",
    title: "bb_ask: integration (ask + index + embeddings + freshness)",
    goal: "Prove the ask path integrates index + embeddings + freshness correctly.",
    acceptance: [
      "Answers resolve to indexed symbols with correct freshness",
      "Stale source is flagged, not presented as current",
      "Vector/keyword fallback paths both verified",
    ],
  },
  { id: "M13.27", code: "A5", tool: "bb_ask", priority: "p2-medium",
    title: "bb_ask: e2e + real-repo corpus",
    goal: "Drive bb_ask through MCP and CLI, and sample it across the corpus.",
    acceptance: [
      "bb_ask exercised via MCP and compiled CLI",
      "Corpus samples return provenance-bearing answers; failures recorded",
    ],
  },
  { id: "M13.28", code: "A6", tool: "bb_ask", priority: "p2-medium",
    title: "bb_ask: honesty + docs + release gate",
    goal: "Document bb_ask's true capabilities and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless A1-A5 pass",
    ],
  },

  // ── bb_health ───────────────────────────────────────────────────────
  { id: "M13.29", code: "H1", tool: "bb_health", priority: "p2-medium",
    title: "bb_health: mutability contract (read vs index)",
    goal: "Resolve the read/index mutability drift to one truth across registry and generated docs.",
    acceptance: [
      "Single mutability value across registry, contract, and docs",
      "refresh/force documented as explicit index mutation, not implicit",
    ],
  },
  { id: "M13.30", code: "H2", tool: "bb_health", priority: "p2-medium",
    title: "bb_health: wire verbose (schema -> provider -> output)",
    goal: "The advertised verbose flag must actually change output (per-language breakdown, stale/missing file names).",
    acceptance: [
      "verbose is represented in UnifiedHealthOptions and passed to the provider",
      "verbose=true returns the advertised breakdown; verbose=false does not",
    ],
  },
  { id: "M13.31", code: "H3", tool: "bb_health", priority: "p2-medium",
    title: "bb_health: integrity + schema + embedding coverage",
    goal: "Verify the 12-point integrity check, schema version, and embedding coverage report truthfully.",
    acceptance: [
      "Integrity check reports each of its 12 points with correct pass/fail",
      "Schema version reflects the actual database schema",
      "Embedding coverage reflects stored state, not semantic quality claims",
    ],
  },
  { id: "M13.32", code: "H4", tool: "bb_health", priority: "p2-medium",
    title: "bb_health: refresh/force failure injection",
    goal: "Refresh/force must never report success on failure.",
    acceptance: [
      "Injected refresh failure surfaces as an error, not a passing report",
      "force reindex verifiably reindexes before reporting",
      "wait=false does not present an incomplete refresh as complete",
    ],
  },
  { id: "M13.33", code: "H5", tool: "bb_health", priority: "p2-medium",
    title: "bb_health: integration + e2e + corpus",
    goal: "Prove health across the full loop and real repos.",
    acceptance: [
      "Sampled vs complete freshness both correct",
      "e2e via MCP and compiled CLI",
      "Corpus health reports are internally consistent; failures recorded",
    ],
  },
  { id: "M13.34", code: "H6", tool: "bb_health", priority: "p2-medium",
    title: "bb_health: honesty + docs + release gate",
    goal: "Document health's true contract and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless H1-H5 pass",
    ],
  },

  // ── bb_patterns ─────────────────────────────────────────────────────
  { id: "M13.35", code: "P1", tool: "bb_patterns", priority: "p2-medium",
    title: "bb_patterns: contract (orphaned vs all/quality/architecture)",
    goal: "Resolve mode drift; never advertise quality/architecture unless implemented.",
    acceptance: [
      "Executable modes match reality; quality/architecture moved to plannedModes or removed",
    ],
  },
  { id: "M13.36", code: "P2", tool: "bb_patterns", priority: "p2-medium",
    title: "bb_patterns: remove or implement framework/anti-pattern stubs",
    goal: "scope=all must not emit framework_pattern_stub/anti_pattern_stub at confidence 0.0 as if they were findings.",
    acceptance: [
      "Implement real framework/anti-pattern rules OR remove those scopes entirely",
      "No zero-confidence stub is ever returned to the user",
      "Handler and engine agree on what scope=all returns",
    ],
  },
  { id: "M13.37", code: "P3", tool: "bb_patterns", priority: "p2-medium",
    title: "bb_patterns: cross-language orphan negatives",
    goal: "Orphan detection verified across languages (not TS/Py only), with false-positive negatives.",
    acceptance: [
      "Used symbols across multiple languages are NOT flagged",
      "Orphan positives verified beyond TypeScript/Python",
    ],
  },
  { id: "M13.38", code: "P4", tool: "bb_patterns", priority: "p2-medium",
    title: "bb_patterns: integration + e2e + corpus",
    goal: "Prove patterns across the loop and real repos.",
    acceptance: [
      "e2e via MCP and compiled CLI",
      "Corpus findings evidence-backed; failures recorded",
    ],
  },
  { id: "M13.39", code: "P5", tool: "bb_patterns", priority: "p2-medium",
    title: "bb_patterns: honesty + docs + release gate",
    goal: "Document patterns' true capabilities and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless P1-P4 pass",
    ],
  },

  // ── bb_security ─────────────────────────────────────────────────────
  { id: "M13.40", code: "Sec1", tool: "bb_security", priority: "p2-medium",
    title: "bb_security: contract (findings vs flow/summary/hotspots)",
    goal: "Resolve mode drift; never advertise flow/summary/hotspots unless implemented.",
    acceptance: [
      "Executable modes = [findings]; others moved to plannedModes or removed",
    ],
  },
  { id: "M13.41", code: "Sec2", tool: "bb_security", priority: "p2-medium",
    title: "bb_security: handler adapter end-to-end + no regex-as-AST",
    goal: "Verify analyzeSecurityAcrossLanguages -> CrossLanguageSecurityFindings output (the shape the handler actually returns), and prove no regex heuristics are disguised as AST.",
    acceptance: [
      "The transformed handler output (summary/findings/suspiciousSources) is tested, not just the taint engine",
      "Source->sink flows are evidence-linked and project-scoped",
      "Any regex used for detection is documented as heuristic, not AST",
    ],
  },
  { id: "M13.42", code: "Sec3", tool: "bb_security", priority: "p2-medium",
    title: "bb_security: unit/integration/e2e/corpus (adversarial taint)",
    goal: "Adversarial cross-language taint coverage through all layers.",
    acceptance: [
      "Positive + negative taint cases (true positive, parameterized false-positive, mitigated, cross-language)",
      "e2e via MCP and compiled CLI",
      "Corpus findings recorded with pass AND fail",
    ],
  },
  { id: "M13.43", code: "Sec4", tool: "bb_security", priority: "p2-medium",
    title: "bb_security: honesty + docs + release gate",
    goal: "Document security's true capabilities and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless Sec1-Sec3 pass",
    ],
  },

  // ── bb_visualize ────────────────────────────────────────────────────
  { id: "M13.44", code: "V1", tool: "bb_visualize", priority: "p2-medium",
    title: "bb_visualize: contract mode cleanup (module vs text/json/html)",
    goal: "Separate scope from output-format in the contract so modes are not ambiguous.",
    acceptance: [
      "Scope (project/file/module/symbol/feature) and format (text/json/html) are distinct, documented fields",
      "Contract matches the registry with no drift",
    ],
  },
  { id: "M13.45", code: "V2", tool: "bb_visualize", priority: "p2-medium",
    title: "bb_visualize: node/link fidelity + no dropped edges + truncation",
    goal: "Prove the graph has no dangling links, honors budgets, and reports truncation truthfully.",
    acceptance: [
      "No link references a missing node",
      "maxNodes/maxLinks enforced; truncation reported when applied",
      "Module/symbol/feature scopes filter correctly",
    ],
  },
  { id: "M13.46", code: "V3", tool: "bb_visualize", priority: "p2-medium",
    title: "bb_visualize: unit/integration/e2e/corpus",
    goal: "Verify visualization across all layers and real repos.",
    acceptance: [
      "e2e via MCP and compiled CLI for text/json/html",
      "Corpus graphs consistent (JSON == HTML counts); failures recorded",
    ],
  },
  { id: "M13.47", code: "V4", tool: "bb_visualize", priority: "p2-medium",
    title: "bb_visualize: honesty + docs + release gate",
    goal: "Document visualization's true contract and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless V1-V3 pass",
    ],
  },

  // ── bb_migrate ──────────────────────────────────────────────────────
  { id: "M13.48", code: "M1", tool: "bb_migrate", priority: "p2-medium",
    title: "bb_migrate: mapping accuracy + no fake translation",
    goal: "Migration plans must be honest estimates, never presented as translated source; unsupported cases explicit.",
    acceptance: [
      "Library mappings and effort are labeled methodology estimates",
      "Unsupported symbols/routes are explicit, never silently dropped",
      "No plan claims to generate/compile target source",
    ],
  },
  { id: "M13.49", code: "M2", tool: "bb_migrate", priority: "p2-medium",
    title: "bb_migrate: unit/integration/e2e/corpus",
    goal: "Verify migration planning across all layers and real repos.",
    acceptance: [
      "Dependency order from indexed relationships is correct",
      "e2e via MCP and compiled CLI",
      "Corpus plans recorded with pass AND fail",
    ],
  },
  { id: "M13.50", code: "M3", tool: "bb_migrate", priority: "p2-medium",
    title: "bb_migrate: honesty + docs + release gate",
    goal: "Document migration's true contract and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless M1-M2 pass",
    ],
  },

  // ── bb_analyze ──────────────────────────────────────────────────────
  { id: "M13.51", code: "An1", tool: "bb_analyze", priority: "p2-medium",
    title: "bb_analyze: all 11 modes verified with per-mode negatives",
    goal: "Every mode (callers/callees/trace/dependencies/stats/complexity/impact/test_mapping/test_gaps/test_impact/test_quality) verified with at least one negative.",
    acceptance: [
      "Each of the 11 modes has positive + negative coverage",
      "Not-found/empty cases return explicit unavailable, never fabricated values",
    ],
  },
  { id: "M13.52", code: "An2", tool: "bb_analyze", priority: "p2-medium",
    title: "bb_analyze: handler <-> engine parity for all 11 modes",
    goal: "The public handler output is tested for every mode, not just the engine functions it calls.",
    acceptance: [
      "Handler dispatch for each mode returns the documented shape",
      "Mode-irrelevant options rejected; required target enforced",
    ],
  },
  { id: "M13.53", code: "An3", tool: "bb_analyze", priority: "p2-medium",
    title: "bb_analyze: unit/integration/e2e/corpus",
    goal: "Verify analysis across all layers and real repos.",
    acceptance: [
      "e2e via MCP and compiled CLI for each mode",
      "Corpus analysis consistent; failures recorded",
    ],
  },
  { id: "M13.54", code: "An4", tool: "bb_analyze", priority: "p2-medium",
    title: "bb_analyze: honesty + docs + release gate",
    goal: "Document analyze's true contract and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless An1-An3 pass",
    ],
  },

  // ── bb_doc ──────────────────────────────────────────────────────────
  { id: "M13.55", code: "D1", tool: "bb_doc", priority: "p2-medium",
    title: "bb_doc: fact classification + citation completeness",
    goal: "Every emitted fact is classified and cited; no uncited fact reaches the output.",
    acceptance: [
      "Each fact is extracted/inferred/generated/unknown with resolvable citations where applicable",
      "No fact is classified unknown while presented as certain",
    ],
  },
  { id: "M13.56", code: "D2", tool: "bb_doc", priority: "p2-medium",
    title: "bb_doc: mode completeness + negatives",
    goal: "All seven modes verified with negatives (missing target, stale source, budget overflow).",
    acceptance: [
      "Each mode (symbol/file/module/feature/api/project/coverage) positive + negative coverage",
      "Stale source labeled; budget gate fails oversized output truthfully",
    ],
  },
  { id: "M13.57", code: "D3", tool: "bb_doc", priority: "p2-medium",
    title: "bb_doc: unit/integration/e2e/corpus",
    goal: "Verify documentation across all layers and real repos.",
    acceptance: [
      "e2e via MCP and compiled CLI for markdown/json",
      "Corpus docs cited correctly; failures recorded",
    ],
  },
  { id: "M13.58", code: "D4", tool: "bb_doc", priority: "p2-medium",
    title: "bb_doc: honesty + docs + release gate",
    goal: "Document bb_doc's true contract and lock its gate.",
    acceptance: [
      "docs accurate and regenerated; evidence committed",
      "Release gate blocks 'verified' unless D1-D3 pass",
    ],
  },
]

if (ISSUES.length !== 58) {
  throw new Error(`expected 58 issues, got ${ISSUES.length}`)
}
const ids = new Set(ISSUES.map((i) => i.id))
if (ids.size !== 58) throw new Error("duplicate issue ids")

const MODE = process.argv.includes("--create") ? "create" : process.argv.includes("--plan") ? "plan" : null
if (!MODE) {
  console.error("usage: bun script/m13/issues.ts --plan | --create")
  process.exit(1)
}

const planData = () => ({
  schemaVersion: 1,
  milestone: "M13",
  title: "Tool Trust Rebuild",
  status: MODE === "create" ? "created" : "planned",
  created: new Date().toISOString().slice(0, 10),
  totalIssues: ISSUES.length,
  issueRange: "",
  issues: ISSUES.map((i) => ({ ...i, issue: undefined as number | undefined })),
})

if (MODE === "plan") {
  writeFileSync(PLAN_PATH, JSON.stringify(planData(), null, 2) + "\n")
  console.log(`Wrote ${PLAN_PATH} (${ISSUES.length} issues, planned)`)
  process.exit(0)
}

// ── create mode ───────────────────────────────────────────────────────
async function gh(args: string[], opts: { input?: string } = {}): Promise<string> {
  const proc = Bun.spawnSync(["gh", ...args], {
    stdout: "pipe", stderr: "pipe",
    ...(opts.input !== undefined ? { stdin: Bun.file("/dev/null") } : {}),
  })
  const out = proc.stdout?.toString() ?? ""
  const err = proc.stderr?.toString() ?? ""
  if (proc.exitCode !== 0) throw new Error(`gh ${args.join(" ")} failed: ${err || out}`)
  return out
}

async function shell(args: string[]): Promise<string> {
  const proc = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" })
  const out = proc.stdout?.toString() ?? ""
  const err = proc.stderr?.toString() ?? ""
  if (proc.exitCode !== 0) throw new Error(`${args.join(" ")} failed: ${err || out}`)
  return out
}

// 1. Milestone (idempotent)
let milestoneNumber: number | undefined
const existingMilestones = JSON.parse(
  await gh(["api", `repos/${REPO}/milestones?state=all&per_page=100`]),
) as Array<{ number: number; title: string }>
const existing = existingMilestones.find((m) => m.title === MILESTONE_TITLE)
if (existing) {
  milestoneNumber = existing.number
  console.log(`milestone exists: #${milestoneNumber} ${MILESTONE_TITLE}`)
} else {
  const created = JSON.parse(
    await gh(["api", `repos/${REPO}/milestones`, "-f", `title=${MILESTONE_TITLE}`, "-f", `description=${MILESTONE_DESC}`]),
  ) as { number: number }
  milestoneNumber = created.number
  console.log(`created milestone #${milestoneNumber}`)
}

// 2. Label (idempotent)
const labels = JSON.parse(await gh(["api", `repos/${REPO}/labels?per_page=100`])) as Array<{ name: string }>
if (!labels.some((l) => l.name === LABEL_NAME)) {
  await gh(["label", "create", LABEL_NAME, "--repo", REPO, "--description", LABEL_DESC, "--color", LABEL_COLOR])
  console.log(`created label ${LABEL_NAME}`)
} else {
  console.log(`label ${LABEL_NAME} exists`)
}

// 3. Issues (resumable by title)
const existingIssues = JSON.parse(
  await gh(["api", `repos/${REPO}/issues?state=all&per_page=100&filter=all`]),
) as Array<{ number: number; title: string }>

const tmp = join(tmpdir(), `m13-issues-${Date.now()}`)
mkdirSync(tmp, { recursive: true })

const result: Array<Record<string, unknown>> = []
for (const issue of ISSUES) {
  const title = `${issue.id} — ${issue.title}`
  const found = existingIssues.find((e) => e.title === title)
  if (found) {
    console.log(`reuse existing issue #${found.number}: ${title}`)
    result.push({ ...issue, issue: found.number })
    continue
  }
  const bodyFile = join(tmp, `${issue.code}.md`)
  writeFileSync(bodyFile, bodyOf(issue))
  const url = await gh([
    "issue", "create", "--repo", REPO,
    "--title", title,
    "--body-file", bodyFile,
    "--milestone", MILESTONE_TITLE,
    "--label", LABEL_NAME, "--label", issue.priority,
  ])
  const number = Number(url.trim().split("/").pop())
  if (!Number.isFinite(number)) throw new Error(`could not parse issue number from: ${url}`)
  console.log(`created #${number}: ${title}`)
  result.push({ ...issue, issue: number })
}

// 4. Write the plan file with issue numbers
const numbers = result.map((r) => r.issue as number)
const final = {
  ...planData(),
  issueRange: `${Math.min(...numbers)}-${Math.max(...numbers)}`,
  issues: result,
}
writeFileSync(PLAN_PATH, JSON.stringify(final, null, 2) + "\n")
console.log(`\nWrote ${PLAN_PATH} with ${result.length} issue numbers (range ${final.issueRange})`)
