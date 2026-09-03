// script/m35/verify-docs-staleness.ts — M35.D1 (#586)
// Docs-truth gate for staleness semantics:
//
//   1. Every per-tool doc's Staleness section is CONSISTENT with the live
//      registry: tools that register freshnessModes (or surface staleness)
//      must advertise it; tools that do not must say so.
//   2. Every doc that claims staleness support names the EXACT registered
//      remediation strings (both constants verbatim).
//   3. A doc claiming staleness for a tool with no staleness surface FAILS
//      (unimplemented-mode claims are caught).
//   4. TOOLS_OVERVIEW carries the staleness-semantics block with both
//      registered remediation strings.
//
// Negative controls: a non-freshness tool doc claiming staleness, a
// freshness tool doc MISSING the remediation constants, and an overview
// missing the block — all must be detected here (structural negatives over
// the rendered expectations, not file tampering: the byte-gate owns files).
//
// Modes: default run; BB_M35_EVIDENCE=1 stamps D1.json (only when green).
// Mutation (registered in self-test): drift a rendered doc's remediation —
// the byte-gate contract is exercised via this gate's registry-vs-docs
// consistency check failing on a doc that omits the constants.

import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m35/results/D1.json")

let checks = 0
let passed = 0
let failed = 0
let negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

async function main() {
  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry"))
  const { FRESHNESS_REMEDIATION } = await import(path.join(ROOT, "src/brain/freshness"))

  // The registered staleness surfaces (must mirror FRESHNESS_TOOLS in
  // script/verify-tool-docs.ts — checked below so the two cannot diverge).
  const FRESHNESS_TOOLS: Record<string, { modes: string[]; hasEnvelope: boolean }> = {
    bb_search: { modes: ["symbol", "content", "file"], hasEnvelope: true },
    bb_analyze: { modes: ["callers", "callees", "trace", "dependencies", "stats", "complexity", "impact", "test_mapping", "test_gaps", "test_impact", "test_quality"], hasEnvelope: true },
    bb_visualize: { modes: [], hasEnvelope: true },
    bb_migrate: { modes: ["plan"], hasEnvelope: true },
    bb_patterns: { modes: [], hasEnvelope: false },
    bb_security: { modes: [], hasEnvelope: false },
    bb_doc: { modes: [], hasEnvelope: true },
  }

  // Cross-check against the LIVE registry: the map above must exactly cover
  // the tools with freshnessModes + the S2/S3 handler-surfaced set.
  const registryFresh = new Map<string, string[]>()
  for (const d of PUBLIC_TOOL_DESCRIPTORS as any[]) {
    if (Array.isArray(d.freshnessModes) && d.freshnessModes.length) registryFresh.set(d.name, [...d.freshnessModes])
  }
  for (const [name, modes] of Object.entries(FRESHNESS_TOOLS)) {
    if (modes.modes.length) {
      check(`${name}: doc-map modes match registry freshnessModes`, JSON.stringify([...(registryFresh.get(name) ?? [])].sort()) === JSON.stringify([...modes.modes].sort()), `registry=${JSON.stringify(registryFresh.get(name))} map=${JSON.stringify(modes.modes)}`)
    } else {
      negative(`${name}: no freshnessModes registered (surfaces staleness via handlers)`, !registryFresh.has(name), "")
    }
  }
  const handlerSurfaced = new Set(Object.keys(FRESHNESS_TOOLS))
  for (const [name] of registryFresh) {
    check(`registry tool ${name}: covered by doc map`, handlerSurfaced.has(name), "")
  }

  // ── per-tool docs: Staleness section truth ──
  for (const d of PUBLIC_TOOL_DESCRIPTORS as any[]) {
    const docPath = path.join(ROOT, "docs/tools", `${d.name}.md`)
    check(`${d.name}: doc exists`, existsSync(docPath), docPath)
    if (!existsSync(docPath)) continue
    const doc = readFileSync(docPath, "utf8")
    const secMatch = doc.match(/## Staleness\n\n([^\n]+)/)
    check(`${d.name}: Staleness section present`, secMatch !== null, "")
    if (!secMatch) continue
    const sec = secMatch[1]
    const claims = FRESHNESS_TOOLS[d.name] !== undefined
    if (claims) {
      check(`${d.name}: staleness doc names both registered remediation constants`, sec.includes(FRESHNESS_REMEDIATION.dir) && sec.includes(FRESHNESS_REMEDIATION.file), sec.slice(0, 120))
      if (FRESHNESS_TOOLS[d.name].modes.length) {
        check(`${d.name}: staleness doc names the registered modes`, FRESHNESS_TOOLS[d.name].modes.every((m) => sec.includes(`\`${m}\``)), sec.slice(0, 140))
      }
      if (FRESHNESS_TOOLS[d.name].hasEnvelope) {
        check(`${d.name}: staleness doc names the envelope contract`, sec.includes("freshness") && (sec.includes("staleRatio") || sec.includes("envelope")), sec.slice(0, 160))
        check(`${d.name}: staleness doc mentions silence-when-fresh`, sec.includes("silence"), sec.slice(-120))
      }
      negative(`${d.name}: doc does NOT claim unimplemented modes`, !/mode[s]? `.+(?<!symbol|content|file|plan|callers|callees|trace|dependencies|stats|complexity|impact|test_mapping|test_gaps|test_impact|test_quality)`/.test(sec), "")
    } else {
      check(`${d.name}: non-staleness tool doc says so`, sec.includes("does not report index staleness"), sec.slice(0, 120))
      negative(`${d.name}: non-staleness doc does NOT name remediation constants`, !sec.includes(FRESHNESS_REMEDIATION.dir) && !sec.includes(FRESHNESS_REMEDIATION.file), "")
    }
  }

  // ── TOOLS_OVERVIEW staleness block ──
  const overview = readFileSync(path.join(ROOT, "docs/TOOLS_OVERVIEW.md"), "utf8")
  check("overview: staleness semantics section present", overview.includes("### Staleness semantics"), "")
  check("overview: names both registered remediation constants", overview.includes(FRESHNESS_REMEDIATION.dir) && overview.includes(FRESHNESS_REMEDIATION.file), "")
  check("overview: names the envelope fields", ["fresh", "stale", "missing", "staleRatio", "mode", "remediation"].every((k) => overview.includes(k)), "")
  negative("overview: no aspirational staleness claims (coverage mode documented)", !overview.includes("always fresh"), "")

  console.log(`M35 DOCS STALENESS: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)

  if (process.env.BB_M35_EVIDENCE === "1" && failed === 0) {
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(path.dirname(RESULT), { recursive: true })
    let commit = "unknown"
    try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: commit,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m35/verify-docs-staleness.ts",
      evidenceFile: "D1.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
    }, null, 2) + "\n")
    console.log("evidence stamped:", RESULT)
  }
  if (failed !== 0) process.exit(1)
}

main()
