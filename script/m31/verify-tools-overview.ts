// script/m31/verify-tools-overview.ts — M31.D3
//
// Structural truth gate for docs/TOOLS_OVERVIEW.md. The overview is narrative,
// so this gate checks its FACTS, mechanically, against the authorities:
//
//   1. Every registry tool has an overview section (### bb_*).
//   2. No tool is mentioned in a per-tool section that is not in the registry
//      (no aspirational/phantom tools).
//   3. Per-tool facts (category / mutability / requiresIndex / modes) match the
//      live registry exactly.
//   4. Every DB artifact named in the overview exists in the schema (CREATE
//      TABLE in src/brain).
//   5. Cross-link map rows: tool exists; relation targets exist; read/write
//      artifacts exist in schema; write-tool rows are consistent with
//      registry mutability (mut=write required for any writes besides the
//      bb_patterns/bb_security recordRun exception, which is registered).
//   6. Honesty wording: banned absolute claims ("guaranteed", "100% accurate",
//      "never fails") that static analysis cannot support.
//   7. Heading/link lint: relative markdown links resolve on disk.
//
// Honors BB_M31_ROOT (G1 test seam) so the mutation self-test can exercise it
// in a sandbox. Exit 0 = all checks pass; exit 1 with named failures otherwise.

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REPO = process.env.BB_M31_ROOT ? path.resolve(process.env.BB_M31_ROOT) : ROOT

// ── load authorities ──────────────────────────────────────────────────────
// Registry is imported as a value; schema facts are parsed from source so the
// gate sees the same truth the runtime sees. Both reads go through BB_M31_ROOT
// via the file reads below, but the registry import is from the real tree —
// acceptable because registry facts are also byte-pinned in the D1 gate; here
// the sandbox mutations target the DOC, not the registry.
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const docPath = path.join(REPO, "docs/TOOLS_OVERVIEW.md")
const dbSrc = readFileSync(path.join(ROOT, "src/brain/schema-ddl.ts"), "utf8")

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

if (!existsSync(docPath)) {
  console.log("FAIL: docs/TOOLS_OVERVIEW.md missing")
  process.exit(1)
}
const doc = readFileSync(docPath, "utf8")

// ── 1+2. sections == registry tools, no phantom tools ────────────────────
const sectionRe = /^### (bb_[a-z_]+)$/gm
const sections: string[] = [...doc.matchAll(sectionRe)].map((m) => m[1])
const registryNames = PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name).sort()
const missing = registryNames.filter((n) => !sections.includes(n))
check("every registry tool has an overview section", missing.length === 0, `missing: ${missing.join(", ") || "none"}`)
const phantom = sections.filter((s) => !registryNames.includes(s))
check("no phantom tools in sections", phantom.length === 0, phantom.join(", ") || "")
check("sections are unique", new Set(sections).size === sections.length, "")

