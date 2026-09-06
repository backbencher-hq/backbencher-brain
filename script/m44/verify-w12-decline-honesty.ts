// script/m44/verify-w12-decline-honesty.ts — M44.W1.2 (#670)
// Unified machine-readable refresh/decline shape across EVERY read tool.
// Exercises the real MCP handlers on a live fixture:
//
//   1. JSON modes: after an external edit with refresh=false (decline), the
//      answer carries `refresh` = { action: "declined", reason, detail,
//      files: null, deleted: null, errors: null, tookMs: null } AND
//      `autoRefresh` (string) whose reason code matches refresh.reason —
//      no per-tool drift between the prose and the structured block.
//   2. Text modes: the decline line ends with the same [refresh:declined:<reason>]
//      marker on the shared vocabulary.
//   3. Refreshed path: `refresh` = { action: "refreshed", reason: null,
//      files >= 1, ... } and autoRefresh ends [refresh:refreshed].
//   4. Vocabulary: reason codes are exactly the whitelist
//      disabled | no-index | budget-files | budget-bytes | indexer-active | error.
//
// Honesty: no auto-passes. Clean runs (no refresh) assert the fields are
// ABSENT (byte-identical clean shape). Every predicate can fail.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m44/results/W12.json")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_NO_AUTO_REFRESH

const REASON_ENUM = ["disabled", "no-index", "budget-files", "budget-bytes", "indexer-active", "error"]

