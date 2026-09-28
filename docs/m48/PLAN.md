# M48: Tool Surface Truth — PLAN

> Milestone number 48 verified free on GitHub (1–47 all used) before creation.
> Issues: #695–#705, all attached to milestone 48.

## The milestone invariant (verbatim, enforced by G1)

> **Every public tool answers the same question the same way, declares its
> limits honestly, and is proven on real repositories — while the LSP/hub
> lane keeps working.**
>
> **Results are real, never hollow:** no tool, parameter, enum branch, mode,
> or CLI flag is marked verified without a cross-checked, reproducible real
> run (expected value derived independently of the tool vs the tool output).

## Why this milestone exists (evidence, not memory)

Measured on an 8-file fixture through the real handlers:

| Question | `bb_impact` | `bb_analyze impact` | Verdict |
|---|---|---|---|
| "What breaks if I change `leaf`?" | 9 symbols / 7 files, maxDepth 4, honest `truncated:false` | 5 files, silent depth-3 cap, **`truncated:false` that can never be true** | **Different answers, one hides its limit** |
| "Who depends on `Service`?" | 2 distinct dependents | `directSymbols: 4` (edge counting) | Different counts, same question |

Root cause: two impact calculators (`analyzeImpact` in intelligence vs
`computeImpact` in `src/lsp/impact.ts`). The editor work built its own
calculator instead of reusing the MCP one; both were verified **against their
own claims** — no gate ever asked whether the two doors agree. This milestone
writes the missing claims.

## Priorities

