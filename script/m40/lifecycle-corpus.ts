// script/m40/lifecycle-corpus.ts — M40.A4 (#634)
// The non-negotiable system gate: proves the END-TO-END lifecycle invariant —
// "any indexing path that updates symbols leaves derived data consistent, or
// visibly says it did not" — across six real scenarios. Per-flag gates were
// each green pre-M40 while the composition was broken; this corpus exists so
// that class of hole can never re-open silently.
//
//   S1 edit → bb index --changed → affected relationships RESOLVED, summary
//      says "derived: bounded" (A2 contract, end-to-end via the real CLI)
//   S2 edit → bb_edit → new symbol queryable WITH resolved edges (A3 contract)
//   S3 delete → incremental index → symbols/edges purged, zero orphans
//   S4 cancel mid-index (SIGINT) → --resume → completes WITH derived pass
//   S5 fingerprint adoption (project moved) → index continues on the adopted
//      DB, symbols + relationships preserved (M23.P3 contract under lifecycle)
//   S6 health honesty: edit-without-index → bb_health flags stale; refresh →
//      completed=true and staleness cleared (A6 contract anchor)
//
// Modes (M35 staleness-corpus pattern):
//   default : run suite, write validation/m40/results/lifecycle-corpus.json
//   --check / --gate : run suite, deep-diff observed summary against the
//     committed baseline — ANY drift fails (deterministic fields only).
//   BB_M40_EVIDENCE=1 : stamp validation/m40/results/A4.json (after PASS).
// Mutation: BB_M40_MUTATE_A4_SCENARIO_SKIP=1 skips scenario S2 — the gate
// must then FAIL (scenario-coverage assertion), proving the corpus bites.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawn, spawnSync, execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const BASELINE = path.join(ROOT, "validation/m40/results/lifecycle-corpus.json")
const CHECK = process.argv.includes("--check") || process.argv.includes("--gate") || process.env.BB_M40_CORPUS_CHECK_ONLY === "1"
const MUTATE = process.env.BB_M40_MUTATE_A4_SCENARIO_SKIP === "1"

// Isolated data dir: set BEFORE any bb module import so every DB access in
// this process (and spawned CLI children via env) lands in the tmp workspace.
const DATA = mkdtempSync(path.join(tmpdir(), "m40-corpus-data-"))
process.env.BB_DATA_DIR = DATA

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

// ── fixtures ────────────────────────────────────────────────────────────────
const LIB_V1 = [
  "export function libBase(x: number): number { return x }",
  "export function libOther(x: number): number { return x * 3 }",
  "",
].join("\n")
const APP_V1 = [
  `import { libBase } from "./lib"`,
  "export function runApp(): number { return libBase(1) }",
  "export function runApp2(): number { return libBase(2) }",
  "",
].join("\n")
const EXTRA_TS = "export function extraFn(): number { return 7 }\n"
const UNTOUCHED_V1 = "export function untouchedFn(): number { return 8 }\n"
// S1 edit: lib gains a new function (calling libOther) — libBase untouched so
// app.ts's in-edges into lib must SURVIVE the re-parse (the pre-M40 bug).
const LIB_V2 =
  LIB_V1 +
  'import { libOther } from "./lib"\nexport function libNew(x: number): number { return libOther(x) + 1 }\n'
const UNTOUCHED_V2 = UNTOUCHED_V1 + "// post-index edit: M40 lifecycle corpus\n"