// ── 3. per-tool facts match the registry ─────────────────────────────────
for (const d of PUBLIC_TOOL_DESCRIPTORS) {
  const body = doc.slice(doc.indexOf(`### ${d.name}`))
  const nextIdx = body.indexOf("\n### ", 1)
  const section = nextIdx > 0 ? body.slice(0, nextIdx) : body
  const facts: [string, boolean][] = [
    [`category: ${d.documentation.category}`, section.includes(`**Category:** ${d.documentation.category}.`)],
    [`mutability: ${d.mutability}`, section.includes(`**Mutability:** ${d.mutability}.`)],
    [`requiresIndex: ${d.requiresIndex}`, new RegExp(`\\*\\*Requires index:\\*\\* (yes|no)\\b`).exec(section)?.[1] === (d.requiresIndex ? "yes" : "no")],
    [`modes: [${d.modes.join(", ")}]`, section.includes(`**Modes:** ${d.modes.map((m) => `\`${m}\``).join(", ")}.`)],
  ]
  for (const [label, ok] of facts) check(`${d.name} ${label}`, ok, "")
}

// ── 4. every DB artifact named in the doc exists in the schema ────────────
const schemaTables = new Set([...dbSrc.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]))
const namedArtifacts = new Set([...doc.matchAll(/\bbrain_[a-z_]+\b/g)].map((m) => m[0]))
const badArtifacts = [...namedArtifacts].filter((a) => !schemaTables.has(a))
check("all named DB artifacts exist in schema", badArtifacts.length === 0, badArtifacts.join(", ") || "")

// ── 5. cross-link map rows ────────────────────────────────────────────────
const mapStart = doc.indexOf("| tool | reads | writes | related |")
check("cross-link map table present", mapStart > 0, "")
if (mapStart > 0) {
  const mapText = doc.slice(mapStart)
  const rows = [...mapText.matchAll(/^\| (bb_[a-z_]+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|$/gm)]
  check("cross-link map covers every registry tool", rows.length === registryNames.length && new Set(rows.map((r) => r[1])).size === rows.length, `rows=${rows.length} registry=${registryNames.length}`)
  // registered documented exception: read-mutability tools that persist analysis runs
  const RECORDRUN_WRITERS = new Set(["bb_patterns", "bb_security"])
  for (const r of rows) {
    const tool = r[1]
    const reads = r[2].split(",").map((s) => s.trim()).filter((s) => s && s !== "—" && !s.includes("("))
    const writes = r[3].split(",").map((s) => s.trim()).filter((s) => s && s !== "—" && !s.includes("("))
    const related = r[4].split(",").map((s) => s.trim()).filter((s) => s && s !== "—")
    const d = PUBLIC_TOOL_DESCRIPTORS.find((x) => x.name === tool)
    check(`${tool}: row tool is in registry`, d !== undefined, "")
    if (!d) continue
    for (const a of reads) check(`${tool}: read artifact ${a} exists in schema`, schemaTables.has(a), "")
    for (const a of writes) check(`${tool}: write artifact ${a} exists in schema`, schemaTables.has(a), "")
    for (const t of related) check(`${tool}: related tool ${t} in registry`, registryNames.includes(t), "")
    if (writes.length > 0 && d.mutability !== "write") {
      check(`${tool}: read-mutability writes are the registered recordRun exception`, RECORDRUN_WRITERS.has(tool), `writes=${writes.join(",")}`)
    }
  }
}

// ── 6. honesty wording ────────────────────────────────────────────────────
const banned = [/guaranteed/i, /100%\s*accurate/i, /never\s+fails/i, /always\s+correct/i, /bug[- ]free/i]
const hits: string[] = []
for (const re of banned) if (re.test(doc)) hits.push(String(re))
check("no banned absolute claims", hits.length === 0, hits.join("; "))

// ── 7. heading/link lint: relative markdown links resolve ────────────────
const linkRe = /\[[^\]]+\]\((?!https?:|#|mailto:)([^)\s]+)\)/g
const deadLinks: string[] = []
for (const m of doc.matchAll(linkRe)) {
  const href = m[1].split("#")[0]
  if (!href) continue
  if (!existsSync(path.resolve(REPO, "docs", href))) deadLinks.push(m[1])
}
check("no dead relative links", deadLinks.length === 0, deadLinks.join(", ") || "")

// ── evidence + exit ───────────────────────────────────────────────────────
console.log(`tools-overview gate: ${passed}/${checks} checks passed`)
if (process.env.BB_M31_EVIDENCE) {
  const { mkdirSync, writeFileSync } = await import("node:fs")
  const { execSync } = await import("node:child_process")
  let commit = "unknown"
  try { commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim() } catch {}
  mkdirSync(path.join(ROOT, "validation/m31/results"), { recursive: true })
  // Write into the GOVERNED root (BB_M31_ROOT), not the repo root — a sandboxed
  // run must never poison the real evidence files (D1/T1 lesson, emitter side).
  writeFileSync(path.join(REPO, "validation/m31/results/D3.json"), JSON.stringify({
    issue: "M31.D3", gate: "verify-tools-overview.ts", status: failures.length === 0 ? "verified" : "failed",
    passed, failed: failures.length, checks,
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m31/verify-tools-overview.ts",
    evidenceFile: "D3.json",
    generatedAt: new Date().toISOString(),
    surfaces: { doc: "docs/TOOLS_OVERVIEW.md", registryTools: registryNames.length, dbArtifacts: [...namedArtifacts].sort() },
    negativeCases: 4,
    negativeCasesDescription: "self-test mutations: phantom tool section, wrong mode list, phantom DB artifact, corrupted cross-link row",
    currentCommit: commit,
  }, null, 2))
}
process.exit(failures.length === 0 ? 0 : 1)
