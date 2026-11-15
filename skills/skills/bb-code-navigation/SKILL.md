---
name: bb-code-navigation
description: Use when you need a symbol, its callers or callees, what a change breaks, a cross-language handoff, or an architecture overview — instead of guessing from grep.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: ["bb_search", "bb_ask", "bb_graph", "bb_impact", "bb_cross_language", "bb_analyze", "bb_visualize"]
---
# Find and understand code through `bb` instead of guessing

The index already holds symbols and relationships; `grep` re-derives a worse answer from
text. Route the question first, then read the evidence block (`bb-evidence-reading`).

## Route by question

| the question | call | notes |
| --- | --- | --- |
| exact symbol, its source, a file, lexical hits | `bb_search` | Use `query` in `symbols` (default) or `content` mode, `symbolName` in `symbol` mode, and `filePath` in `file` mode. |
| a behaviour/natural-language question | `bb_ask` | exact-name route for a symbol name, else semantic matches with cosine scores; similarity is not proof |
| who calls X / what X calls | `bb_graph` | `direction`, `maxDepth`, `relationshipTypes`; typed edges with evidence tier |
| what breaks if X changes | `bb_impact` | reverse dependencies with a declared node budget and depth |
| a cross-language handoff for one symbol | `bb_cross_language` | stored cross-language facts only; absence is declared |
| counts, complexity, callers/callees mode, tests | `bb_analyze` | `mode` is required; stats is project-wide, the rest take `target`/`filePath` |
| architecture / dependency shape of a project, file, module or symbol | `bb_visualize` | scoped projection; one answer for the shape, not per-symbol calls |

Example: `bb tool bb_search --args '{"query":"createServer","limit":5}'` — the same tool
call the MCP surface exposes.

## Rules

- Prefer `bb_search` when a name is known; prefer `bb_ask` only when it is not, and treat
  its similarity scores as ranking, never as certainty.
- New or unsaved files are not in the index: use the host's read/grep for those and say
  the answer came from outside the index.
- The index is a snapshot; when the answer matters for a file you know changed, reindex
  it (`bb_index` file mode) or state the staleness.
- Do not present `bb_impact`'s bounded set as "everything"; its `truncated`/reason fields
  are part of the answer.

## Do not

- Do not grep first for a symbol query and finish there — search the index, then fall back
  explicitly.
- Do not quote a relationship the answer did not return; if the graph has no edge, say so
  rather than infer one from imports.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
