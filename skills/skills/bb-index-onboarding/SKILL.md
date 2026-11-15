---
name: bb-index-onboarding
description: Use when a project is not indexed yet, results look empty or stale, or semantic search needs the embedding provider set up — bb index, setup, doctor, stats, status, projects.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: []
---
# Get a project indexed, and keep the index honest

An agent with bb tools but no index gets refusals, not answers. This skill is the setup
path; use `bb-code-navigation` only after it succeeds.

## First index

```bash
bb index .                 # parse + store + derive (relationships, graph, taint, health)
bb stats                   # files / symbols / relationships / embeddings counts
bb status                  # last run state and per-phase timings
bb projects                # every indexed project: DB path, size, counts
```

On a first run bb may prompt for embedding setup; in a non-interactive context pass
`--no-setup` and configure embeddings separately (below) or accept local vectors.

## Embeddings (semantic search quality)

```bash
bb setup                   # provider, API key, model (key is stored locally, not uploaded)
bb setup show              # fingerprint-only view of the configuration
bb doctor                  # read-only: embedding setup + index consistency
```

Without an embedding provider, `bb_ask` falls back to local vectors — declared in its
answer as weaker. Do not describe that fallback as equivalent to the configured model.

## Reindexing during work

| situation | command |
| --- | --- |
| a few files changed on disk | `bb index --changed` (incremental) |
| one file just written | `bb_index` with `path` and `mode: "file"` |
| derived data only is stale (after `--skip-post-processing`, `--changed`, agent edits) | `bb index --post` or `bb_index` `mode: "post"` |
| an interrupted run | `bb index --resume` |
| the index is corrupt/partial | `bb index --force` (rebuild; the only destructive one) |

`--skip-post-processing` is for speed only: derived phases are stale until `--post`.

## Rules

- Index the project the user actually asked about; `--dir` the tool calls and CLI at it.
- Check `bb health` / `bb_health` before trusting a broad answer; report the freshness
  block, including the "sampled, lower bound" wording when it appears.
- Do not reindex the whole project on every edit; use file/post modes.

## Do not

- Do not claim semantic search is configured because `bb_ask` answered — read its
  confidence/model declaration.
- Do not run `bb index --force` to "fix" a stale answer before trying `--changed`/`--post`.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
