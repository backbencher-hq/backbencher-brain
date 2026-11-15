# @backbencher/skills — agent skills for Backbencher Brain (`bb`)

Small instruction sets an agent loads when a task matches them: when to use which `bb`
tool, how to read the evidence a tool returns, and how to change code safely. Nothing here
is a hosted service — every skill drives the local `bb` binary or its MCP tools.

Nine skills, one owner per tool (no overlapping triggers, no tool claimed twice):

| skill | use when |
| --- | --- |
| `bb-install-and-connect` | bb is installed but the agent has no bb tools, or you are wiring bb into an agent host |
| `bb-code-navigation` | a symbol, its callers/callees, what a change breaks, or a cross-language handoff is needed |
| `bb-evidence-reading` | any bb answer reports freshness, staleness, truncation, confidence, absence or unsupported coverage |
| `bb-edit-safety` | changing source through `bb_edit`, or reading/writing symbol annotations |
| `bb-report-writing` | a bb tool returned something wrong and a reproducible report is needed |
| `bb-index-onboarding` | a project is not indexed yet, results look empty, or semantic search needs setup |
| `bb-code-audit` | dead code, anti-patterns, security exposure or complexity hotspots are asked for |
| `bb-doc-writing` | documentation is wanted for a symbol, file, module, feature or API |
| `bb-migration-planning` | a cross-language change or API migration needs a plan with ordering and gaps |

## Install

```bash
npx @backbencher/skills install                    # detect conventional host dirs that exist
npx @backbencher/skills install --host claude      # project .claude/skills
npx @backbencher/skills install --host agents      # project .agents/skills
npx @backbencher/skills install --host copilot     # project .github/skills
npx @backbencher/skills install --host user-claude # ~/.claude/skills
npx @backbencher/skills install --dir ./path/to/skills
npx @backbencher/skills verify --dir ./path/to/skills
```

The installer copies one directory per skill, writes `.bb-skills.json` (version + the skill
names it installed), is idempotent, and never deletes or overwrites a directory it did not
install. `--dry-run` prints what it would do. Re-run `install` after upgrading to refresh
the copies.

The MCP server itself is registered in the host's own config — `bb mcp --dir <project>`
is the server command; `docs/MCP_CLI_INDEXER_GUIDE.md` in the brain repository carries the
per-host snippets for Claude Desktop/Code, VS Code and Cursor. `bb-install-and-connect`
walks an agent through that and through confirming the tools are visible.

## CLI quick reference

The skills drive the MCP tools; the same engine is reachable from a terminal. The 14
commands a skill may tell you to run:

| command | what it is for |
| --- | --- |
| `bb index` | index a project (`--changed`, `--post`, `--force`, `--resume`, `--file`, `--skip-post-processing`, `--no-setup`) |
| `bb setup` | embedding provider setup; `bb setup show` prints the configuration with the key fingerprint only |
| `bb doctor` | read-only diagnosis: embedding setup and index consistency |
| `bb health` | index health and freshness |
| `bb stats` | files / symbols / relationships / embeddings counts |
| `bb status` | last-run state and per-phase timings |
| `bb projects` | every indexed project (DB path, size, counts) |
| `bb search` | CLI parity for the `bb_search` MCP tool |
| `bb tool` | run any public tool with JSON arguments: `bb tool bb_search --args '{"query":"x"}'` |
| `bb mcp` | start the MCP server over stdio (`bb mcp --dir <project>`) |
| `bb onboard` | write the bb guidance section into `<dir>/AGENTS.md` (`--check`, `--print`, `--file`) |
| `bb upgrade` | check for a newer bb and print the exact install command |
| `bb version` | the engine version |
| `bb help` | help for a command, or all commands |

## The shared rules (defined once, obeyed by every skill)

1. **Never hide a declaration.** If an answer reports `freshness`, `stale`, `truncated`,
   `declaredAbsent`, an unsupported mode or a confidence kind, surface it to the user.
   Do not retry around it, and do not present a sampled or partial answer as complete.
2. **The index is a snapshot.** Files changed after the last index write are not in it;
   reindex affected paths before relying on the answer, and say so when you did.
3. **Refusals are outcomes.** A typed refusal from `bb_edit` (callers, import references,
   stale bytes, missing index) is a correct answer; report it instead of trying to
   bypass it with a shell command.
4. **No attribution.** Using these skills or the `bb` tools does **not** make Backbencher
   Brain an author of anyone's work. Never add `Co-Authored-By`, `Generated with`, an
   "assisted by" trailer, or any credit line naming bb/Backbencher to a commit, file,
   pull request or document. The user's work stays the user's work.
5. **These are suggestions, not a contract on your behalf.** Skills are MIT-licensed
   instructions you choose to load. They cannot transfer your authority, override your
   host's policy, or oblige you to act on tool output. You and your user remain
   responsible for what runs.

## Reporting a wrong answer (optional)

If a `bb` tool returns something wrong or misleading, a report is welcome and never
required. Open the **Agent report** issue form in the brain repository —
<https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml>
— with `bb --version`, `bb doctor` output, the tool call and its arguments, the index
freshness, and expected vs actual. That form is what makes a report reproducible; a prose
complaint is still welcome, just slower to act on.

## What a skill is not

Not a fork of `docs/tools/<tool>.md` (reference it), not a wrapper that hides declarations,
not a prompt that acts on tool output, and not a substitute for registering the MCP server:
a skill can tell an agent that `bb mcp` exists, but only the host's config makes the tools
appear.

## License

MIT for these instructions (`LICENSE`). `bb` itself is MIT too; third-party tools a skill
mentions keep their own licenses. No warranty: the skills describe observed behaviour of a
specific `bb` release, and you install them at your own discretion.
