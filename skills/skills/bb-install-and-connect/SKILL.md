---
name: bb-install-and-connect
description: Use when bb is installed but the agent has no bb tools, or when wiring bb into Claude Code, Cursor, VS Code, Codex, Gemini, opencode or another agent host.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: []
---
# Connect an agent to Backbencher Brain (`bb`)

`npm install -g @backbencher/brain` puts the binary on the machine, but it does **not**
register the MCP server in any agent host, and it does not install these skills. Three
separate layers make an agent actually able to use bb:

1. the binary (`bb --version` works),
2. the host's MCP registration (the tools appear in the agent's tool list),
3. this skills package (the agent knows when to call them).

Do them in that order, and prove each one before claiming the next.

## 1 · Binary

```bash
bb --version          # or: node <path-to>/bin/bb --version
bb index .            # index the project first; an agent with tools but no index gets refusals
```

If the index is missing or empty, switch to `bb-index-onboarding` before going further.

## 2 · Register the server in the host

The server is `bb mcp --dir <project>` speaking MCP over stdio. Each host keeps its own
config file; read the existing file and **merge** the entry, never replace the file:

- **VS Code family** (VS Code, Cursor, Antigravity): `.vscode/mcp.json` for VS Code,
  `.cursor/mcp.json` for Cursor — a `servers` entry with `"type": "stdio"`,
  `"command": "bb"`, `"args": ["mcp", "--dir", "."]` (or an absolute `node` + `bin/bb`
  pair when `bb` is not on the host's PATH).
- **Claude Code**: `claude mcp add bb -- bb mcp --dir <project>` (or the project
  `.mcp.json` equivalent).
- **Claude Desktop**: `claude_desktop_config.json` `mcpServers.bb`.
- **Codex / Gemini / opencode**: their own MCP config file; same stdio command.

Relative paths inside `args` are resolved by the host's process, so prefer
`"args": ["mcp", "--dir", "${workspaceFolder}"]` where the host supports variables.
Restart/reload the host after editing config.

## 3 · Prove the tools exist

After the reload, call `bb_health` once. A running server answers with index counts and a
freshness block. **Only after that call succeeds** may you say bb is connected. If the tool
is still absent, the config edit did not take — check the host's MCP log rather than
guessing.

## 4 · Install these skills

```bash
npx @backbencher/skills install --host claude     # or agents / copilot / user-claude / --dir
npx @backbencher/skills verify --host claude
```

The installer is idempotent and will not touch skill directories it did not create.

## Do not

- Do not claim bb is connected because the package is installed; a tool-list absence is a
  config fact, not a version fact.
- Do not overwrite a host config file wholesale — merge the one entry.
- Do not commit host config that embeds machine-specific absolute paths for a team repo;
  use a workspace variable or document the path.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
