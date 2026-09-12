<!-- bb:onboard:start -->
# Backbencher Brain (bb)

This project is indexed by bb. Use the bb MCP tools below for code questions — they read the
indexed AST (symbols, relationships, taint, embeddings) and report staleness instead of guessing.

| Tool | Use when | Mutates files? |
|---|---|---|
| `bb_search` | Find a symbol, its exact source, or a file — exact/lexical lookup. | no |
| `bb_ask` | Ask a natural-language question about behavior and get scored semantic matches. | no |
| `bb_health` | Is the index complete, fresh, and healthy. | no |
| `bb_patterns` | Find dead code, orphans, and anti-patterns. | no |
| `bb_security` | Find taint flows and injection findings. | no |
| `bb_visualize` | Show the dependency overview for a whole project/file/module at once, not one symbol. | no |
| `bb_migrate` | Plan a cross-language migration with ordering and unsupported mappings. | no |
| `bb_analyze` | Typed per-mode analysis: callers/callees/stats/complexity/tests. | no |
| `bb_doc` | Write cited documentation for a symbol, file, module, feature, or API. | no |
| `bb_edit` | Change source code safely (preview, validate, rollback, reindex). | **yes** |
| `bb_index` | Reindex just-written or changed files/directories. | **yes** |
| `bb_graph` | Who calls this symbol, and what does it call — per-symbol callers/callees, depth-bounded. | no |
| `bb_impact` | What breaks if this symbol changes — reverse dependencies with a declared budget. | no |
| `bb_cross_language` | Show stored cross-language facts for one symbol (declared absent when none). | no |
| `bb_annotate` | Write a note on a symbol (agent-authored annotation). | **yes** |
| `bb_annotations` | Read notes back — all annotations, or one symbol's. | no |

These are the only bb tools (16 total). A name that is not in this table does not exist —
if you call it you will get "unavailable tool" and learn nothing.

Read tools answer from the index and declare staleness (`fresh`/`stale`/`missing`); reads that find stale
files refresh them within budget and say so in the answer.
Write tools (`bb_edit`, `bb_index`, `bb_annotate`) change the index or source — call them only when the user asks for that change.
<!-- bb:onboard:end -->