**Priority 1 — the proven truth defects (fix, not just document):**
- **P1 (#696):** one impact calculator — `bb_analyze impact` derives counts
  from the same source as `bb_impact` and the editor; disagreement is a gate
  failure.
- **P2 (#697):** honesty-field audit — no hollow completeness/absence claims
  on any of the 16 tools.
- **P3 (#698):** same-question agreement corpus — overlapping pairs agree or
  their difference is documented; agreement is pinned by gates.

**Priority 2 — no stone unturned (real testing of all 16 tools):**
- **C1 (#699):** real corpus — every tool executed and recorded on real
  repositories (this repo + ≥4 in `$HOME/fixtures/repositories`).
- **C2 (#700):** edge + mutation cases for every tool family.
- **D1 (#701):** tool documentation truth — cross-references, categories,
  contradiction fixes, regeneration.
- **W1 (#702):** website-ready honest tool document for the website agent.
- **H1 (#703):** ghost cleanup — no live artifact references a removed tool
  (`bb_relationships` etc.).

**Parameter coverage (added by full review 2):**
- **P4 (#706):** parameter & flag coverage matrix — every tool parameter,
  every enum branch, every mode, every CLI flag/option, derived from the
  registry + CLI and drift-gated; every row verified by a cross-checked,
  reproducible real run; an unverified row blocks X1.

**Infrastructure / governance:**
- **G1 (#695):** scaffold, 16-tool coverage matrix, registry, ledger, wiring.
- **L1 (#704):** LSP/hub lane never breaks — shared-component guard +
  coordination log.
- **X1 (#705):** closure gate — live read-only re-run of every content gate +
  corpus on a clean tree; refuses close while any P4 matrix row is unverified
  or any evidence file lacks a ground-truth cross-check.

## 16-tool coverage matrix (machine-checked by G1)

Every tool below must have a real-run evidence file under
`validation/m48/results/` before X1 may pass. A tool with no evidence file is
an open issue, not a comment.

| # | Tool | Primary evidence | Agreement pair (P3) |
|---|---|---|---|
| 1 | bb_search | C1 + P3 | CLI `bb search` parity |
| 2 | bb_ask | C1 | vs bb_search (documented difference) |
| 3 | bb_health | C1 + P3 | CLI health/stats/status distinctness |
| 4 | bb_patterns | C1 | — |
| 5 | bb_security | C1 | — |
| 6 | bb_visualize | C1 + P3 | vs bb_graph (symbol/file/module scope) |
| 7 | bb_migrate | C1 | — |
| 8 | bb_analyze | C1 + P3 | callers/callees/trace vs bb_graph; impact vs bb_impact (P1) |
| 9 | bb_doc | C1 + P3 | vs bb_search/bb_ask (documented) |
| 10 | bb_edit | C1 + C2 | vs bb_annotate (write surfaces) |
| 11 | bb_index | C1 + C2 | CLI `bb index` twins |
| 12 | bb_graph | C1 + P3 | vs bb_analyze callers/callees/trace |
| 13 | bb_impact | C1 + P1 + P3 | vs bb_analyze impact (identical after P1) |
| 14 | bb_cross_language | C1 | vs bb_visualize language filter (documented, P3) |
| — | bb_analyze mode=dependencies | C1 + P3 | vs bb_visualize module/file scope (P3 addendum) |
| 15 | bb_annotate | C1 + C2 | with bb_annotations (write/read pair) |
| 16 | bb_annotations | C1 + C2 | with bb_annotate (write/read pair) |

## Hard rules (from the charter)

1. **Fix, never break.** Real verification: gates are part of the proof, never
   the whole proof. Every issue closes with recorded real-repo evidence files.
2. **The LSP/hub lane (M47, active) never breaks.** Changes touching shared
   components (graph engine, impact calculator, cross-language reader,
   annotation store) are announced in `docs/m48/COORDINATION.md` first and
   verified against L1. If the hub side regresses because of us, we fix it and
   log the fix.
3. **Website honesty:** W1 delivers one website-ready document listing every
   tool truthfully (purpose, twins/parity, replacements, differences) so the
   website never lists duplicates or lies.
4. **No tool missed:** the coverage matrix above is machine-checked by G1.

## Full-review addendum (2026-09-07, before work started)

Every finding from the pre-plan research was re-checked against issue coverage.
Gaps found and closed (issue bodies updated):

1. **P3 added pairs** (#698): bb_analyze mode=dependencies vs bb_visualize
   scope=module/file; bb_cross_language vs bb_visualize languages filter
   (documented different questions, never claimed identical semantics).
2. **C1 non-vacuousness** (#699): 43 real repos on disk (rake/Ruby,
   ripgrep+cargo/Rust, go-tools+terraform/Go, graphql-js+element-plus+
   lodash+vue-core/TS-JS, swift-nio/Swift, tree-sitter-clean multi-language,
   elixir/clojure/scala3/fsharp). At least one multi-language repo is indexed
   so bb_cross_language/bb_migrate/bb_security produce REAL rows. CLI `bb tool`
   gateway parity for all 16 tools. Sequencing: C1 corpus runs AFTER P1–P3 so
   evidence reflects the final fixed behavior (no double corpus runs).
3. **H1 widened** (#703): phantom-name scan covers SESSION-HANDOFF.md and
   docs/tools/*.md; historical tables allowed only when labeled history.
4. **W1 planned-modes honesty** (#702): planned (non-executable) modes are
   visibly marked via the registry plannedModes field.
5. **L1 honest smoke handling** (#704): if M47 code is absent locally, that is
   recorded with the local HEAD and origin is used — a smoke that cannot run
   is recorded as not-run, never as passed.

Execution order: G1 scaffold → P1 (impact unification) → P2 (honesty fields)
→ P3 (agreement) → P4 (parameter/flag matrix, after P1–P3 so rows record
final behavior) → C1+C2 (corpus/edges, after fixes) → D1+H1+W1 (docs) →
L1 guard runs with every content change → X1 closure. Owner reviews W1 and
gives the final close approval — the machine never self-closes, and no tool,
parameter, or flag is called verified without its cross-checked real run.

## Non-goals

- No new tools, no tool deletions, no MCP protocol changes.
- No changes to the hub/editor UI lane beyond shared-component cooperation.
- No analyzer-lane work (M14/M37) and no website-build work (M41) — W1 only
  produces the truthful content the website agent consumes.
