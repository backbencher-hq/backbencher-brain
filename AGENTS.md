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

## Commit attribution

Commit messages are authored by the repository owner. Do not add agent
attribution footers — no "Generated with a tool", no "

## Context compaction (client patched 2026-10-28)

The client-tooling client on this machine compacts automatically. Its defaults were measured in the
binary: trigger at 320k tokens (0.8 x 400k budget), post-compaction target ~160k, 12k verbatim
tail, plus a cache-expiry trigger after 15 minutes idle at 40k tokens. That is why a long task
was erased around 30% of a 1M window.

It is patched to: trigger at 720k tokens (~69% of the 1M window), post-compaction target 432k,
60k verbatim tail, no idle/cache-expiry trigger. The npm launcher metadata is pinned to 99.0.0
so an update cannot silently replace the patched binary.

- Patch script: `~/.config/manicode/client-tooling-compaction-patch.py` (`--check`, `--restore`).
  The second install at `~/.khushal_file/.config/manicode/client-tooling` is patched identically;
  use `--binary ~/.khushal_file/.config/manicode/client-tooling` to check or re-apply it.
- If compaction fires before ~700k tokens, the patch is gone (binary replaced). Say so and
  re-run the script instead of continuing with lost history.
- When compaction does fire, the produced summary is a mechanical action log, not a handoff.
  Keep the task, decisions and verified state in files under `docs/analyzers/`; anything that
  lives only in the transcript is expected to be lost.
