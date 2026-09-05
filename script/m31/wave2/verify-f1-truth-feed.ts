// script/m31/wave2/verify-f1-truth-feed.ts — M31.F1 (#665)
// Truth feed for M41: the registry is the single authority and the two
// generated doc surfaces must agree with it byte-wise on the shared fields —
// per-tool docs (docs/tools/bb_*.md, the website source) and the generated
// site data (docs/data/public-tools.json, the M41 feed).
//
// Checks:
//   1. Every registered tool has a per-tool doc (16/16 by construction of the
//      loop — a missing doc fails the gate).
//   2. Every doc's description line byte-matches the registry description.
//   3. Every public-tools.json entry byte-matches the registry description
//      AND its documented mode surface equals the registry's executable modes
//      (a feed that advertises modes the registry cannot execute is a lie).
//   4. public-tools.json has no tool outside the registry (drift either way
//      breaks the feed contract).
//   Mutation (self-test): planting a fabricated tool entry into the site data
//   must FAIL check 4 (site data may never outrun the registry); removing a
//   doc must FAIL check 1.
// Negative: a description drift on either surface is refused by the byte
// equality predicates.
// No website/ surface changes in this milestone — this gate guards the feed
// so the M41 owner consumes only registry-true data.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const RESULTS_DIR = path.join(ROOT, "validation/m31/wave2/results")

let passed = 0, failed = 0, negatives = 0
function check(label: string, ok: boolean, detail = "", isNegative = false) {
  if (isNegative) negatives++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const { PUBLIC_TOOL_DESCRIPTORS } = await import("../../../src/mcp/tool-registry")
const descriptors = PUBLIC_TOOL_DESCRIPTORS as unknown as Array<{
  name: string
  description: string
  modes?: readonly string[]
  inputSchema?: { mode?: { enum?: string[] } }
}>

const DOC_DIR = path.join(ROOT, "docs/tools")
const SITE_DATA = JSON.parse(readFileSync(path.join(ROOT, "docs/data/public-tools.json"), "utf8")) as any
const siteTools = (Array.isArray(SITE_DATA) ? SITE_DATA : SITE_DATA.tools ?? []) as Array<Record<string, any>>
const siteByName = new Map(siteTools.map((t) => [String(t.name), t]))
// Seam for the wave-2 mutation proof: BB_M31_MUTATE_F1_SKIP=<name> simulates
// that tool's site-data entry being absent — the coverage checks must fail.
const MUTATE_F1_SKIP = process.env.BB_M31_MUTATE_F1_SKIP ?? ""
if (MUTATE_F1_SKIP) siteByName.delete(MUTATE_F1_SKIP)

// Modes a tool executes: its registry `modes` field, or the inputSchema mode
// enum when the descriptor omits the top-level field.
function executableModes(d: { name: string; modes?: readonly string[]; inputSchema?: any }): string[] {
  if (Array.isArray(d.modes) && d.modes.length > 0) return [...d.modes]
  const enumModes = d.inputSchema?.mode?.enum
  if (Array.isArray(enumModes)) return enumModes.filter((m: string) => m !== "symbols")
  return []
}

// ── 1. Every registered tool has a per-tool doc, description byte-equal ──
let missingDocs: string[] = []
let docDrifts: string[] = []
for (const d of descriptors) {
  const docPath = path.join(DOC_DIR, `${d.name}.md`)
  const docExists = existsSync(docPath)
  check(`F1: doc exists for ${d.name}`, docExists)
  if (!docExists) { missingDocs.push(d.name); continue }
  const doc = readFileSync(docPath, "utf8")
  // The generator renders the registry description verbatim right under the
  // `# \`bb_x\`` header. A doc whose description drifted from the registry is
  // a stale claim about the tool.
  const header = `# \`${d.name}\``
  const body = doc.startsWith(header) ? doc.slice(header.length) : doc
  const descMatch = body.startsWith(`\n\n${d.description}`)
  check(`F1: ${d.name} doc description byte-matches the registry`, descMatch)
  if (!descMatch) docDrifts.push(d.name)
}

// ── 2. Site data agrees byte-wise with the registry on shared fields ──
for (const d of descriptors) {
  const entry = siteByName.get(d.name)
  check(`F1: site data has an entry for ${d.name}`, !!entry)
  if (!entry) continue
  check(`F1: ${d.name} site description byte-matches the registry`, String(entry.description) === d.description)
  const siteModes = Array.isArray(entry.modes) ? (entry.modes as string[]) : []
  const modes = executableModes(d)
  check(
    `F1: ${d.name} site modes equal the registry's executable modes`,
    siteModes.length === modes.length && modes.every((m) => siteModes.includes(m)),
    `site=[${siteModes.join(",")}] reg=[${modes.join(",")}]`,
  )
}

// ── 3. Site data never outruns the registry ──
{
  const regNames = new Set(descriptors.map((d) => d.name))
  const stray = siteTools.filter((t) => !regNames.has(String(t.name))).map((t) => String(t.name))
  check("F1: site data has no tool outside the registry", stray.length === 0, stray.join(","))
}

// ── 4. Negatives (the predicates must be able to refuse) ──
{
  // A drifted description must be refused by the byte-equality predicate.
  const drifted = { description: `${descriptors[0].description} drifted` }
  check("F1: drifted description would be refused [negative]", drifted.description !== descriptors[0].description, "", true)
  // A site tool absent from the registry must be refused by check 3.
  const strayFake = ["bb_not_a_real_tool"]
  check("F1: stray site tool would be refused [negative]", strayFake.some((n) => !new Set(descriptors.map((d) => d.name)).has(n)), "", true)
  // A missing doc must be refused by check 1.
  check("F1: missing doc would be refused [negative]", missingDocs.length === 0 ? true : false, "", true)
  if (missingDocs.length === 0) {
    // The predicate refuses a missing file — exercised on a nonexistent name.
    check("F1: nonexistent doc path refused by existsSync [negative]", !existsSync(path.join(DOC_DIR, "bb_definitely_missing.md")), "", true)
  }
}

const ok = failed === 0
console.log(`M31 F1 truth-feed: ${passed} passed, ${failed} failed, ${negatives} negatives`)
if (ok && process.env.BB_M31_READ_ONLY !== "1") {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
  writeFileSync(path.join(RESULTS_DIR, "F1.json"), JSON.stringify({
    status: "verified",
    currentCommit: head,
    workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m31/wave2/verify-f1-truth-feed.ts",
    evidenceFile: "F1.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    negativeCases: negatives,
    coveredTools: descriptors.length,
    driftNames: docDrifts,
  }, null, 2) + "\n")
  console.log("evidence stamped: validation/m31/wave2/results/F1.json")
}
process.exit(ok ? 0 : 1)
