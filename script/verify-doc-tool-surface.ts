// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the documentation ↔ registry surface gate: it proves that
//   every current-facing doc talks about EXACTLY the sixteen registered public
//   tools, that any retired name is marked as retired/dead/not-a-tool where it is
//   mentioned, that the "N tools" claims in the docs equal the registry count, and
//   that the generated catalogs (docs/data/public-tools.json,
//   website/src/data/tools.generated.ts, docs/tools/*.md) carry the registry's names,
//   modes and input-schema parameters unchanged.
// WHICH TOOLS IT SERVES — all sixteen. Test intelligence is a mode family inside
//   bb_analyze (test_mapping/test_gaps/test_impact/test_quality), NOT tools; retired
//   pre-0.3.0 names (bb_select, bb_write, bb_test_quality, …) are not tools either.
//   Those two facts are exactly what readers got wrong, so this gate checks them.
// WHY IT IS SHAPED THIS WAY — a tutorial table or a migration note MAY name a dead
//   tool to say it is dead, so the rule is not "never mention it" but "a retired name
//   is only allowed under a retired/dead/legacy/migration marker"; a generated file
//   is not parsed for prose, its exported data is compared to the registry object.
// WHERE ITS EVIDENCE LIVES — validation/release/DOC-TOOL-SURFACE.json.
// EDIT TOGETHER WHEN THIS CHANGES — the docs listed in SCAN_FILES/SCAN_DIRS,
//   src/mcp/tool-registry.ts (the authority), script/verify-tool-docs.ts (generator),
//   script/m48/website-doc.ts (website page), package.json (docs:verify chain).
// CONTRACTS IT MUST NOT BREAK — the tool list is imported, never written here; the
//   retired/legacy allowance is scoped to an explicit marker so normal prose cannot
//   smuggle a dead name in; every synthetic negative must be caught.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")
const EVIDENCE = join(ROOT, "validation", "release", "DOC-TOOL-SURFACE.json")

interface ToolFact {
  name: string
  mutability: string
  requiresIndex: boolean
  modes: string[]
  inputSchema: { properties?: Record<string, unknown>; required?: string[] }
}

/** Names that are NOT tools but legitimately appear as technical identifiers. */
const NON_TOOL_IDENTIFIERS: Record<string, string> = {
  fixtures: "external corpus directory path (~/fixtures/repositories), not a tool",
  bb_lsp: "editor/LSP method namespace (bb/graph, …), not an MCP tool name",
  bb_lsp_path: "LSP adapter environment variable, not a tool",
  bb_lsp_root: "LSP adapter environment variable, not a tool",
  bb_pool_worker: "internal indexer worker-pool identifier, not a tool",
  bb_stored_call_line: "IDE evidence identifier, not a tool",
  bb_sentinel: "internal sentinel marker in analysis-history tests, not a tool",
}

/** Pre-0.3.0 per-mode tool spellings. They may be named only where marked dead. */
const RETIRED_TOOLS = new Set([
  "bb_select", "bb_relationships", "bb_refresh", "bb_write", "bb_update",
  "bb_insert", "bb_delete", "bb_refactor", "bb_test_quality", "bb_test_suggestions",
  // Never existed at all; named in guides only to say it is not a tool, under the
  // same "not a tool / retired" marker rule as the spellings above.
  "bb_test_intel",
])

/** A context that turns a retired name into a truthful historical statement. */
const LEGACY_MARKER = /retir|dead|legacy|replacement history|removed|ghost|migration|not a (?:registered )?tool|0\.2\.x|pre-0\.3/i

const SCAN_FILES = [
  "README.md",
  "docs/README.md",
  "docs/TOOL-REGISTRY.md",
  "docs/TOOLS_OVERVIEW.md",
  "docs/TOOL-OWNERS.md",
  "docs/LANGUAGE-TOOL-MATRIX.md",
  "docs/GRAPH_ENGINE.md",
  "docs/ARCHITECTURE.md",
  "docs/EMBEDDINGS.md",
  "docs/man/bb.1",
]
const SCAN_DIRS = ["docs/tools", "docs/website", "docs/indexing"]
const HISTORICAL_SKIP = /^(m\d+|M\d+)|superseded|^archive$|^reviews$|^validation$|^node_modules$/

interface Violation { file: string; line: number; kind: string; detail: string }
const violations: Violation[] = []
let checks = 0
let negatives = 0
let negativeCaught = 0

function check(label: string, ok: boolean, detail = ""): boolean {
  checks++
  if (!ok) violations.push({ file: label, line: 0, kind: "check", detail })
  return ok
}
function negative(label: string, ok: boolean): void {
  negatives++
  if (ok) negativeCaught++
  else violations.push({ file: label, line: 0, kind: "negative", detail: "negative control did not hold" })
}

function walkFiles(dir: string, out: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walkFiles(full, out)
      else if (entry.isFile()) out.push(full)
    }
  } catch { /* unreadable dir = empty */ }
  return out
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length
}

