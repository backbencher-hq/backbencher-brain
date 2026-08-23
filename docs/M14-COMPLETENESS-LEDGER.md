# M14 Completeness Ledger

Status: **LIVE GOVERNANCE ARTIFACT** — checked by `script/m14/verify-honesty.ts`.
Every cell is either `GATED` (a standing verification exists) or `PENDING`
(visible, scheduled). A PENDING cell may never be silently dropped; a wave
claiming L5 while touching a PENDING cell it depends on fails the honesty gate.

## Purpose

The import-persistence bug survived months of green gates because gates tested
layers, not seams. This ledger enumerates ALL verification cells so nothing is
protected by nobody. Rule: **every newly discovered bug class becomes a
permanent gate before its fix counts as landed** (see F7 rule).

## Matrix 1 — Pipeline stage × artifact type

Stages: PARSE → ANALYZE → STORE (brain.db) → QUERY (tools) 
Artifacts: symbols, relationships by kind, imports, taints, patterns, flags, embeddings, health

| Stage ↓ / Artifact → | symbols | extends/implements | calls | instantiates | uses | imports | overrides | taints | patterns | xlang flags | embeddings | health |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ANALYZE (fixtures) | GATED F3 | GATED F3 | GATED F3 | GATED F3 | GATED F3 | GATED F3* | GATED F3* | PENDING -> #381 (taints) | PENDING F10 | GATED F3 | n/a | n/a |
| STORE (pipeline e2e) | GATED F7 | GATED F7 | GATED F7 | GATED F7 | PENDING -> #384 (uses/overrides rows) | GATED F7 | PENDING (add to F7) | PENDING (seam-sweep) | **DEAD SEAM → F10** | GATED F7 | PENDING (needs key; conditional gate) | GATED F7 |
| QUERY (tools truthfully read stored data) | M13 scope | M13 scope | M13 scope | M13 scope | M13 scope | PENDING -> M15 (co-agent; verify brain_import surfaced) | M13 scope | M13 scope | **BROKEN → F10** | PENDING | M13 scope | M13 scope |

\* fixture coverage per language grows with its wave; JVM done, others pending their waves.

Findings already produced by this matrix:
- brain_import was never written (FIXED, gated in F7)
- brain_pattern is read-but-never-written (F10)
- is_cross_language was never set (FIXED, gated in F7)

## Matrix 1b — Symbol-level payload coverage (added after qualified_calls bug)

The isKotlinBuiltin bug proved relationship-only verification misses
symbol-field rot. Every language wave must pin these symbol payloads:

| Payload | java | groovy | kotlin | rule |
|---|---|---|---|---|
| qualified_calls | PENDING -> #383 | PENDING -> #383 | GATED (qualified-calls-builtin-names) | adversarial names REQUIRED |
| docstrings/kdoc | PENDING -> #383 | PENDING -> #383 | GATED (kdoc-extraction) | |
| parameters (+defaults) | PENDING -> #383 | PENDING -> #383 | GATED (calls-and-instantiation partial) | |
| byte ranges (bb_edit depends) | indirect via M13 edit gates | same | same | M13 scope |
| visibility/modifiers | GATED F3 implicit | implicit | implicit | explicit pins PENDING -> #383 |
| qualified_calls | GATED (consistency+fixture) | NOT EMITTED -> #383 | GATED (consistency+fixture) | scala also absent -> #383 |
| range columns 1-based | GATED (CC1) | GATED (CC1, was 0-based - FIXED) | GATED (CC1) | GATED (CC1) |

**Standing fixture-authoring rule**: every language's fixtures MUST include
identifiers that collide with stdlib/builtin words (get/map/run/add...),
because suppression filters are invisible to output-diff tests otherwise.

## Matrix 1c — Relationship-type verification taxonomy

Schema truth (src/ast/types.ts RelationshipType): calls, extends, implements,
instantiates, uses, references(+DependsOn alias), contains, overrides,
exports, imports (persisted to brain_import + reference edges).
NOT relationship types despite appearing in output: field_access /
kotlin_extension_function / config_property (= metadata.relationshipType
qualifiers on Uses/Calls edges); ownerName (symbol field); "regex"/"var" are
grammar nodes, never emitted concepts.

| Type | java | groovy | kotlin | pinned by |
|---|---|---|---|---|
| calls | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| extends | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| implements | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| instantiates | GATED F3 | GATED F3 | GATED F3 | fixtures + differential |
| uses / field_access | GATED F3 (anti-skip) | GATED F3 | GATED F3 | pure-field-chain fixtures |
| contains | differential-implicit | implicit | implicit | explicit pins PENDING -> #381 |
| overrides | **NO FIXTURE ANY LANGUAGE** | same | same | PENDING -> #381 |
| references/imports | pipeline-e2e GATED | pipeline-e2e GATED | PENDING -> F7 + #383 | F7 |
| exports | emitted, unpinned | n/a (no export concept) | n/a | PENDING -> #381 |

Scala (Matrix 2 JVM cluster): fixtures 10/10 GATED; differential 95.1% cov / 0.5% unexplained on scala3@HEAD after #385 fixes (trait multi-parent positional bug fixed; stable_type_identifier parents; script-sentinel constructions). Remaining 11 residuals: scala dotted-parent convention decision + stdlib companion-chain oracle shapes -> #385. kotlin wasm fieldCount=0 -> #382.

## AST purity audit (2026-08-23)

