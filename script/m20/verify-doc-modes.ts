// M20.D1 — bb_doc mode and option contract.
//
// 1. Mode matrix: every registry mode executes against a real fixture and the
//    result echoes the requested mode.
// 2. Invalid mode and missing required target are rejected by the handler.
// 3. Empty semantics: a project with no symbols produces an honest
//    not-indexed unknown, never a crash or fabricated content.
// 4. Registry agreement: handler-supported modes exactly match the registry.
// 5. JSON/Markdown parity: both formats carry the same core facts.
// 6. Persists exact evidence; no auto-pass assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { generateDocumentation, formatDocumentation } from "../../src/intelligence/documentation/doc-engine"
import { docSourceFingerprint, docRelevantWorkingTreeChanges } from "../../src/intelligence/documentation/evidence"

let checks = 0
let passed = 0
let negativeCases = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) { passed++; console.log(`  ok: ${label}`) }
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}
function negative(label: string, condition: boolean, detail = ""): void {
  negativeCases++
  check(`${label} [negative]`, condition, detail)
}

const root = mkdtempSync(path.join(tmpdir(), "bb-m20-d1-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "math.ts"), "/** Adds two numbers. */\nexport function add(a: number, b: number): number { return a + b }\n")
writeFileSync(path.join(root, "src", "app.ts"), "import { add } from './math'\nexport function main(): number { return add(1, 2) }\n")
const projectId = getProjectId(root)
const handler = createToolHandlers().bb_doc
try {
  await indexProjectParallel(projectId, root, {})

  // ── 1. Registry agreement ─────────────────────────────────────────────
  const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_doc")
  check("registry: bb_doc present", !!registry)
  const registryModes = registry?.modes ?? []
  check("registry: seven modes advertised", registryModes.length === 7, registryModes.join(","))

  // ── 2. Mode matrix via the real handler ──────────────────────────────
  const modeCases: Array<[string, Record<string, unknown>]> = [
    ["symbol", { mode: "symbol", target: "add", format: "json" }],
    ["file", { mode: "file", target: "src/app.ts", format: "json" }],
    ["module", { mode: "module", target: "src", format: "json" }],
    ["feature", { mode: "feature", target: "add", format: "json" }],
    ["api", { mode: "api", format: "json" }],
    ["project", { mode: "project", format: "json" }],
    ["coverage", { mode: "coverage", format: "json" }],
  ]
  for (const [label, args] of modeCases) {
    const res = await handler(args, { projectPath: root, projectId } as any)
    const text = res.content[0].text
    const parsed = JSON.parse(text)
    check(`mode ${label}: executes and echoes mode`, !res.isError && parsed.mode === label, text.slice(0, 120))
    check(`mode ${label}: result has quality block`, typeof parsed.quality?.passed === "boolean", "")
  }

  // ── 3. Invalid mode / missing target rejection ──────────────────────
  const badMode = await handler({ mode: "nonsense" }, { projectPath: root, projectId } as any)
  check("invalid mode is rejected", badMode.isError === true && badMode.content[0].text.includes("requires mode"), badMode.content[0].text.slice(0, 120))
  const noTarget = await handler({ mode: "symbol" }, { projectPath: root, projectId } as any)
  check("symbol mode without target is rejected", noTarget.isError === true && noTarget.content[0].text.includes("requires target"), noTarget.content[0].text.slice(0, 120))

  // ── 4. JSON/Markdown parity ────────────────────────────────────────────────
  const json = await generateDocumentation(projectId, root, { mode: "symbol", target: "add", format: "json", limit: 10 })
  const mdResult = await generateDocumentation(projectId, root, { mode: "symbol", target: "add", format: "markdown", limit: 10 })
  const mdText = formatDocumentation(mdResult, "markdown")
  const jsonText = formatDocumentation(json, "json")
  check("parity: json cites the add symbol", json.citations.some((c) => c.symbol === "add" || (c.path ?? "").includes("math.ts")), JSON.stringify(json.citations.map((c) => c.symbol)))
  check("parity: markdown names the symbol", mdText.includes("add"), mdText.slice(0, 200))
  check("parity: json output is parseable and carries mode", JSON.parse(jsonText).mode === "symbol", jsonText.slice(0, 120))
  check("parity: markdown has sources section", mdText.includes("## Sources"), mdText.slice(-300))

  // ── 5. Empty semantics ─────────────────────────────────────────────────────
  const empty = mkdtempSync(path.join(tmpdir(), "bb-m20-d1e-"))
  mkdirSync(path.join(empty, "src"), { recursive: true })
  writeFileSync(path.join(empty, "src", "nothing.ts"), "// nothing here\n")
  const emptyPid = getProjectId(empty)
  await indexProject(emptyPid, empty)
  const emptyRes = await generateDocumentation(emptyPid, empty, { mode: "symbol", target: "missing" })
  check("empty: missing symbol yields not-indexed unknown", emptyRes.unknowns.some((u) => u.reason === "not-indexed"), JSON.stringify(emptyRes.unknowns))
  // An empty result still emits every declared section, so section completeness
  // is satisfied; what must be false is the OVERALL gate, which is the claim a
  // caller actually reads (M20.D3: it used to report passed=true here).
  negative("empty: the overall quality gate does not pass", emptyRes.quality.passed === false, JSON.stringify(emptyRes.quality))
  check("empty: completeness.expected is the mode's declared section count", emptyRes.quality.completeness.expected === 5, JSON.stringify(emptyRes.quality.completeness))
  rmSync(empty, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(emptyPid)), { recursive: true, force: true })
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}

async function indexProject(pid: string, dir: string): Promise<void> {
  await indexProjectParallel(pid, dir, {})
}

const failed = checks - passed
const result = {
  issue: "M20.D1", code: "D1", milestone: "M20",
  status: failed === 0 && docRelevantWorkingTreeChanges(path.resolve(".")).length === 0 ? "verified" : "known-gap",
  checks, passed, failed, negativeCases,
  currentCommit: (() => { try { return Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() } catch { return "unknown" } })(),
  sourceFingerprint: docSourceFingerprint(path.resolve(".")),
  workingTreeRelevantChanges: docRelevantWorkingTreeChanges(path.resolve(".")),
  verifierCommand: "bun run script/m20/verify-doc-modes.ts",
  evidenceFile: "D1.json",
  generatedAt: new Date().toISOString(),
  limitations: ["Fixture-level mode/contract matrix; real-repository documentation coverage is owned by M20.X2."],
}
mkdirSync(path.resolve("validation/m20/results"), { recursive: true })
writeFileSync(path.resolve("validation/m20/results/D1.json"), JSON.stringify(result, null, 2) + "\n")
console.log(failed === 0 ? "\nDOC D1: PASS" : `\nDOC D1: ${failed} FAILURES`)
process.exit(failed ? 1 : 0)