/** True when the match sits under a heading or beside prose that marks it historical. */
function hasLegacyMarker(text: string, index: number): boolean {
  const before = text.slice(0, index)
  const headingRe = /^#{1,6}\s+(.+)$/gm
  let heading = ""
  for (const match of before.matchAll(headingRe)) heading = match[1]
  if (LEGACY_MARKER.test(heading)) return true
  const window = text.slice(Math.max(0, index - 700), Math.min(text.length, index + 700))
  return LEGACY_MARKER.test(window)
}

const TOKEN_RE = /\bbb_[a-z][a-z0-9_]*\b/g

/** Pure scanner used for real docs AND the synthetic negatives. */
function scanTokens(text: string, known: Set<string>): Violation[] {
  const out: Violation[] = []
  for (const match of text.matchAll(TOKEN_RE)) {
    const name = match[0]
    if (known.has(name) || name in NON_TOOL_IDENTIFIERS) continue
    if (RETIRED_TOOLS.has(name) && hasLegacyMarker(text, match.index ?? 0)) continue
    out.push({ file: "<text>", line: lineOf(text, match.index ?? 0), kind: "tool-name", detail: `${name} is not a registered tool and is not marked retired/dead` })
  }
  return out
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}
const COUNT_RE = new RegExp(
  `\\b(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:(?:public|canonical|MCP|first-class|distinct|separate|registered|total|overall)\\s+)+tools\\b`,
  "gi",
)

/** Pure count-claim scanner: any "N tools" claim must equal the registry count. */
function scanCounts(text: string, expected: number): Violation[] {
  const out: Violation[] = []
  for (const match of text.matchAll(COUNT_RE)) {
    const raw = match[1].toLowerCase()
    const value = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw]
    if (value === expected) continue
    const index = match.index ?? 0
    const window = text.slice(Math.max(0, index - 220), Math.min(text.length, index + 220))
    if (LEGACY_MARKER.test(window)) continue
    out.push({ file: "<text>", line: lineOf(text, index), kind: "tool-count", detail: `claim "${match[0]}" should be ${expected}` })
  }
  return out
}

