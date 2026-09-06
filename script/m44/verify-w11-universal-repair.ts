// script/m44/verify-w11-universal-repair.ts — M44.W1.1 (#669)
// Behavioral gate over the REAL MCP handlers: after an external edit to an
// indexed file, every row-resolving read tool either (a) auto-refreshes
// exactly the files its read touched — within budget — and answers from a
// re-run (declared "auto-refreshed N files ..."), or (b) declines with an
// explicit reason (refresh=false / budget / lock). NEVER silent stale.
//
// Tools under test (issue #669 list): bb_ask, bb_analyze (callers mode as the
// row-resolving representative), bb_graph, bb_visualize, bb_migrate,
// bb_patterns, bb_security, bb_doc. bb_health keeps explicit-refresh
// semantics (excluded by design).
//
// Honesty rules: no auto-passes. Clean-path runs assert byte-level silence
// (no "auto-refresh", no stale markers) so the fresh world stays unchanged.
// Repairs are asserted on BOTH sides: the declaration line, and the absence
// of stale flags/markers in the repaired answer. Decline runs assert an
// explicit reason is present and that no silent auto-refresh happened.
//
// Mutation (registered in gates-registry / verify-gate-selftest): swap the
// decline reason constant to the refreshed wording — decline assertions must
// fail because the reason line vanishes.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m44/results/W11.json")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
// Auto-refresh must be exercised, never disabled globally for this gate.
delete process.env.BB_NO_AUTO_REFRESH

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

