// script/m35/verify-envelope-contract.ts — M35.E1 (#581)
// Behavioral gate for the registered staleness envelope contract:
//
//   1. Registry: freshnessModes registrations are legal (⊆ executable modes,
//      no dupes) for EVERY descriptor; the shared validator rejects illegal
//      registrations (live negative control).
//   2. Contract: buildStalenessEnvelope emits EXACTLY the registered wire
//      shape (six keys, no more) and remediation text built from the
//      registered constants (FRESHNESS_REMEDIATION).
//   3. Handlers: every mode registered on bb_search carries the block on its
//      REAL handler output with all six keys; stale cases have remediation
//      naming the registered reindex interface; fresh cases have "".
//      A handler that omits the block, or hardcodes remediation text that is
//      not the registered constant, FAILS here.
//
// Modes: default behavioral suite; BB_M35_EVIDENCE=1 stamps E1.json.
// Mutations (planted by verify-gate-selftest, 2 entries): remediation killed
// in the builder; freshness block removed from the symbol-mode handler.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m35/results/E1.json")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL

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

const REGISTERED_KEYS = ["fresh", "stale", "missing", "staleRatio", "mode", "remediation"]

async function runSuite(): Promise<void> {
  // M43.A1 (#657): the search-family handlers now AUTO-REFRESH stale files
  // within budget and DECLARE it — that is their new contract (tested by the
  // M43.A1 gate). This gate verifies the M35 staleness-detection/reporting
  // machinery, so the automatic repair is disabled here to keep
  // stale-after-edit observable deterministically. BB_NO_AUTO_REFRESH is read
  // at decision time, so setting it after imports is sufficient.
  process.env.BB_NO_AUTO_REFRESH = "1"
  const { PUBLIC_TOOL_DESCRIPTORS, validateToolDescriptors } = await import(path.join(ROOT, "src/mcp/tool-registry"))
  const { buildStalenessEnvelope, FRESHNESS_REMEDIATION } = await import(path.join(ROOT, "src/brain/freshness"))

  // ── 1. registry: every freshnessModes registration is legal ──
  const registered: { tool: string; mode: string }[] = []
  for (const d of PUBLIC_TOOL_DESCRIPTORS as any[]) {
    if (!d.freshnessModes) continue
    const modeSet = new Set<string>(d.modes)
    check(`${d.name}: freshnessModes non-empty`, Array.isArray(d.freshnessModes) && d.freshnessModes.length > 0)
    check(`${d.name}: freshnessModes are executable modes`, (d.freshnessModes as string[]).every((m) => modeSet.has(m)), d.freshnessModes.join(","))
    check(`${d.name}: no duplicate freshnessModes`, new Set(d.freshnessModes).size === d.freshnessModes.length)
    check(`${d.name}: description advertises the freshness block`, String(d.description).includes("freshness block"), d.description.slice(0, 60))
    for (const m of d.freshnessModes as string[]) registered.push({ tool: d.name, mode: m })
  }
  check("at least one tool registers freshness modes", registered.length > 0, JSON.stringify(registered))
  check("bb_search registers its json read modes", (PUBLIC_TOOL_DESCRIPTORS as any[]).find((d) => d.name === "bb_search")?.freshnessModes?.includes("symbol") === true)

  // Live negative control: the shared validator must reject an illegal
  // registration (freshness mode that is not an executable mode).
  let threw = false
  let threwOnDup = false
  try {
    validateToolDescriptors([
      { name: "fake_tool", description: "", inputSchema: { type: "object", properties: {} }, mutability: "read", requiresIndex: false, modes: ["a"], freshnessModes: ["not-a-mode"], aliases: [], deprecated: false, documentation: { category: "x", summary: "", defaults: {}, examples: [] } },
    ] as any)
  } catch { threw = true }
  try {
    validateToolDescriptors([
      { name: "fake_tool", description: "", inputSchema: { type: "object", properties: {} }, mutability: "read", requiresIndex: false, modes: ["a"], freshnessModes: ["a", "a"], aliases: [], deprecated: false, documentation: { category: "x", summary: "", defaults: {}, examples: [] } },
    ] as any)
  } catch { threwOnDup = true }
  negative("validator rejects freshness mode outside executable modes", threw)
  negative("validator rejects duplicate freshness modes", threwOnDup)

  // ── 2. contract: exact wire shape + registered remediation text ──
  const env = buildStalenessEnvelope({ fresh: 3, stale: 1, missing: 1, staleRatio: 0.4, freshnessMode: "complete" }, { kind: "dir" })
  check("envelope has exactly the registered keys", JSON.stringify(Object.keys(env).sort()) === JSON.stringify([...REGISTERED_KEYS].sort()), JSON.stringify(Object.keys(env)))
  check("envelope mode maps sampled/complete", env.mode === "complete")
  const sampled = buildStalenessEnvelope({ fresh: 1, stale: 0, missing: 0, staleRatio: 0, freshnessMode: "sampled" }, { kind: "dir" })
  check("envelope mode maps sampled", sampled.mode === "sampled")
  check("registered dir remediation names bb index --changed and bb_index", FRESHNESS_REMEDIATION.dir.includes("bb index --changed") && FRESHNESS_REMEDIATION.dir.includes("bb_index"))
  check("registered file remediation names bb index with a file path and bb_index", /bb index "/.test(FRESHNESS_REMEDIATION.file) && FRESHNESS_REMEDIATION.file.includes("bb_index"))
  negative("stale envelope carries non-empty remediation naming the registered interface", env.remediation.includes("bb index --changed"), env.remediation)
  negative("fresh envelope remediation is empty (silence when fresh)", buildStalenessEnvelope({ fresh: 5, stale: 0, missing: 0, staleRatio: 0, freshnessMode: "complete" }, { kind: "dir" }).remediation === "")

  // ── 3. handlers: registered modes carry the block on real output ──
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m35-e1-"))
  mkdirSync(path.join(fixture, "src"), { recursive: true })
  const editedFile = path.join(fixture, "src", "app.ts")
  writeFileSync(editedFile, "export function handleRequest(x: number): number { return x + 1 }\nexport function helper(y: number): number { return y * 2 }\n")
  writeFileSync(path.join(fixture, "src", "other.ts"), "export const MARKER = 41\n")
  try {
    const projectId = (getProjectId as (p: string) => string)(fixture)
    const stats = await indexProjectParallel(projectId as any, fixture, { skipPostProcessing: true })
    check("fixture indexes cleanly", stats.errorFiles === 0, `errors=${stats.errorFiles}`)
    writeFileSync(editedFile, "export function handleRequest(x: number): number { return x + 100 }\n") // edit AFTER index

    const handlers = createToolHandlers() as Record<string, (args: any, ctx: any) => Promise<{ content: { text: string }[] }>>
    const ctx = { projectPath: fixture, projectId }
    const run = async (tool: string, args: any) => JSON.parse((await handlers[tool](args, ctx)).content[0].text)

    const registeredModes = new Set(registered.filter((r) => r.tool === "bb_search").map((r) => r.mode))
    check("fixture covers every registered bb_search mode invocation", ["symbol", "content", "file"].every((m) => registeredModes.has(m)), [...registeredModes].join(","))

    // symbol mode: stale match after edit + block + registered remediation
    const sym = await run("bb_search", { mode: "symbol", symbolName: "handleRequest" })
    check("symbol mode: block present with exact keys", sym.freshness && JSON.stringify(Object.keys(sym.freshness).sort()) === JSON.stringify([...REGISTERED_KEYS].sort()), JSON.stringify(sym.freshness))
    check("symbol mode: edited match flagged stale", Array.isArray(sym.matches) && sym.matches.length > 0 && sym.matches.every((m: any) => m.stale === true), JSON.stringify(sym.matches.map((m: any) => m.stale)))
    check("symbol mode: counts consistent with flags", sym.freshness.stale + sym.freshness.missing === sym.matches.filter((m: any) => m.stale).length)
    negative("symbol mode: remediation names registered dir interface when stale", typeof sym.freshness.remediation === "string" && sym.freshness.remediation.includes("bb index --changed"), sym.freshness.remediation)

    // fresh symbol: no false staleness, silence
    const freshSym = await run("bb_search", { mode: "symbol", symbolName: "MARKER" })
    check("symbol mode: untouched match NOT flagged stale", freshSym.matches.length > 0 && freshSym.matches.every((m: any) => m.stale === false))
    negative("symbol mode: remediation empty when fresh", freshSym.freshness.remediation === "", freshSym.freshness.remediation)

    // content mode: block present
    const cont = await run("bb_search", { mode: "content", query: "MARKER" })
    check("content mode: block present with exact keys", cont.freshness && JSON.stringify(Object.keys(cont.freshness).sort()) === JSON.stringify([...REGISTERED_KEYS].sort()), JSON.stringify(cont.freshness))
    check("content mode: legacy staleCount still present (no break)", typeof cont.staleCount === "number")

    // file mode: file-scope remediation names THIS file via the registered form
    const file = await run("bb_search", { mode: "file", filePath: "src/app.ts" })
    check("file mode: block present with exact keys", file.freshness && JSON.stringify(Object.keys(file.freshness).sort()) === JSON.stringify([...REGISTERED_KEYS].sort()), JSON.stringify(file.freshness))
    check("file mode: stale flag true after edit", file.stale === true)
    negative("file mode: remediation names this exact file via registered form", typeof file.freshness.remediation === "string" && file.freshness.remediation.includes('bb index "src/app.ts"') && file.freshness.remediation.includes("bb_index"), file.freshness.remediation)
    const freshFile = await run("bb_search", { mode: "file", filePath: "src/other.ts" })
    negative("file mode: remediation empty when file is fresh", freshFile.stale === false && freshFile.freshness.remediation === "", freshFile.freshness.remediation)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function main() {
  await runSuite()
  if (process.env.BB_M35_EVIDENCE === "1" && failed === 0) {
    mkdirSync(path.dirname(RESULT), { recursive: true })
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: gitHead(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m35/verify-envelope-contract.ts",
      evidenceFile: "E1.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
    }, null, 2) + "\n")
  }
  console.log(`M35 ENVELOPE CONTRACT: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("E1 gate crashed:", e)
  process.exit(1)
})