let checks = 0, passed = 0, failed = 0, negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

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
  const q = "SELECT * FROM users WHERE name = '" + query + "'"
  return q
}
`
const UTIL_TS = `export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
`

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))

  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m44-w12-"))
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

    const editFile = (rel: string) => {
      const p = path.join(fixture, rel)
      writeFileSync(p, readFileSync(p, "utf8") + `\n// W1.2 edit ${Date.now()}\n`)
    }
    // ── shared shape predicates ──
    const shapeOk = (r: any, wantAction: "refreshed" | "declined"): boolean => {
      if (!r || typeof r !== "object") return false
      if (r.action !== wantAction) return false
      if (wantAction === "declined") {
        if (typeof r.reason !== "string" || !REASON_ENUM.includes(r.reason)) return false
        if (r.detail !== `${r.detail}` || r.detail.length === 0) return false
        return r.files === null && r.deleted === null && r.errors === null && r.tookMs === null
      }
      return typeof r.files === "number" && r.files >= 1 && r.deleted === 0 && r.errors === 0 && typeof r.tookMs === "number" && r.reason === null
    }
    const proseMatches = (text: string, r: any): boolean => {
      if (r.action === "declined") return text.includes(`[refresh:declined:${r.reason}]`)
      return text.includes("[refresh:refreshed]")
    }

    // ── 1. JSON modes: every row-resolving tool's decline carries the SAME
    // structured shape, prose reason == structured reason. ──
    // (bb_analyze/bb_graph are JSON-only; visualize/migrate/doc take format=json.)
    editFile("src/api.ts")
    const jsonProbes: Array<[string, any, (text: string) => any]> = [
      ["bb_analyze", { mode: "callers", target: "handleRequest", refresh: false }, (t) => JSON.parse(t)],
      ["bb_graph", { symbol: "handleRequest", refresh: false }, (t) => JSON.parse(t)],
      ["bb_visualize", { scope: "project", format: "json", refresh: false }, (t) => JSON.parse(t)],
      ["bb_migrate", { symbolNames: ["handleRequest"], targetLanguage: "python", format: "json", refresh: false }, (t) => JSON.parse(t)],
      ["bb_doc", { mode: "file", target: "src/api.ts", format: "json", refresh: false }, (t) => JSON.parse(t)],
      ["bb_search", { mode: "content", query: "handleRequest", refresh: false }, (t) => JSON.parse(t)],
      ["bb_search", { mode: "symbol", symbolName: "handleRequest", refresh: false }, (t) => JSON.parse(t)],
    ]
    for (const [tool, args, parse] of jsonProbes) {
      editFile("src/api.ts")
      const text = await run(tool, args)
      const json = parse(text)
      const refresh = json.refresh
      check(`${tool}: declined answer carries the shared refresh block`, shapeOk(refresh, "declined"), JSON.stringify(refresh).slice(0, 160))
      check(`${tool}: autoRefresh prose reason matches the structured reason`, typeof json.autoRefresh === "string" && proseMatches(json.autoRefresh, refresh), String(json.autoRefresh).slice(0, 160))
      negative(`${tool}: decline never claims a refresh happened`, !(refresh?.action === "refreshed") && !/auto-refreshed/.test(String(json.autoRefresh ?? "")), "")
    }

    // ── 2. Text modes: decline line ends with the shared reason-code marker. ──
    const textProbes: Array<[string, any, (t: string) => boolean]> = [
      ["bb_ask", { query: "handleRequest", refresh: false }, (t) => t.includes("[refresh:declined:disabled]")],
      ["bb_patterns", { scope: "all", refresh: false }, (t) => t.includes("[refresh:declined:disabled]")],
      ["bb_security", { refresh: false }, (t) => t.includes("[refresh:declined:disabled]")],
    ]
    for (const [tool, args, assert] of textProbes) {
      editFile("src/api.ts")
      const text = await run(tool, args)
      check(`${tool} (text): decline marker carries the shared reason code`, assert(text), text.slice(-200))
      negative(`${tool} (text): decline does NOT claim a refresh happened`, !/auto-refreshed \d+ file/.test(text), text.slice(-120))
    }

    // ── 3. Refreshed path: structured block action=refreshed with counters. ──
    editFile("src/api.ts")
    const anText = await run("bb_analyze", { mode: "callers", target: "handleRequest" })
    const anJson = JSON.parse(anText)
    check("bb_analyze refreshed: shared refresh block action=refreshed with counters", shapeOk(anJson.refresh, "refreshed"), JSON.stringify(anJson.refresh).slice(0, 160))
    check("bb_analyze refreshed: prose declares refreshed with the code", typeof anJson.autoRefresh === "string" && proseMatches(anJson.autoRefresh, anJson.refresh), String(anJson.autoRefresh).slice(0, 160))

    // ── 4. Clean path: NO refresh block, NO autoRefresh — byte-identical clean. ──
    const cleanText = await run("bb_analyze", { mode: "callers", target: "handleRequest" })
    const cleanJson = JSON.parse(cleanText)
    negative("bb_analyze clean: no refresh block on fresh answers", cleanJson.refresh === undefined && cleanJson.autoRefresh === undefined, Object.keys(cleanJson).join(","))

    // ── 5. Envelope + counters never drift: declined answer still reports the
    // stale rows in freshness (never silent), and the declined refresh block
    // exposes null counters (nothing was repaired). ──
    editFile("src/api.ts")
    const anNo = JSON.parse(await run("bb_analyze", { mode: "callers", target: "handleRequest", refresh: false }))
    check("bb_analyze declined: envelope still reports stale rows", anNo.freshness?.stale >= 1, JSON.stringify(anNo.freshness))
    check("bb_analyze declined: refresh counters are null (no repair happened)", anNo.refresh?.files === null && anNo.refresh?.deleted === null && anNo.refresh?.errors === null && anNo.refresh?.tookMs === null, JSON.stringify(anNo.refresh))

    // ── 6. Over-budget decline carries reason budget-files on text AND JSON. ──
    editFile("src/api.ts")
    editFile("src/util.ts")
    process.env.BB_AUTO_REFRESH_MAX_FILES = "1"
    const overText = await run("bb_migrate", { symbolNames: ["handleRequest", "formatDate"], targetLanguage: "python" })
    check("bb_migrate over-budget (text): reason code is budget-files", overText.includes("[refresh:declined:budget-files]"), overText.slice(-160))
    const overJson = JSON.parse(await run("bb_analyze", { mode: "callers", target: "handleRequest", refresh: false }))
    check("bb_analyze over-budget (refresh=false): decline honors opt-out reason disabled", overJson.refresh?.reason === "disabled", JSON.stringify(overJson.refresh))
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
      verifierCommand: "bun run script/m44/verify-w12-decline-honesty.ts",
      evidenceFile: "W12.json",
      generatedAt: new Date().toISOString(),
      passed, failed, negativeCases,
    }, null, 2) + "\n")
  }
  console.log(`M44 W1.2 DECLINE HONESTY: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("W1.2 gate crashed:", e)
  process.exit(1)
})
