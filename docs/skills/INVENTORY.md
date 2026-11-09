# Skills inventory and gap analysis (2026-11-09)

Status: audit only. No bb skill exists yet; `docs/drafts/public-repos/backbencher-skills/README.md`
is the only skills artifact, and it describes categories, not skills. This page records what
is installed today, what the product surface is, and the proposed catalog the first batch
should be written against.

## 1. What is installed today

The session harness loads project skills from `.agents/skills/` — 137 `SKILL.md` files in
total, from three sources:

| source | count | what they route to |
| --- | --- | --- |
| top-level project skills (`better-accessibility`, `better-colors`, `better-interface`, `better-layout`, `better-typography`, `better-ui`, `better-writing`, `impeccable`, `interface-review`, `reverse-engineer-anything`) | 10 | UI/UX review, design systems, visual craft, reverse engineering |
| vendored `anthropics-skills` pack | part of 127 | general agent skills from the upstream collection |
| vendored `heydamir-unslop` pack | part of 127 | general agent/process skills |

**None of them is about `bb`.** No skill mentions an MCP tool, the index, freshness, edit
safety, migration planning or evidence reading, so no skill can ever be selected for a bb
task. This is the observed gap in the 2026-11-09 session: the bb MCP server *was* connected
(`bb_health` answered with a real 11,436-file index) and `AGENTS.md` carried the 16-tool
"use when" table, yet nothing in the agent's skill catalog routed a code question to bb.

## 2. What the product already provides (inputs a skill may cite, never duplicate)

- `AGENTS.md` — `bb onboard` writes the 16-tool table with "Use when" and "Mutates files?";
  drift is gated (`bb onboard --check`).
- `docs/tools/<tool>.md` — 16 pages, the single-tool reference.
- `docs/m24/TOOL-DOC.md` — per-language claim levels and request-ID coverage.
- `docs/MCP_CLI_INDEXER_GUIDE.md` — host configuration for Claude Desktop, Claude Code,
  VS Code and Cursor (**manual**, today).
- `.vscode/mcp.json` in this repo — a portable example of a host registration.
- `bb mcp`, `bb onboard`, `bb setup`, `bb doctor`, `bb health` — the CLI side.
- `.agents/skills/` host convention and the drafted `backbencher-skills` README (rules: drive
  the real tool, never hide a declaration, one task per skill, report line, no secrets).

## 3. What is missing

1. **No bb skills at all.** Route: `skills/` in this repo (proposed) → package `files` →
   installed into each host's skills directory by `bb onboard`.
2. **No installer.** `npm i -g backbencher-brain` puts files on disk; it does not register the
   stdio MCP server in any host, and there is no command that copies skills into
   `.claude/skills/`, `.agents/skills/`, `.github/skills/`, etc.
3. **No skills gate.** Nothing validates frontmatter, "use when" descriptions, referenced
   tool names against the registry (ghost-tool class), or version lock to the package.
4. **No "is it actually being used" check.** `bb doctor` diagnoses embeddings/index, not
   "server registered / skills installed / guidance current".

## 4. Proposed catalog (12 skills; full tool + CLI coverage)

Descriptions are the frontmatter text an agent routes on — all start with "use when".

### Batch 1 — the routing + safety core (5)

| skill | frontmatter description | covers |
| --- | --- | --- |
| `bb-install-and-connect` | Use when bb is installed but the agent has no bb tools, or when wiring bb into Claude Code, Cursor, VS Code, Codex, Gemini, opencode or a DSH workspace. | `bb mcp`, `bb onboard`, `bb upgrade`, `bb doctor`, host config merge |
| `bb-code-navigation` | Use when you need to find a symbol, its callers/callees, what a change breaks, or a cross-language handoff — instead of guessing from grep. | `bb_search`, `bb_ask`, `bb_graph`, `bb_impact`, `bb_cross_language`, `bb analyze` modes |
| `bb-evidence-reading` | Use when a bb answer reports freshness, staleness, truncation, confidence, declared absence or unsupported coverage — read it and surface it, never present it as complete. | every tool's declarations; `bb_health` |
| `bb-edit-safety` | Use when changing source through `bb_edit` (write/update/insert/delete/refactor): dry runs, modes, pre-image checks, batch atomicity, formatter behaviour, and when a refusal is the correct outcome. | `bb_edit`, `bb_index` post-pass |
| `bb-report-writing` | Use when a bb tool returns something wrong or misleading and the agent must produce a reproducible report (version, doctor, tool call, freshness, expected vs actual). | agent-report issue form, `bb --version`, `bb doctor` |

### Batch 2 — the workflows that already have evidence records (5)

| skill | frontmatter description | covers |
| --- | --- | --- |
| `bb-index-onboarding` | Use when a project is not indexed yet, results look empty, or semantic search needs the embedding provider set up. | `bb index`, `bb setup`, `bb doctor`, `bb stats`, `bb status`, `bb projects` |
| `bb-code-audit` | Use when asked for dead code, anti-patterns, security exposure or complexity hotspots in an indexed repository. | `bb_patterns`, `bb_security`, `bb_analyze` (complexity/stats) |
| `bb-doc-writing` | Use when asked to document a symbol, file, module, feature or API with resolvable citations and a freshness block. | `bb_doc` |
| `bb-migration-planning` | Use when planning a cross-language change or an API migration with dependency order and explicitly unsupported mappings. | `bb_migrate`, `bb_analyze` (impact) |
| `bb-graph-overview` | Use when the question is about architecture or dependency shape rather than one symbol, and a visual/overview answer is wanted. | `bb_visualize`, `bb_analyze` (stats) |

### Batch 3 — optional, after the core is proven (2)

| skill | frontmatter description | covers |
| --- | --- | --- |
| `bb-annotations` | Use when a finding should be attached to a symbol for other agents and later runs to read, rather than left as a comment in a file. | `bb_annotate`, `bb_annotations` |
| `bb-editor-setup` | Use when the user wants bb inside their editor (LSP hover/definition/references/symbols/call hierarchy) rather than through MCP. | `dist/lsp/server.js`, VSIX, Zed/Helix/LSP4IJ configs |

Coverage: all 16 MCP tools and all 14 CLI commands map to at least one skill above.

## 5. Why this order

`bb-install-and-connect` is first because without it nothing else can fire: the observed
failure mode is an agent that installed the package, never registered the server, and has no
skill to make it notice. `bb-evidence-reading` is in the first batch (not batch 2) because
"Evidence is the answer" is the product promise and it is the one instruction that must apply
to *every* tool answer — it is also the cheapest skill to get wrong (an agent that retries
around a `stale` flag is worse than one that never installed bb).

## 6. What a skill is not

Not a fork of `docs/tools/` (reference it), not a wrapper that hides declarations, not a
prompt that acts on tool output, and not a substitute for the installer: the skill can tell
an agent `bb mcp` exists, but only the installer puts the server in the host's config.