async function main(): Promise<number> {
  const { PUBLIC_TOOL_DESCRIPTORS } = await import("../src/mcp/tool-registry")
  const registry = PUBLIC_TOOL_DESCRIPTORS as unknown as ToolFact[]
  const toolNames = new Set(registry.map((tool) => tool.name))
  const expectedCount = registry.length
  console.log(`DOC TOOL SURFACE — ${expectedCount} registered tools`)

  // 1. generated catalog parity (names, modes, parameters) -------------------
  const catalog = JSON.parse(readFileSync(join(ROOT, "docs", "data", "public-tools.json"), "utf8")) as
    | ToolFact[]
    | { tools: ToolFact[] }
  const catalogTools = Array.isArray(catalog) ? catalog : catalog.tools
  check("catalog tool count equals the registry", catalogTools.length === expectedCount, `${catalogTools.length} vs ${expectedCount}`)
  const catalogByName = new Map(catalogTools.map((tool) => [tool.name, tool]))
  for (const tool of registry) {
    const entry = catalogByName.get(tool.name)
    check(`catalog: ${tool.name} present`, Boolean(entry))
    if (!entry) continue
    check(`catalog: ${tool.name} modes equal the registry`,
      JSON.stringify(entry.modes) === JSON.stringify(tool.modes), JSON.stringify(entry.modes))
    check(`catalog: ${tool.name} parameters equal the registry`,
      JSON.stringify(Object.keys(entry.inputSchema?.properties ?? {}).sort()) ===
        JSON.stringify(Object.keys(tool.inputSchema?.properties ?? {}).sort()),
      `catalog=${Object.keys(entry.inputSchema?.properties ?? {}).sort().join(",")}`)
    check(`catalog: ${tool.name} required fields equal the registry`,
      JSON.stringify([...(entry.inputSchema?.required ?? [])].sort()) ===
        JSON.stringify([...(tool.inputSchema?.required ?? [])].sort()))
  }
  for (const entry of catalogTools) check(`catalog: ${entry.name} is registered`, toolNames.has(entry.name), "phantom catalog entry")

  // 2. generated website data parity ----------------------------------------
  const websiteData = await import("../website/src/data/tools.generated.ts") as { TOOL_FACTS: ToolFact[] }
  const websiteNames = websiteData.TOOL_FACTS.map((tool) => tool.name).sort()
  check("website generated data carries exactly the registered tools",
    JSON.stringify(websiteNames) === JSON.stringify([...toolNames].sort()), websiteNames.join(","))
  for (const tool of websiteData.TOOL_FACTS) {
    const registered = registry.find((entry) => entry.name === tool.name)
    // The website data table carries curated facts (no raw inputSchema); its
    // mode list must still equal the registry. Parameters are proven on the
    // catalog (above) and on the generated per-tool pages (byte-gated by
    // script/verify-tool-docs.ts).
    check(`website: ${tool.name} modes equal the registry`,
      Boolean(registered) && JSON.stringify(tool.modes) === JSON.stringify(registered!.modes),
      Boolean(registered) ? JSON.stringify(tool.modes) : "not registered")
  }

  // 3. generated tool pages are one per registered tool ---------------------
  const pageFiles = readdirSync(join(ROOT, "docs", "tools")).filter((file) => file.endsWith(".md")).sort()
  check("docs/tools has exactly one page per registered tool",
    pageFiles.length === expectedCount && pageFiles.every((file) => toolNames.has(file.replace(/\.md$/, ""))),
    `${pageFiles.length} page(s): ${pageFiles.join(",")}`)

  // 4. scan the current-facing docs ----------------------------------------
  const scanRoots: string[] = []
  for (const file of SCAN_FILES) {
    const full = join(ROOT, file)
    if (existsSync(full)) scanRoots.push(full)
  }
  for (const dir of SCAN_DIRS) {
    const full = join(ROOT, dir)
    if (existsSync(full)) scanRoots.push(...walkFiles(full))
  }
  // docs/BB_*.md deep guides (the tool-owned root guides) are part of the surface.
  for (const file of readdirSync(join(ROOT, "docs"))) {
    if (file.startsWith("BB_") && file.endsWith(".md")) scanRoots.push(join(ROOT, "docs", file))
  }
  const AUDIT_RECORD = /(?:AUDIT|REVIEW|FINDINGS|REPORT|INVENTORY)/i
  const scanned = [...new Set(scanRoots)].filter((full) => {
    const rel = full.slice(ROOT.length + 1)
    if (rel.split("/").some((part) => HISTORICAL_SKIP.test(part)) || /superseded/i.test(rel)) return false
    // Audit/review records deliberately quote stale claims as findings ("README
    // once said ten tools"); the surface docs are what a reader should trust.
    return !AUDIT_RECORD.test(rel.split("/").pop() ?? "")
  })
  for (const full of scanned) {
    const rel = full.slice(ROOT.length + 1)
    let text = ""
    try { text = readFileSync(full, "utf8") } catch { continue }
    for (const violation of scanTokens(text, toolNames)) {
      violations.push({ file: rel, line: violation.line, kind: violation.kind, detail: violation.detail })
    }
    for (const violation of scanCounts(text, expectedCount)) {
      violations.push({ file: rel, line: violation.line, kind: violation.kind, detail: violation.detail })
    }
  }

  // 5. negatives: the scanner must be able to go red ------------------------
  const known = toolNames
  negative("a normal-prose dead name is flagged", scanTokens("Use bb_test_quality for this.", known).length === 1)
  negative("a marked retired name is allowed",
    scanTokens("## Replacement history (dead names)\n\n| Legacy name (dead) |\n| `bb_test_quality` |", known).length === 0)
  negative("a retired name without a marker is flagged", scanTokens("| `bb_write` | `bb_edit` |", known).length === 1)
  negative("a stale QUALIFIED tool count is flagged", scanCounts("The ten public tools below are callable.", expectedCount).length === 1)
  negative("an unqualified subset count is not a surface claim", scanCounts("Three tools write the history rows.", expectedCount).length === 0)
  negative("the registry count is accepted", scanCounts(`The ${expectedCount} tools below are public.`, expectedCount).length === 0)
  negative("an allowlisted non-tool identifier is allowed", scanTokens("the fixtures repository root", known).length === 0)

  const deduped = violations.filter((violation, index, all) =>
    all.findIndex((other) => other.file === violation.file && other.line === violation.line && other.kind === violation.kind && other.detail === violation.detail) === index)
  for (const violation of deduped.slice(0, 40)) {
    console.log(`  FAIL: ${violation.file}:${violation.line} [${violation.kind}] ${violation.detail}`)
  }
  if (deduped.length > 40) console.log(`  … and ${deduped.length - 40} more`)

  let head = "unknown"
  try { head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
  const evidence = {
    probe: "doc-tool-surface",
    what: "current-facing docs mention only the registered tool surface; retired names appear only under a retired/dead/legacy marker; tool-count claims equal the registry; generated catalogs match the registry's names, modes and parameters",
    generatedAt: new Date().toISOString(),
    head,
    registeredTools: registry.map((tool) => ({ name: tool.name, modes: tool.modes, parameters: Object.keys(tool.inputSchema?.properties ?? {}).sort() })),
    counts: { tools: expectedCount, scannedFiles: scanned.length, checks, negatives, negativeCaught, violations: deduped.length },
    scannedFiles: scanned.map((full) => full.slice(ROOT.length + 1)),
    violations: deduped,
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n")

  const ok = deduped.length === 0 && negativeCaught === negatives
  console.log(`\nDOC TOOL SURFACE: ${ok ? "PASS" : "FAIL"} — ${expectedCount} registered tools, ${scanned.length} docs scanned, ${checks} checks, ${negativeCaught}/${negatives} negatives, ${deduped.length} violation(s)`)
  return ok ? 0 : 1
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