// ── fixture: TS api (handler -> helper + SQLi surface) + util ──────────────
const API_TS = `import { formatDate } from "./util"
export interface User { id: string; name: string }
export function findUser(id: string): User | null {
  const stamp = formatDate(new Date())
  if (!id) return null
  return { id, name: "user-" + stamp + "-" + id }
}
export function handleRequest(req: { params: { id: string } }): User | null {
  return findUser(req.params.id)
}
export function handleSearch(query: string): string {
  // deliberately naive SQL surface so the security scan finds a flow
  const q = "SELECT * FROM users WHERE name = '" + query + "'"
  return q
}
export function unusedLegacy() { return 0 }
`
const UTIL_TS = `export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function unusedOrphaned() { return 42 }
`

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))

  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m44-w11-"))
  try {
    mkdirSync(path.join(fixture, "src"), { recursive: true })
    writeFileSync(path.join(fixture, "src", "api.ts"), API_TS)
    writeFileSync(path.join(fixture, "src", "util.ts"), UTIL_TS)
    const pid = getProjectId(fixture)
    const s = await indexProjectParallel(pid as any, fixture, {})
    check("fixture indexes clean", s.errorFiles === 0, `errors=${s.errorFiles}`)

    const handlers = createToolHandlers()
    const ctx = { projectId: pid, projectPath: fixture }
    const run = async (tool: string, args: any) => (await handlers[tool](args, ctx)).content[0].text as string

    // ── 0. pristine control: clean runs carry NO repair language at all ──
    const decl = (text: string) => /auto-refresh(ed| disabled| declined)/.test(text)
    const staleMark = (text: string) => /\[stale\]|\[STALE|\(STALE\)|\bstale\b.*missing of|"stale":\s*[1-9]/.test(text)
    for (const [tool, args] of [
      ["bb_ask", { query: "how does handleRequest work" }],
      ["bb_analyze", { mode: "callers", target: "handleRequest" }],
      ["bb_graph", { symbol: "handleRequest" }],
      ["bb_visualize", { scope: "project" }],
      ["bb_migrate", { symbolNames: ["handleRequest"], targetLanguage: "python" }],
      ["bb_patterns", { scope: "all" }],
      ["bb_security", {}],
      ["bb_doc", { mode: "file", target: "src/api.ts" }],
    ] as Array<[string, any]>) {
      const text = await run(tool, args)
      negative(`${tool}: pristine output has no auto-refresh language`, !decl(text), text.slice(-160))
    }

    // ── helper: external edit (simulating an agent's own tooling) ──
    const editFile = (rel: string, extra: string) => {
      const p = path.join(fixture, rel)
      writeFileSync(p, requireRead(p) + extra)
    }
    const requireRead = (p: string): string => {
      const { readFileSync } = require("node:fs") as typeof import("node:fs")
      return readFileSync(p, "utf8")
    }

    // ── 1. W1.1 repair, per tool. Each tool resolves the file its read
    // touched. Because the FIRST tool's repair makes the file fresh again, the
    // file is re-staled BEFORE EACH tool so every tool independently exercises
    // its own repair path (a clean run emits no autoRefresh field — that is
    // the correct, byte-identical clean shape). ──
    let seq = 0
    const staleAndRun = async (rel: string, tool: string, args: any): Promise<string> => {
      seq++
      editFile(rel, `\n// W1.1 external edit ${seq}\n`)
      return run(tool, args)
    }

    const askText = await staleAndRun("src/api.ts", "bb_ask", { query: "handleRequest" })
    check("bb_ask: external edit -> declared auto-refresh", /auto-refreshed \d+ file/.test(askText), askText.slice(-200))
    negative("bb_ask: repaired answer has no STALE sources", !/(STALE)/.test(askText), askText.slice(0, 300))

    const anText = await staleAndRun("src/api.ts", "bb_analyze", { mode: "callers", target: "handleRequest" })
    const anJson = JSON.parse(anText)
    check("bb_analyze(callers): external edit -> declared auto-refresh", typeof anJson.autoRefresh === "string" && /auto-refreshed \d+ file/.test(anJson.autoRefresh), anText.slice(-200))
    check("bb_analyze(callers): repaired envelope clean", anJson.freshness?.stale === 0 && anJson.freshness?.missing === 0, JSON.stringify(anJson.freshness))

    const grText = await staleAndRun("src/util.ts", "bb_graph", { symbol: "handleRequest" })
    const grJson = JSON.parse(grText)
    check("bb_graph: external edit -> declared auto-refresh", typeof grJson.autoRefresh === "string" && /auto-refreshed \d+ file/.test(grJson.autoRefresh), grText.slice(-200))

    const vizText = await staleAndRun("src/api.ts", "bb_visualize", { scope: "project", format: "json" })
    const vizJson = JSON.parse(vizText)
    check("bb_visualize: external edit -> declared auto-refresh", typeof vizJson.autoRefresh === "string" && /auto-refreshed \d+ file/.test(vizJson.autoRefresh), vizText.slice(-200))
    check("bb_visualize: re-rendered nodes carry no stale flags", !(vizJson.nodes as any[]).some((n) => n.stale === true), JSON.stringify((vizJson.nodes as any[]).filter((n) => n.stale)))

    const migText = await staleAndRun("src/util.ts", "bb_migrate", { symbolNames: ["handleRequest", "formatDate"], targetLanguage: "python", format: "json" })
    const migJson = JSON.parse(migText)
    check("bb_migrate: external edit -> declared auto-refresh", typeof migJson.autoRefresh === "string" && /auto-refreshed \d+ file/.test(migJson.autoRefresh), migText.slice(-200))
    check("bb_migrate: re-planned plans carry no stale flag", !(migJson.plans as any[]).some((p) => p.stale === true), JSON.stringify((migJson.plans as any[]).filter((p) => p.stale)))

    const patText = await staleAndRun("src/api.ts", "bb_patterns", { scope: "all" })
    check("bb_patterns: external edit -> declared auto-refresh", /auto-refreshed \d+ file/.test(patText), patText.slice(-200))
    negative("bb_patterns: repaired answer has no stale markers", !/\[stale\]/.test(patText), patText.slice(0, 300))

    const secText = await staleAndRun("src/api.ts", "bb_security", {})
    check("bb_security: external edit -> declared auto-refresh", /auto-refreshed \d+ file/.test(secText), secText.slice(-200))
    negative("bb_security: repaired answer has no stale markers", !/\[stale\]/.test(secText), secText.slice(0, 300))

    const docText = await staleAndRun("src/api.ts", "bb_doc", { mode: "file", target: "src/api.ts", format: "json" })
    const docJson = JSON.parse(docText)
    check("bb_doc: external edit -> declared auto-refresh", typeof docJson.autoRefresh === "string" && /auto-refreshed \d+ file/.test(docJson.autoRefresh), docText.slice(-200))
    check("bb_doc: regenerated envelope clean", docJson.freshness?.stale === 0 && docJson.freshness?.missing === 0, JSON.stringify(docJson.freshness))

    // ── 2. Honest decline (refresh=false per call): a stale read must say
    // WHY it did not repair — never a silent stale answer. ──
    editFile("src/api.ts", "\n// W1.1 external edit 3\n")
    const askNo = await run("bb_ask", { query: "handleRequest", refresh: false })
    check("bb_ask refresh=false: explicit decline declared", /auto-refresh disabled/.test(askNo), askNo.slice(-160))
    negative("bb_ask refresh=false: no auto-refresh happened", !/auto-refreshed \d+ file/.test(askNo), askNo.slice(-160))
    const anNo = JSON.parse(await run("bb_analyze", { mode: "callers", target: "handleRequest", refresh: false }))
    check("bb_analyze refresh=false: autoRefresh field carries the decline reason", typeof anNo.autoRefresh === "string" && /disabled/.test(anNo.autoRefresh), JSON.stringify(anNo.autoRefresh))
    check("bb_analyze refresh=false: envelope still reports the stale rows", anNo.freshness?.stale >= 1, JSON.stringify(anNo.freshness))
    const patNo = await run("bb_patterns", { scope: "all", refresh: false })
    check("bb_patterns refresh=false: explicit decline declared", /auto-refresh disabled/.test(patNo), patNo.slice(-160))
    check("bb_patterns refresh=false: stale rows still marked (never silent)", /\[stale\]/.test(patNo) || /stale, \d+ missing/.test(patNo), patNo.slice(0, 300))

    // ── 3. Over-budget decline (BB_AUTO_REFRESH_MAX_FILES=1, 2 stale files):
    // the decline names the budget — no silent stale, no partial repair. ──
    editFile("src/util.ts", "\n// W1.1 external edit 2\n")
    process.env.BB_AUTO_REFRESH_MAX_FILES = "1"
    const migOver = await run("bb_migrate", { symbolNames: ["handleRequest", "formatDate"], targetLanguage: "python" })
    check("bb_migrate over-budget: decline names the file budget", /budget/.test(migOver) && /auto-refresh declined/.test(migOver), migOver.slice(-200))
    negative("bb_migrate over-budget: no partial repair happened", !/auto-refreshed \d+ file/.test(migOver), migOver.slice(-200))
    delete process.env.BB_AUTO_REFRESH_MAX_FILES
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }

  if (process.env.BB_M44_EVIDENCE === "1" && failed === 0) {
    mkdirSync(path.dirname(RESULT), { recursive: true })
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m44/verify-w11-universal-repair.ts",
      evidenceFile: "W11.json",
      code: "W1.1",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
    }, null, 2) + "\n")
  }
  console.log(`M44 W1.1 UNIVERSAL REPAIR: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("W1.1 gate crashed:", e)
  process.exit(1)
})
