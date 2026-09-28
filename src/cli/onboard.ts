// src/cli/onboard.ts — M50.A3 (#765)
// `bb onboard <dir>` writes an AGENTS.md guidance section that an agent host
// (opencode, VS Code, Claude Code, Cursor) can read on every turn, so the bb
// tools are discoverable WITHOUT the user re-explaining them.
//
// Why this exists (measured, A1/A4): agents with the MCP connected still did
// not call the bb tools — and the guidance surfaces that did exist named tools
// that do not exist (see RETIRED_GHOST_TOOL_NAMES below for the exact list). A
// guidance file that lies is worse than no guidance file: the agent tries a
// ghost, gets "unavailable tool", and stops trusting the whole toolbox.
//
// Contract (enforced by script/m50/verify-a3-guidance-truth.ts):
//  1. The section is GENERATED from PUBLIC_TOOL_DESCRIPTORS. It cannot name a
//     tool that is not in the registry — no hand-maintained list to drift.
//  2. Writing is idempotent and non-destructive: only the marked block is
//     replaced; everything the user wrote outside the markers is preserved
//     byte-for-byte.
//  3. `--check` never writes; it reports drift and exits non-zero, so CI and
//     `bb doctor`-style callers can gate on it.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { PUBLIC_TOOL_DESCRIPTORS } from "../mcp/tool-registry"

export const GUIDANCE_START = "<!-- bb:onboard:start -->"
export const GUIDANCE_END = "<!-- bb:onboard:end -->"

/** Matches any bb_* identifier, so a guidance surface can be audited for ghosts. */
export const BB_TOOL_NAME_RE = /\bbb_[a-z0-9_]+\b/g

/** The removed pre-0.3.0 names. Kept ONLY so gates can prove they are gone. */
export const RETIRED_GHOST_TOOL_NAMES = [
  "bb_select",
  "bb_update",
  "bb_delete",
  "bb_insert",
  "bb_write",
  "bb_refresh",
  "bb_refactor",
  "bb_relationships",
] as const

function oneLine(summary: string): string {
  const flat = summary.replace(/\s+/g, " ").trim()
  const stop = flat.indexOf(". ")
  return stop > 0 ? flat.slice(0, stop + 1) : flat
}

// M50.A4 (#766): registry summaries describe WHAT a tool returns; an agent
// choosing between two tools needs the QUESTION each one answers. These
// clauses are the disambiguators — measured by the A4 gate over realistic task
// phrasings. Every key here must be a registry tool (checked by the A3 gate),
// so this table can add vocabulary but can never invent a tool.
export const TASK_DISAMBIGUATION: Record<string, string> = {
  bb_search: "Find a symbol, its exact source, or a file — exact/lexical lookup.",
  bb_ask: "Ask a natural-language question about behavior and get scored semantic matches.",
  bb_graph: "Who calls this symbol, and what does it call — per-symbol callers/callees, depth-bounded.",
  bb_impact: "What breaks if this symbol changes — reverse dependencies with a declared budget.",
  bb_visualize: "Show the dependency overview for a whole project/file/module at once, not one symbol.",
  bb_annotate: "Write a note on a symbol (agent-authored annotation).",
  bb_annotations: "Read notes back — all annotations, or one symbol's.",
  bb_analyze: "Typed per-mode analysis: callers/callees/stats/complexity/tests.",
  bb_patterns: "Find dead code, orphans, and anti-patterns.",
  bb_security: "Find taint flows and injection findings.",
  bb_health: "Is the index complete, fresh, and healthy.",
  bb_index: "Reindex just-written or changed files/directories.",
  bb_edit: "Change source code safely (preview, validate, rollback, reindex).",
  bb_doc: "Write cited documentation for a symbol, file, module, feature, or API.",
  bb_migrate: "Plan a cross-language migration with ordering and unsupported mappings.",
  bb_cross_language: "Show stored cross-language facts for one symbol (declared absent when none).",
}

/** The guidance block body, built only from the registry. */
export function renderGuidanceBody(): string {
  const names = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name)
  for (const name of names) {
    // Structural guard: the generator can only ever emit registry-real names.
    if (!/^bb_[a-z0-9_]+$/.test(name)) throw new Error(`bb onboard: registry name is not a public tool name: ${name}`)
  }
  const rows = PUBLIC_TOOL_DESCRIPTORS.map((d) => {
    const whenToUse = TASK_DISAMBIGUATION[d.name] ?? oneLine(d.documentation.summary)
    return `| \`${d.name}\` | ${whenToUse} | ${d.mutability === "read" ? "no" : "**yes**"} |`
  })
  const writeTools = PUBLIC_TOOL_DESCRIPTORS.filter((d) => d.mutability !== "read").map((d) => `\`${d.name}\``)
  return [
    "# Backbencher Brain (bb)",
    "",
    "This project is indexed by bb. Use the bb MCP tools below for code questions — they read the",
    "indexed AST (symbols, relationships, taint, embeddings) and report staleness instead of guessing.",
    "",
    "| Tool | Use when | Mutates files? |",
    "|---|---|---|",
    ...rows,
    "",
    `These are the only bb tools (${names.length} total). A name that is not in this table does not exist —`,
    "if you call it you will get \"unavailable tool\" and learn nothing.",
    "",
    "Read tools answer from the index and declare staleness (`fresh`/`stale`/`missing`); reads that find stale",
    "files refresh them within budget and say so in the answer.",
    writeTools.length > 0
      ? `Write tools (${writeTools.join(", ")}) change the index or source — call them only when the user asks for that change.`
      : "All registered tools are read-only.",
  ].join("\n")
}