Relationship and symbol extraction in java/groovy/kotlin: tree-walk based,
grammar fields used where the wasm provides them (kotlin wasm: fieldCount=0 -
positional fallbacks documented). Remaining raw-text semantics, all DECLARED:
- java/groovy collectFieldAccessUses split(".") (anti-skip holds; grammar-fields rewrite open)
- framework/pattern DETECTION labels use content substring matching
  (kotlin stringIncludes(content,"let") etc) - cosmetic metadata, low stakes;
  destination decided under F10
No regex used in relationship extraction in the three audited analyzers.

## Gate CC1 — Cross-language consistency (script/m14/verify-cross-language-consistency.ts)

Equivalent class/method shape in java/groovy/kotlin/scala asserted structurally
identical: 1-based ranges everywhere, consistent symbol kinds, payload presence
per declared support. Born from the scala column-base finding; IMMEDIATELY
caught groovy emitting 0-based columns (fixed) and corrected the
qualified_calls support map (groovy does not emit them - #383).

## Matrix 2 — Language-cluster pipeline coverage (realistic combos, not all-to-all)

| Cluster | Languages | Polyglot e2e fixture | Status |
|---|---|---|---|
| JVM interop | java + groovy (+kotlin, scala when audited) | F7 project | GATED (java+groovy); kotlin/scala PENDING -> #384 |
| Web embedded | ts/tsx + js + html + css + vue/svelte + json | — | PENDING -> #384 |
| Mixed server | js/ts + python + json/yaml (ProxiCall shape) | ProxiCall as living corpus | PENDING -> #299 + #384 |
| .NET | csharp + fsharp | — | PENDING -> #384 |
| BEAM | elixir + erlang | — | PENDING -> #384 |
| Mobile | dart + swift + kotlin + objc | — | PENDING -> #384 |
| Systems | c + cpp + zig + rust | — | PENDING -> #384 |

Issue back-references: Matrix 1b payloads -> #383; kotlin wasm fields -> #382;
cluster fixtures -> #384; overrides/contains/exports pins -> #381.
RULE: every ledger PENDING cell must cite a GitHub issue. An uncited PENDING
cell is itself a gate failure.

Owner directive recorded: real projects combine languages in unanticipated ways
(ProxiCall: flutter/dart + node + next.js + python). Cross-language resolution
is therefore name-based and language-agnostic by architecture — clusters are
for STRUCTURALLY embedded relationships only (vue template→ts, html→js/css).
No pair-map will ever be hardcoded.

## Matrix 3 — Per-analyzer seven stations (from wave issues)

Tracked per issue in plans/M14-issues.json / GitHub #245-#297:
grammar conformance · symbols · relationships · heuristic honesty · adversarial
fixtures · differential corpus · mutation hardening.
Done: java, groovy (stations 1-7; L5 pending owner spot-checks).
PENDING: remaining 39 analyzers.

## Matrix 4 — Grammar / WASM / version provenance per language

Owner directive: several languages have no official grammar; vendored community
grammars live in `grammars/` (user-improved). Analyzer audits MUST also check
grammar correctness (deadly-serious bugs only — AI-corrupting parses), wasm
provenance, and upstream version drift. Known vendored: tree-sitter-groovy
(amaanq 0.1.2, user-improved), tree-sitter-fsharp (vendored), tree-sitter-clean.

| Language | wasm source | grammar provenance | version pinned | drift checked |
|---|---|---|---|---|
| groovy | grammars/ build -> wasm/ | vendored amaanq 0.1.2 (improved) | YES | wave M14.1 done |
| fsharp | grammars/ build -> wasm/ | vendored | PENDING wave M14.5 | PENDING -> #382 |
| clean | grammars/ build -> wasm/ | vendored | PENDING wave M14.5 | PENDING -> #382 |
| all others | wasm/*.wasm (upstream builds) | upstream tree-sitter repos | PENDING per-wave -> #382 | PENDING -> #382 |

Standing sub-checks for every analyzer audit (added to seven stations):
8. grammar provenance + version recorded in evidence; upstream drift diffed
   (node-type deltas between pinned wasm and latest upstream release)
9. grammar-bug scan: parse corpus samples; ERROR-rate and wrong-tree shapes
   investigated; only AI-corrupting grammar bugs get fixed in-repo (fork policy)

## Matrix 5 — Tool-layer bug protocol (M15 boundary)

Co-agent owns tools/M15. When analyzer work hits a tool-layer bug:
(a) report to owner with evidence, or
(b) comment on the co-agent's M15 issue (or file new if absent), or
(c) if co-agent is not on that file: fix + verify + commit with explicit
    cross-agent note in the message.
Recorded so it is process, not memory.

## Standing rules

1. Every bug class found anywhere becomes a permanent gate before its fix lands (F7 rule).
2. PENDING cells are work items, not shame — silent gaps are the shame.
3. Wave closure requires no PENDING cell in its dependency path.
4. Owner spot-checks (contract §5.6) remain the final closure authority for every issue.

## Perf baselines (2026-08-23, grails-core groovy subsets, this machine)

| Scale | Duration | Marginal |
|---|---|---|
| 100 files | 10.4s | — |
| 200 files | 15.8s | 54 ms/file |
| 400 files | 22.1s | 31 ms/file |
| single 3,152-line file | parse 154ms + analyze 87ms | deterministic |

F9 IMPLEMENTED (per-analyzer budgets, differential harness): avg ms/file
recorded per language per repo into differential-baseline.json; gate fails on
>3x own baseline or >3x cross-language median. First recorded budgets:
java 12.3 ms/file, groovy 8.8, scala 10.6, kotlin 54.2 on Exposed (OUTLIER -
flagged for investigation under #385-family; budget passes at current margin).
100k+-file scaling: UNTESTED (declared).