async function runSuite(): Promise<{ summary: Record<string, unknown> }> {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { executeEdit } = await import(path.join(ROOT, "src/intelligence/edit/edit-engine"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))

  const fixture = mkdtempSync(path.join(tmpdir(), "m40-corpus-proj-"))
  const proj = path.join(fixture, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  writeFileSync(path.join(proj, "src", "lib.ts"), LIB_V1)
  writeFileSync(path.join(proj, "src", "app.ts"), APP_V1)
  writeFileSync(path.join(proj, "src", "extra.ts"), EXTRA_TS)
  writeFileSync(path.join(proj, "src", "untouched.ts"), UNTOUCHED_V1)

  // CLI runner (A1 pattern): real runCli against the source tree.
  const runner = path.join(fixture, "run.mjs")
  writeFileSync(runner, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(process.argv.slice(2)).catch((e)=>{console.error("RUNNER_ERR:", e?.message ?? e); process.exit(1)})\n`)
  const cli = (args: string[], timeout = 300_000) => {
    const r = spawnSync("bun", [runner, ...args], { cwd: ROOT, encoding: "utf8", timeout, env: { ...process.env, BB_DATA_DIR: DATA } })
    return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") }
  }

  const summary: Record<string, unknown> = {}

  try {
    const pid = getProjectId(proj) as any
    const raw = await BrainDatabase.getRawInstance(pid)
    const q = (sql: string, ...p: any[]) => raw.prepare(sql).all(...p) as any[]
    const one = (sql: string, ...p: any[]) => (raw.prepare(sql).get(...p) ?? {}) as any

    // ══ S0: full index — the reference world ══
    const s0 = await indexProjectParallel(pid, proj, {})
    check("S0: full index succeeds", s0.errorFiles === 0, `errors=${s0.errorFiles}`)
    check("S0: derivedPass=full", s0.summary?.derivedPass === "full", String(s0.summary?.derivedPass))
    const sym0 = one(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?`, pid).c as number
    const rel0 = one(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`, pid).c as number
    check("S0: fixture has symbols + edges", sym0 >= 6 && rel0 >= 2, `sym=${sym0} rel=${rel0}`)
    // Baseline for S3: rows with NULL targets include legitimate unresolved
    // external refs — "no NEW orphans" means == this baseline after purge.
    const orphans0 = one(
      `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NULL AND source_symbol_id IN (SELECT id FROM brain_symbol WHERE project_id = ?)`,
      pid, pid,
    ).c as number
    summary.S0 = { derived: s0.summary?.derivedPass, symbols: sym0, relationships: rel0, nullTargetBaseline: orphans0 }

    const handlers = createToolHandlers() as any
    const ctx = { projectPath: proj, projectId: pid }
    // Real handler layer, JSON mode (history:true wraps the unified health
    // report): the handler returns formatUnifiedHealth text by default.
    const health = async (args: any) => {
      const parsed = JSON.parse((await handlers.bb_health({ ...args, history: true, limit: 1 }, ctx)).content[0].text)
      return parsed.health
    }

    // ══ S1: edit → bb index --changed (real CLI) → bounded derived pass ══
    {
      writeFileSync(path.join(proj, "src", "lib.ts"), LIB_V2)
      const r = cli(["index", proj, "--changed"])
      check("S1: bb index --changed exits 0", r.code === 0, r.out.slice(-200))
      check("S1: summary says derived: bounded", /derived: bounded/.test(r.out), r.out.split("\n").filter((l) => /derived/.test(l)).join(" | ").slice(0, 200))
      // Caller edges into lib.ts restored + resolved (the pre-M40 hole).
      const edgesIntoLib = one(
        `SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol t ON t.id = r.target_symbol_id WHERE r.project_id = ? AND t.file_id = ? AND r.target_symbol_id IS NOT NULL`,
        pid, `${pid}:src/lib.ts`,
      ).c as number
      check("S1: caller edges into edited lib.ts restored+resolved", edgesIntoLib >= 2, String(edgesIntoLib))
      // The new symbol is queryable with its outgoing edge resolved.
      const libNew = one(`SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'libNew'`, pid)
      check("S1: libNew queryable", !!libNew.id, "missing")
      if (libNew.id) {
        const out1 = one(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND source_symbol_id = ? AND target_symbol_id IS NOT NULL`, pid, libNew.id).c as number
        check("S1: libNew outgoing edge resolved", out1 >= 1, String(out1))
      }
      check("S1: bounded telemetry line present", /bounded: .* symbols touched/.test(r.out), r.out.slice(0, 300))
      summary.S1 = { exitCode: r.code, derived: "bounded", edgesIntoLib, libNewResolved: !!libNew.id }
    }

    // ══ S2: edit → bb_edit → queryable with edges, derived telemetry visible ══
    if (!MUTATE) {
      const r = await executeEdit(proj, pid as any, {
        mode: "insert",
        filePath: path.join(proj, "src", "app.ts"),
        targetSymbolName: "runApp",
        position: "after" as any,
        content: "\nexport function lateFn(x: number): number { return libBase(x) + 9 }\n",
      } as any)
      check("S2: bb_edit succeeds + reindexed", !!(r as any).reindexed, JSON.stringify((r as any).summary ?? {}).slice(0, 120))
      check("S2: edit result carries derived telemetry (never silent)", !!(r as any).derived && ["full", "bounded"].includes((r as any).derived?.pass), String((r as any).derived?.pass))
      const lateFn = one(`SELECT id FROM brain_symbol WHERE project_id = ? AND name = 'lateFn'`, pid)
      check("S2: lateFn queryable right after edit", !!lateFn.id, "missing")
      if (lateFn.id) {
        const out2 = one(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND source_symbol_id = ? AND target_symbol_id IS NOT NULL`, pid, lateFn.id).c as number
        check("S2: lateFn edge into libBase resolved", out2 >= 1, String(out2))
      }
      summary.S2 = { reindexed: true, derivedPass: (r as any).derived?.pass, lateFnResolved: !!lateFn.id }
    } else {
      negativeCases++
      // Mutated world: the scenario never ran. The coverage assertion below
      // must fail — that is the proof this corpus bites.
    }

    // ══ S3: delete → incremental index → purge, zero orphans ══
    {
      rmSync(path.join(proj, "src", "extra.ts"))
      const s3 = await indexProjectParallel(pid, proj, { isIncremental: true })
      const d = s3.summary?.derivedPass
      check("S3: delete-run derives honestly (bounded or skipped-unchanged)", d === "bounded" || d === "skipped-unchanged", String(d))
      const gone = one(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ? AND name = 'extraFn'`, pid).c as number
      check("S3: deleted file's symbols purged", gone === 0, String(gone))
      const orphans = one(
        `SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NULL AND source_symbol_id IN (SELECT id FROM brain_symbol WHERE project_id = ?)`,
        pid, pid,
      ).c as number
      // No NEW orphans vs the S0 baseline (baseline includes legitimate
      // unresolved external refs).
      check("S3: no orphan edges into purged symbols", orphans === orphans0, `after=${orphans} baseline=${orphans0}`)
      summary.S3 = { derivedPass: d, extraFnGone: gone === 0, orphanEdges: orphans, baseline: orphans0 }
    }

    // ══ S6: health honesty — stale truth before, cleared after refresh ══
    {
      writeFileSync(path.join(proj, "src", "untouched.ts"), UNTOUCHED_V2) // edit WITHOUT indexing
      const h1 = await health({})
      const stale1 = Number(h1.freshness?.stale ?? -1)
      const files1 = (h1.freshness?.staleFiles ?? []) as string[]
      check("S6: bb_health flags the edited-not-indexed file", stale1 >= 1 && files1.includes("src/untouched.ts"), JSON.stringify(h1.freshness).slice(0, 200))
      const h2 = await health({ refresh: true })
      check("S6: refresh reports requested+completed", h2.refresh?.requested === true && h2.refresh?.completed === true, JSON.stringify(h2.refresh))
      const stale2 = Number(h2.freshness?.stale ?? -1)
      check("S6: staleness cleared after refresh", stale2 === 0, JSON.stringify(h2.freshness).slice(0, 200))
      summary.S6 = { staleAfterEdit: stale1, flaggedFile: files1.includes("src/untouched.ts"), refreshCompleted: h2.refresh?.completed === true, staleAfterRefresh: stale2 }
    }

    // ══ S4: cancel mid-index → --resume → completes WITH derived pass ══
    {
      const proj4 = path.join(fixture, "proj4")
      mkdirSync(path.join(proj4, "src"), { recursive: true })
      writeFileSync(path.join(proj4, "src", "hub.ts"), LIB_V1)
      const N = 1500
      for (let i = 1; i <= N; i++) {
        writeFileSync(path.join(proj4, "src", `mod${i}.ts`), [
          `import { libBase } from "./hub"`,
          `export function mod${i}fn(x: number): number { return libBase(x + ${i}) }`,
          "",
        ].join("\n"))
      }
      const child = spawn("bun", [runner, "index", proj4], { cwd: ROOT, env: { ...process.env, BB_DATA_DIR: DATA }, stdio: ["ignore", "pipe", "pipe"] })
      let out = ""
      let signaled = false
      await new Promise<void>((resolve) => {
        child.stdout?.on("data", (d: Buffer) => { out += String(d) })
        child.stderr?.on("data", (d: Buffer) => { out += String(d) })
        const timer = setTimeout(() => {
          if (!signaled) { signaled = true; try { process.kill(child.pid!, "SIGINT") } catch {} }
          resolve()
        }, 4000)
        child.on("exit", () => { clearTimeout(timer); resolve() })
      })
      await new Promise<void>((resolve) => child.on("exit", resolve))
      const cancelled = /cancel/i.test(out) || (child.exitCode ?? 1) !== 0
      check("S4: SIGINT cancelled the run (progress saved, not lost)", cancelled, out.slice(-160))
      const r4 = cli(["index", proj4, "--resume"], 600_000)
      check("S4: resume exits 0", r4.code === 0, r4.out.slice(-200))
      const dm = r4.out.match(/derived: (\S+)/)
      check("S4: resume summary reports a derived pass", !!dm && dm[1] !== "deferred", dm ? dm[1] : "no derived line")
      const pid4 = getProjectId(proj4) as any
      const raw4 = await BrainDatabase.getRawInstance(pid4)
      const sym4 = (raw4.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?`).get(pid4) as any).c as number
      const rel4 = (raw4.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ?`).get(pid4) as any).c as number
      check("S4: resumed run has full symbol coverage", sym4 >= N, String(sym4))
      check("S4: resumed run has resolved relationships", rel4 >= N, String(rel4))
      summary.S4 = { cancelled, resumeExit: r4.code, resumeDerived: dm ? dm[1] : null, symbols: sym4, relationships: rel4 }
    }

    // ══ S5: fingerprint adoption — project moved, index survives ══
    {
      const projA = path.join(fixture, "projA")
      const projB = path.join(fixture, "projB")
      mkdirSync(path.join(projA, "src"), { recursive: true })
      writeFileSync(path.join(projA, "src", "a.ts"), 'import { helper } from "./h"\nexport function topFn(x: number): number { return helper(x) }\n')
      writeFileSync(path.join(projA, "src", "h.ts"), "export function helper(x: number): number { return x * 2 }\n")
      const i5 = cli(["index", projA])
      check("S5: initial index exits 0", i5.code === 0, i5.out.slice(-160))
      const { renameSync } = await import("node:fs")
      renameSync(projA, projB)
      const r5 = cli(["index", projB])
      check("S5: index at new path exits 0", r5.code === 0, r5.out.slice(-200))
      check("S5: adoption reported", /adopt/i.test(r5.out), r5.out.split("\n").filter((l) => /adopt|derived|indexed/.test(l)).slice(0, 4).join(" | ").slice(0, 240))
      const pid5 = getProjectId(projB) as any
      const raw5 = await BrainDatabase.getRawInstance(pid5)
      const sym5 = (raw5.prepare(`SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?`).get(pid5) as any).c as number
      const rel5 = (raw5.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id = ? AND target_symbol_id IS NOT NULL`).get(pid5) as any).c as number
      check("S5: adopted DB symbols preserved", sym5 >= 2, String(sym5))
      check("S5: adopted DB edges preserved+resolved", rel5 >= 1, String(rel5))
      summary.S5 = { adopted: /adopt/i.test(r5.out), exitCode: r5.code, symbols: sym5, resolvedEdges: rel5 }
    }

    // ══ coverage: every scenario produced its record (the mutation trap) ══
    for (const s of ["S0", "S1", "S2", "S3", "S4", "S5", "S6"]) {
      check(`coverage: ${s} ran and recorded`, !!(summary as any)[s] && !(summary as any)[s].skipped, "")
    }
    negative("no scenario silently skipped", !MUTATE, MUTATE ? "MUTATION: S2 was skipped — gate must fail" : "")
  } finally {
    rmSync(fixture, { recursive: true, force: true })
    rmSync(DATA, { recursive: true, force: true })
  }

  return { summary }
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function main() {
  const { summary } = await runSuite()
  console.log(`M40 LIFECYCLE CORPUS: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  if (failed !== 0) process.exit(1)

  if (CHECK) {
    if (!existsSync(BASELINE)) {
      console.error("CORPUS CHECK: FAIL — no committed baseline")
      process.exit(1)
    }
    const committed = JSON.parse(readFileSync(BASELINE, "utf8")) as { summary: Record<string, unknown> }
    const drift: string[] = []
    for (const [k, v] of Object.entries(summary)) {
      if (JSON.stringify(committed.summary?.[k]) !== JSON.stringify(v)) drift.push(k)
    }
    for (const k of Object.keys(committed.summary ?? {})) {
      if (!(k in summary)) drift.push(`-removed:${k}`)
    }
    if (drift.length) {
      console.error(`CORPUS CHECK: FAIL — lifecycle behavior drifted from committed baseline. Drifting scenarios: ${drift.slice(0, 10).join(", ")}${drift.length > 10 ? ` (+${drift.length - 10} more)` : ""}`)
      process.exit(1)
    }
    console.log("CORPUS CHECK: PASS — observed lifecycle behavior matches committed baseline")
  } else {
    const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
    mkd(path.dirname(BASELINE), { recursive: true })
    wfs(BASELINE, JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), summary }, null, 2) + "\n")
    console.log("baseline written:", BASELINE)
  }

  // X1 lesson: closure's read-only probes must never overwrite real evidence.
  if (process.env.BB_M40_EVIDENCE === "1" && process.env.BB_M40_READ_ONLY !== "1") {
    const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
    mkd(path.join(ROOT, "validation/m40/results"), { recursive: true })
    wfs(path.join(ROOT, "validation/m40/results/A4.json"), JSON.stringify({
      status: "verified",
      currentCommit: gitHead(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m40/lifecycle-corpus.ts --gate",
      evidenceFile: "A4.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
      scenarios: 6,
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m40/results/A4.json")
  }
}

main()