/** The marked guidance section (markers included) — the unit that is written. */
export function renderGuidanceSection(): string {
  return `${GUIDANCE_START}\n${renderGuidanceBody()}\n${GUIDANCE_END}\n`
}

/** Extract the marked block, or null when the file has no block. */
export function extractGuidanceSection(text: string): string | null {
  const start = text.indexOf(GUIDANCE_START)
  const end = text.indexOf(GUIDANCE_END)
  if (start === -1 || end === -1 || end < start) return null
  return text.slice(start, end + GUIDANCE_END.length + 1)
}

/** Replace the marked block in place; append when absent. Idempotent. */
export function applyGuidanceSection(existing: string, section: string): { text: string; action: "inserted" | "replaced" | "appended" } {
  const current = extractGuidanceSection(existing)
  if (current !== null) {
    if (current === section) return { text: existing, action: "replaced" }
    return { text: existing.replace(current, section), action: "replaced" }
  }
  if (existing.trim() === "") return { text: section, action: "inserted" }
  const sep = existing.endsWith("\n") ? "\n" : "\n\n"
  return { text: `${existing}${sep}${section}`, action: "appended" }
}

/** Every bb_* name mentioned in arbitrary text. */
export function toolNamesIn(text: string): string[] {
  return text.match(BB_TOOL_NAME_RE) ?? []
}

/** Names mentioned in `text` that the registry does not define. */
export function ghostToolNames(text: string, registryNames: readonly string[] = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name)): string[] {
  const known = new Set(registryNames)
  return [...new Set(toolNamesIn(text).filter((n) => !known.has(n)))].sort()
}

/** Registry names the guidance fails to mention. */
export function missingToolNames(section: string, registryNames: readonly string[] = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name)): string[] {
  const mentioned = new Set(toolNamesIn(section))
  return registryNames.filter((n) => !mentioned.has(n)).sort()
}

export interface OnboardResult {
  dir: string
  file: string
  action: "inserted" | "replaced" | "appended" | "unchanged" | "would-write" | "drift" | "missing"
  changed: boolean
  ghosts: string[]
  missing: string[]
}

function guidanceFile(dir: string): string {
  return path.join(dir, "AGENTS.md")
}

/**
 * Write (or check) the guidance section. `check` never writes.
 */
export function onboard(dir: string, opts: { check?: boolean; print?: boolean; file?: string } = {}): OnboardResult {
  const file = opts.file ?? guidanceFile(dir)
  const section = renderGuidanceSection()
  const existing = existsSync(file) ? readFileSync(file, "utf8") : ""
  const current = extractGuidanceSection(existing)
  const ghosts = ghostToolNames(current ?? "")
  const missing = missingToolNames(current ?? "")

  if (opts.print) return { dir, file, action: "would-write", changed: false, ghosts, missing }

  if (opts.check) {
    if (current === null) return { dir, file, action: "missing", changed: true, ghosts, missing }
    const conformant = current === section && ghosts.length === 0 && missing.length === 0
    return { dir, file, action: conformant ? "unchanged" : "drift", changed: !conformant, ghosts, missing }
  }

  const { text, action } = applyGuidanceSection(existing, section)
  if (text === existing) return { dir, file, action: "unchanged", changed: false, ghosts, missing }
  writeFileSync(file, text)
  return { dir, file, action, changed: true, ghosts, missing }
}

/** Human-readable render for the CLI. */
export function renderOnboardResult(r: OnboardResult): string {
  switch (r.action) {
    case "unchanged":
      return `✓ ${r.file} is current (${PUBLIC_TOOL_DESCRIPTORS.length} tools, no ghosts)`
    case "drift":
      return [
        `✗ ${r.file} guidance is out of date`,
        r.ghosts.length > 0 ? `  ghost tool names: ${r.ghosts.join(", ")}` : "",
        r.missing.length > 0 ? `  registry tools not mentioned: ${r.missing.join(", ")}` : "",
        "  run: bb onboard <dir>",
      ]
        .filter(Boolean)
        .join("\n")
    case "missing":
      return `✗ ${r.file} has no bb guidance section — run: bb onboard <dir>`
    case "would-write":
      return renderGuidanceSection()
    default:
      return `✓ ${r.file} guidance ${r.action} (${PUBLIC_TOOL_DESCRIPTORS.length} tools)`
  }
}
