# Skills inventory and gap analysis (2026-11-09)

Status: IMPLEMENTED 2026-11-09. The nine skills described below now exist in `skills/`, ship
as `@backbencher/skills` with an installer (`bin/bb-skills.mjs`), and are gated by
`script/verify-skills.ts` (167/167 checks, run by `npm test`). This page keeps the audit that
produced them: what was installed before, what the product surface is, and the budget rules.

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
2. **No installer.** `npm i -g @backbencher/brain` puts files on disk; it does not register the
   stdio MCP server in any host, and there is no command that copies skills into
   `.claude/skills/`, `.agents/skills/`, `.github/skills/`, etc.
3. **No skills gate.** Nothing validates frontmatter, "use when" descriptions, referenced
   tool names against the registry (ghost-tool class), or version lock to the package.
4. **No "is it actually being used" check.** `bb doctor` diagnoses embeddings/index, not
   "server registered / skills installed / guidance current".

## 4. Proposed catalog (final target: 9 skills; full tool + CLI coverage)

Descriptions are the frontmatter text an agent routes on — all start with "use when".

### Batch 1 — the routing + safety core (5)

| skill | frontmatter description | covers |
| --- | --- | --- |
| `bb-install-and-connect` | Use when bb is installed but the agent has no bb tools, or when wiring bb into Claude Code, Cursor, VS Code, Codex, Gemini, opencode or a DSH workspace. | `bb mcp`, `bb onboard`, `bb upgrade`, `bb doctor`, host config merge |
| `bb-code-navigation` | Use when you need to find a symbol, its callers/callees, what a change breaks, or a cross-language handoff — instead of guessing from grep. | `bb_search`, `bb_ask`, `bb_graph`, `bb_impact`, `bb_cross_language`, `bb analyze` modes |
| `bb-evidence-reading` | Use when a bb answer reports freshness, staleness, truncation, confidence, declared absence or unsupported coverage — read it and surface it, never present it as complete. | every tool's declarations; `bb_health` |
| `bb-edit-safety` | Use when changing source through `bb_edit` (write/update/insert/delete/refactor): dry runs, modes, pre-image checks, batch atomicity, formatter behaviour, and when a refusal is the correct outcome. | `bb_edit`, `bb_index` post-pass |
| `bb-report-writing` | Use when a bb tool returns something wrong or misleading and the agent must produce a reproducible report (version, doctor, tool call, freshness, expected vs actual). | agent-report issue form, `bb --version`, `bb doctor` |

### Batch 2 — the workflows that already have evidence records (4; graph-overview merged into navigation)

| skill | frontmatter description | covers |
| --- | --- | --- |
| `bb-index-onboarding` | Use when a project is not indexed yet, results look empty, or semantic search needs the embedding provider set up. | `bb index`, `bb setup`, `bb doctor`, `bb stats`, `bb status`, `bb projects` |
| `bb-code-audit` | Use when asked for dead code, anti-patterns, security exposure or complexity hotspots in an indexed repository. | `bb_patterns`, `bb_security`, `bb_analyze` (complexity/stats) |
| `bb-doc-writing` | Use when asked to document a symbol, file, module, feature or API with resolvable citations and a freshness block. | `bb_doc` |
| `bb-migration-planning` | Use when planning a cross-language change or an API migration with dependency order and explicitly unsupported mappings. | `bb_migrate`, `bb_analyze` (impact) |
**Merged:** architecture/dependency-overview questions are the same routing family as
callers/callees — `bb-code-navigation` covers them with `bb_visualize` and `bb-analyze stats`
instead of a separate `bb-graph-overview` trigger competing for the same tasks.

### Deferred (not skills; docs or commands instead)

| skill | frontmatter description | covers |
| --- | --- | --- |
| `bb-annotations` | folded into `bb-edit-safety`'s references (annotations are adjacent to edit workflows), not a standalone skill |
| `bb-editor-setup` | belongs to `bb-install-and-connect`'s references and the IDE docs, not a separate skill |

Coverage: all 16 MCP tools and all 14 CLI commands map to at least one skill above.

## 4b. Context budget (measured 2026-11-09)

A skill costs context in two places, and only the first is always-on:

| cost | measured | rule |
| --- | --- | --- |
| catalog (name + description), always-on | 12 proposed skills = 1,397 chars ≈ 349 tokens; batch-1 five = 632 chars ≈ 158 tokens | **catalog ≤ 9 skills**; each description unique and task-shaped, start with "use when" |
| body, only when selected | — | **SKILL.md ≤ ~1.5k tokens (≈120 lines)**; tables/corpora move to `references/`, loaded on demand |

For scale: the bb MCP server's 16 tool definitions already cost 29,476 chars
(≈7,369 tokens) in every connected agent, and the 137 installed skills' catalog costs
37,326 chars (≈9,331 tokens). The 9-skill catalog is ~4% of the MCP tool cost — count is
not the budget problem. **Description collision is**: two skills that plausibly match the
same task make routing worse for every skill in the catalog. Hence merge rather than split.

Retirement rule: a skill whose description has not matched across a release cycle is
removed from the package (no tombstone skill), because a stale trigger taxes every
session that keeps it.

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

## 7. Implemented state (2026-11-09)

- **Content:** `skills/skills/<name>/SKILL.md` — nine skills, 46–74 lines each, every
  description a "use when" line, every file ending with the canonical optional-report
  paragraph and containing the shared-rules line verbatim.
- **Ownership:** each of the 16 public MCP tools is owned by exactly ONE skill
  (`owner-tools` frontmatter); the gate fails on a gap or a double claim. CLI commands are
  covered by the package README's quick reference.
- **No attribution:** the shared-rules line each skill carries forbids `Co-Authored-By`,
  `Generated with`, or any bb/Backbencher credit line; the gate blacklist-fails such phrases.
- **Installer:** `npx @backbencher/skills install [--host claude|agents|copilot|user-claude]
  [--dir <path>] [--dry-run] [--force] [--json]`, plus `verify` and `list`. Writes
  `.bb-skills.json`, is idempotent, and refuses to overwrite a skill directory it did not
  install. The gate exercises all five behaviours in a temp directory.
- **Package:** `@backbencher/skills` v0.1.0, MIT, `files: [bin/, skills/, README.md, LICENSE]`.
- **Release:** `script/release/split-public-repos.sh` now derives a third artifact
  (`skills/` subtree → its own repo, from the SAME verified/redacted clone), and the brain
  artifact excludes `website/` and `skills/`.
