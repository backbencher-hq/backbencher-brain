// script/m48/website-doc.ts — M48.W1 (#702) generator
// Generates docs/website/TOOLS.md from the executable registry artifact so the
// website document CANNOT drift from the code: every per-tool fact (purpose,
// contract, modes, planned modes, limitations, category) is derived, and the
// narrative sections are static text audited by the W1 gate.
// Run: bun run script/m48/website-doc.ts

import { writeFileSync, readFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { RELATIONS } from "../verify-tool-docs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const artifact = JSON.parse(readFileSync(resolve(root, "docs/data/public-tools.json"), "utf8")) as { tools: any[] }
const tools = artifact.tools

const HEADER = `<!--
WEBSITE AGENT INSTRUCTIONS (M48.W1 #702):
This file is GENERATED from the executable registry (script/m48/website-doc.ts).
Do NOT hand-edit it and do NOT copy tool facts from anywhere else — if a tool
changes, the registry changes, then run: bun run script/m48/website-doc.ts
The M48.W1 gate fails the build if this file drifts from the registry, if a
phantom/dead tool name appears, or if a planned (non-executable) mode is
advertised as executable. Publishing anything not derivable from this file
requires a registry change first.
-->

# Backbencher tools — the honest list

Backbencher's brain is one indexed knowledge base over your codebase. Two doors
read and update it:

- **CLI \`bb\`** — for humans in a terminal: \`bb index\`, \`bb index status\`,
  \`bb search\`, \`bb health\`, and the generic gateway \`bb tool <tool>\`.
- **MCP tools \`bb_*\`** — for AI agents over the Model Context Protocol: the
  same sixteen capabilities, machine-checkable schemas, structured JSON.

The doors are parity twins: the CLI and the MCP tool run the same handlers over
the same database. Where a CLI command and an MCP tool answer the same question
(\`bb index\` / \`bb_index\`, \`bb search\` / \`bb_search\`), their numbers come
from the same code paths.

## Replacement history (dead names)

Version 0.2.x advertised a ten-tool surface and kept legacy names as callable
aliases; 0.3.0 removed the aliases as announced — they now return \`unknown
tool\`. These names are NOT tools and must never appear as tools on the website:

| Legacy name (dead) | Use instead | Mode |
| --- | --- | --- |
| \`bb_select\` | \`bb_search\` | \`symbol\` |
| \`bb_relationships\` | \`bb_analyze\` | \`callers\`, \`callees\`, or \`trace\` (or \`bb_graph\`) |
| \`bb_refresh\` | \`bb_health\` | \`refresh\` |
| \`bb_write\` | \`bb_edit\` | \`write\` |
| \`bb_update\` | \`bb_edit\` | \`update\` |
| \`bb_insert\` | \`bb_edit\` | \`insert\` |
| \`bb_delete\` | \`bb_edit\` | \`delete\` |
| \`bb_refactor\` | \`bb_edit\` | \`refactor\` |
| \`bb_test_quality\` | \`bb_analyze\` | \`test_quality\` |
| \`bb_test_suggestions\` | \`bb_analyze\` | \`test_impact\` |

## Same question, which tool?

- "What references this symbol?" — \`bb_graph\` for the plain call graph with
  evidence tiers; \`bb_analyze\` mode \`callers\`/\`callees\`/\`trace\` for the
  richer analysis surface; \`bb_impact\` (or \`bb_analyze\` mode \`impact\`,
  identical numbers) when you need affected files and risk.
- "Where is this text/symbol/file?" — \`bb_search\`. "What does this code mean?"
  — \`bb_ask\` (semantic, cited).
- "Is my answer stale?" — every freshness-aware read declares it; refresh with
  \`bb_index\` mode \`dir\`/\`file\` or CLI \`bb index --changed\`.
- "Change this code" — \`bb_edit\`. "Leave a note for the team" —
  \`bb_annotate\` (write) / \`bb_annotations\` (read).
- "Find dead code / patterns" — \`bb_patterns\`. "Find taint/security findings"
  — \`bb_security\`.

## The sixteen tools

`

const FOOTER = `
---

Generated from the executable registry — regenerate with
\`bun run script/m48/website-doc.ts\`; the M48.W1 gate blocks drift.
`

function plannedLine(t: any): string {
  const planned: string[] = t.plannedModes ?? []
  if (planned.length === 0) return ""
  return `\n\nPlanned (roadmap, **not executable today**): ${planned.map((m: string) => `\`${m}\``).join(", ")}. Do not advertise these as available.`
}

let body = HEADER
for (const t of tools) {
  const rel = RELATIONS[t.name] ?? ""
  body += `### \`${t.name}\`\n\n${t.documentation.summary} ${rel ? rel : ""}\n\n`
  body += `- Category: \`${t.documentation.category}\` · Mutability: \`${t.mutability}\` · Requires an index: \`${t.requiresIndex ? "yes" : "no"}\`\n`
  body += `- Modes: ${(t.modes ?? []).map((m: string) => `\`${m}\``).join(", ")}\n`
  body += `- Shares with the IDE: ${ideSharing(t.name)}\n`
  const lims: string[] = t.limitations ?? []
  if (lims.length) body += `- Declared limitations: ${lims.join("; ")}\n`
  body += plannedLine(t)
  body += `\n`
}
body += FOOTER

function ideSharing(name: string): string {
  switch (name) {
    case "bb_graph": return "same canonical graph engine and evidence tiers as the editor graph panel"
    case "bb_impact": return "identical numbers to the editor's impact mode (one canonical walk, gate-enforced)"
    case "bb_cross_language": return "same cross-language pair data the editor hover surfaces"
    case "bb_annotate": return "annotations surface in the editor where the human reads (hover + graph)"
    case "bb_annotations": return "reads the same annotation store the editor hover shows"
    case "bb_search": return "same indexed symbol/file facts the editor uses"
    case "bb_edit": return "same surgical edit engine the editor's quick-fix path uses"
    default: return "index-backed; the editor reads the same database"
  }
}

mkdirSync(dirname(resolve(root, "docs/website/TOOLS.md")), { recursive: true })
writeFileSync(resolve(root, "docs/website/TOOLS.md"), body)
console.log(`website doc generated: ${tools.length} tools, ${body.length} bytes`)
