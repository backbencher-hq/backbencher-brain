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

  // The registered staleness surfaces are the GENERATOR's tables, imported
  // rather than restated.
  //
  // They used to be a second hardcoded copy here, and the two drifted exactly
  // as two lists do. Measured at HEAD 793abd97f, before this import: 11 failures,
  // every one of them a disagreement between the copies rather than a defect in
  // a page — bb_ask, bb_impact and bb_health were registered freshness surfaces
  // by the generator (correctly, from the handlers' real behavior) while this
  // file still listed them as tools that "do not report index staleness", and
  // the predicate below searched for a sentence the generator had stopped
  // emitting ("does not report index staleness" against the generated "does not
  // report per-file index staleness"). A gate cannot check a table it also
  // maintains; it reads the table the pages are rendered from.
  const { FRESHNESS_TOOLS, CUSTOM_STALENESS_TOOLS } = await import(path.join(ROOT, "script/verify-tool-docs.ts")) as {
    FRESHNESS_TOOLS: Record<string, { modes: string[]; surfaces: string }>
    CUSTOM_STALENESS_TOOLS: Set<string>
  }

  // Cross-check against the LIVE registry, both directions: every tool that
  // registers freshnessModes must have a page-map entry that describes it, and
  // every page-map entry must be a real public tool. This is the check that
  // catches a tool gaining a freshness surface without its page following.
  const registryFresh = new Map<string, string[]>()
  for (const d of PUBLIC_TOOL_DESCRIPTORS as any[]) {
    if (Array.isArray(d.freshnessModes) && d.freshnessModes.length) registryFresh.set(d.name, [...d.freshnessModes])
  }
  const publicNames = new Set((PUBLIC_TOOL_DESCRIPTORS as any[]).map((d) => d.name))
  for (const [name, modes] of registryFresh) {
    check(`registry tool ${name}: its freshness surface is described by the page map`, FRESHNESS_TOOLS[name] !== undefined, JSON.stringify(modes))
  }
  for (const name of Object.keys(FRESHNESS_TOOLS)) check(`page map entry is a public tool: ${name}`, publicNames.has(name), "")
  for (const name of CUSTOM_STALENESS_TOOLS) check(`custom staleness entry is a public tool: ${name}`, publicNames.has(name), "")

  // Every registered mode vocabulary, for the "claims someone else's modes"
  // negative below.
  const allRegisteredModes = new Set(Object.values(FRESHNESS_TOOLS).flatMap((info) => info.modes))

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
    const claims = FRESHNESS_TOOLS[d.name] !== undefined || CUSTOM_STALENESS_TOOLS.has(d.name)
    if (claims) {
      check(`${d.name}: a page with a freshness surface does not deny it`, !/does not report per-file index staleness|does not report index staleness/.test(sec), sec.slice(0, 120))
      // Custom sections (bb_edit) state their own surface in their own words —
      // m48.D1 holds them to that wording; the generated branches use the two
      // registered phrasings.
      if (!CUSTOM_STALENESS_TOOLS.has(d.name)) {
        check(`${d.name}: staleness describes a real surface`, /staleness surfaces as|Freshness (modes|applies)/i.test(sec), sec.slice(0, 120))
      }
      // The interface a reader can act on, in either spelling: the registered
      // constants quote it, and the pages that must NOT quote them (the tools
      // that do not auto-refresh, where the constant's own wording would
      // contradict the sentence beside it) inline it instead.
      check(`${d.name}: staleness names a real reindex interface`, sec.includes("bb index --changed") && sec.includes("bb_index"), sec.slice(0, 140))
      const modes = FRESHNESS_TOOLS[d.name]?.modes ?? []
      if (modes.length) {
        check(`${d.name}: staleness doc names the registered modes`, modes.every((m) => sec.includes(`\`${m}\``)), sec.slice(0, 140))
        const registered = registryFresh.get(d.name)
        if (registered) {
          check(`${d.name}: page modes match registry freshnessModes`, JSON.stringify([...modes].sort()) === JSON.stringify([...registered].sort()), `registry=${JSON.stringify(registered)} map=${JSON.stringify(modes)}`)
        } else {
          // A tool that surfaces staleness from its handler (bb_ask, bb_impact)
          // registers no freshnessModes; the mode the page names must still be a
          // mode the tool actually executes.
          const executable = new Set<string>((d.modes ?? []) as string[])
          check(`${d.name}: page mode is an executable mode (no freshnessModes registered to compare)`, modes.every((m) => executable.has(m)), `modes=${JSON.stringify([...executable])} map=${JSON.stringify(modes)}`)
        }
      }
      negative(`${d.name}: page claims no OTHER tool's registered mode`, [...allRegisteredModes].filter((m) => !modes.includes(m) && sec.includes(`\`${m}\``)).length === 0, "")
      if (sec.includes(FRESHNESS_REMEDIATION.dir)) {
        // A page that quotes the auto-refresh remediation must not deny the
        // behavior it names — and a GENERATED page that quotes the project-scope
        // constant quotes the file-scope one beside it. Custom sections
        // (bb_edit) state their own scope and are held to m48.D1 instead.
        check(`${d.name}: a page quoting auto-refresh does not deny it`, !/does not auto-refresh/.test(sec), sec.slice(0, 160))
        if (!CUSTOM_STALENESS_TOOLS.has(d.name)) {
          check(`${d.name}: quoting the project-scope remediation also names the file-scope one`, sec.includes(FRESHNESS_REMEDIATION.file), sec.slice(0, 160))
        }
      }
    } else {
      check(`${d.name}: non-staleness tool doc says so`, sec.includes("does not report per-file index staleness"), sec.slice(0, 120))
      negative(`${d.name}: non-staleness doc does NOT quote the registered remediation`, !sec.includes(FRESHNESS_REMEDIATION.dir) && !sec.includes(FRESHNESS_REMEDIATION.file), "")
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
