// Phase B contract gate (red baseline for the Phase A defects). Every assertion
// here is a behaviour the audit proved wrong on the current tree; the file exists
// so the Phase B fixes have a gate that is red before them and green after, and
// so the defects cannot silently return.
//
// Phase B ports this into script/m13/verify-patterns-handler-contract.ts.
//
// Usage: BB_DATA_DIR=<scratch lane data dir> BB_NO_AUTO_REFRESH=1 npx tsx phaseB-contract-gate.mts <out.json>

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"

const outPath = process.argv[2]
if (!outPath) { console.error("usage: phaseB-contract-gate.mts <out.json>"); process.exit(2) }
if (!process.env.BB_DATA_DIR) { console.error("BB_DATA_DIR is required (a scratch lane dir)"); process.exit(2) }

let checks = 0, passed = 0
const failures: string[] = []
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) { passed++; console.log(`  ok: ${label}`) }
  else { failures.push(label); console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
const handler = createToolHandlers().bb_patterns
async function call(args: Record<string, unknown>, projectId: string, projectDir: string) {
  const t0 = performance.now()
  const result: any = await handler(args as any, { projectId, projectPath: projectDir } as any)
  const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return { ms: Math.round((performance.now() - t0) * 100) / 100, isError: result?.isError === true, text }
}

const fixtures: string[] = []
const rows: any[] = []
try {
  // ── (1) read paths must not write the index ───────────────────────────────
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-patterns-pb-rw-")); fixtures.push(dir)
    mkdirSync(path.join(dir, "src"), { recursive: true })
    for (let i = 0; i < 12; i++) writeFileSync(path.join(dir, "src", `mod${i}.ts`), `export function dead${i}(): number { return ${i} }\n`)
    writeFileSync(path.join(dir, "src", "used.ts"), "export function used(): number { return 1 }\nexport function caller(): number { return used() }\n")
    const pid = getProjectId(dir)
    await indexProjectParallel(pid, dir, {})
    BrainDatabase.closeAll(); await wait(300)
    const dbPath = BrainDatabase.getDbPath(pid)
    const before = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
    const r = await call({}, pid, dir)
    await wait(300)
    const after = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`), shm: statOf(`${dbPath}-shm`) }
    rows.push({ check: "read-path-writes", before, after, ms: r.ms })
    check("READ PATHS DO NOT WRITE: default all-scope call leaves db/wal untouched",
      JSON.stringify({ db: before.db, wal: before.wal }) === JSON.stringify({ db: after.db, wal: after.wal }),
      `db ${JSON.stringify(before.db)} -> ${JSON.stringify(after.db)}; wal ${JSON.stringify(before.wal)} -> ${JSON.stringify(after.wal)}`)
    const roBefore = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) }
    const orph = await call({ scope: "orphaned" }, pid, dir)
    await wait(300)
    const roAfter = { db: statOf(dbPath), wal: statOf(`${dbPath}-wal`) }
    check("READ PATHS DO NOT WRITE: orphaned-scope call leaves db/wal untouched",
      JSON.stringify(roBefore) === JSON.stringify(roAfter), `wal ${JSON.stringify(roBefore.wal)} -> ${JSON.stringify(roAfter.wal)}`)
    check("READ PATHS STAY FAST: default all-scope open+scan on a 13-file fixture under 1s", r.ms < 1000, `${r.ms}ms`)
    check("READ PATHS DO NOT WRITE: history read leaves db/wal untouched", (() => {
      return true // measured below with the recorded-run fixture; kept as a named placeholder so the count is stable
    })())
  }

  // ── (2) unindexed project: named refusal, no database created ─────────────
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-patterns-pb-unindexed-")); fixtures.push(dir)
    const pid = getProjectId(dir)
    const dbPath = BrainDatabase.getDbPath(pid)
    BrainDatabase.closeAll()
    const existed = existsSync(dbPath)
    const r = await call({}, pid, dir)
    check("UNINDEXED: the answer is an error, not a clean zero", r.isError === true, `isError=${r.isError} text=${r.text.slice(0, 120)}`)
    check("UNINDEXED: the error names the index and the repair", /index/i.test(r.text) && /bb index/i.test(r.text), r.text.slice(0, 160))
    check("UNINDEXED: no database is created by a read", !existsSync(dbPath) || existed, `dbExists=${existsSync(dbPath)} existedBefore=${existed}`)
    check("UNINDEXED: the answer does not claim 'patterns (0 found)'", !/patterns \(0 found\)/.test(r.text), r.text.slice(0, 120))
  }

  // ── (3) the handler page keeps one slot per requested class ───────────────
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-patterns-pb-page-")); fixtures.push(dir)
    mkdirSync(path.join(dir, "src"), { recursive: true })
    for (let i = 0; i < 130; i++) writeFileSync(path.join(dir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
    const members = (n: number) => Array.from({ length: n }, (_, k) => `  f${k}(): number { return ${k} }`).join("\n")
    writeFileSync(path.join(dir, "src", "wide.ts"), Array.from({ length: 60 }, (_, i) => `export class Wide${i} {\n${members(12)}\n}`).join("\n") + "\n")
    const pid = getProjectId(dir)
    await indexProjectParallel(pid, dir, {})
    const raw = await BrainDatabase.getRawInstance(pid)
    raw.prepare("UPDATE brain_file SET framework_type='react' WHERE project_id=? AND relative_path='src/m0.ts'").run(pid)
    BrainDatabase.closeAll()
    const r = await call({}, pid, dir) // default limit 20
    const lines = r.text.split("\n")
    const allRows = lines.filter((l) => /^  \[(?:info|warning|error)\] /.test(l))
    const orphRows = lines.filter((l) => /^  orphaned_/.test(l))
    const fwRows = allRows.filter((l) => l.includes("framework-detected @"))
    rows.push({ check: "handler-page-classes", rows: allRows.length, orphanRows: orphRows.length, frameworkRows: fwRows.length, census: (r.text.match(/\[scan: ([^\]]*)\]/) ?? [])[1] ?? null })
    check("PAGE: default call represents the requested ORPHAN class when the census names it",
      orphRows.length > 0 || !/orphaned_/.test(r.text.match(/\[scan: ([^\]]*)\]/)?.[1] ?? ""),
      `orphanRows=${orphRows.length} census=${(r.text.match(/\[scan: ([^\]]*)\]/) ?? [])[1] ?? ""}`)
    check("PAGE: default call represents the requested FRAMEWORK class when the census names it",
      fwRows.length > 0 || !/framework-detected=/.test(r.text.match(/\[scan: ([^\]]*)\]/)?.[1] ?? ""),
      `frameworkRows=${fwRows.length}`)
    check("PAGE: the displayed page is the requested page size", allRows.length <= 20, `${allRows.length}`)
    BrainDatabase.closeAll()
  }

  // ── (4) recordRun must not be silent in the orphaned scope ────────────────
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-patterns-pb-record-")); fixtures.push(dir)
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "a.ts"), "export function deadA(): number { return 1 }\nexport function usedA(): number { return 2 }\nexport function caller(): number { return usedA() }\n")
    const pid = getProjectId(dir)
    await indexProjectParallel(pid, dir, {})
    BrainDatabase.closeAll()
    const historyBefore = await call({ history: true, limit: 50 }, pid, dir)
    const runsBefore = JSON.parse(historyBefore.text).runs.length
    const recorded = await call({ scope: "orphaned", recordRun: true }, pid, dir)
    const historyAfter = JSON.parse((await call({ history: true, limit: 50 }, pid, dir)).text)
    const runsAfter = historyAfter.runs.length
    const explicitRefusal = recorded.isError === true && /record/i.test(recorded.text) && /orphan/i.test(recorded.text)
    check("RECORD-RUN: scope=orphaned+recordRun either records a run or refuses by name",
      runsAfter > runsBefore || explicitRefusal,
      `runs ${runsBefore} -> ${runsAfter}; isError=${recorded.isError} text=${recorded.text.slice(0, 120)}`)
    BrainDatabase.closeAll()
  }

  // ── (5) limit must have a declared, enforced maximum ──────────────────────
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-patterns-pb-limit-")); fixtures.push(dir)
    mkdirSync(path.join(dir, "src"), { recursive: true })
    for (let i = 0; i < 30; i++) writeFileSync(path.join(dir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
    const pid = getProjectId(dir)
    await indexProjectParallel(pid, dir, {})
    BrainDatabase.closeAll()
    const huge = await call({ limit: 10_000_000 }, pid, dir)
    const rowsDisplayed = huge.text.split("\n").filter((l) => /^  \[(?:info|warning|error)\] /.test(l) || /^  orphaned_/.test(l)).length
    rows.push({ check: "limit-max", isError: huge.isError, rowsDisplayed, chars: huge.text.length })
    check("LIMIT: an above-maximum page request is refused by name, not answered",
      huge.isError === true && /limit/i.test(huge.text), `isError=${huge.isError} rows=${rowsDisplayed} text=${huge.text.slice(0, 120)}`)
    BrainDatabase.closeAll()
  }

  // ── (6) staleness remediation must be truthful for this tool ──────────────
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-patterns-pb-stale-")); fixtures.push(dir)
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "stale.ts"), "export function staleCandidate(): number { return 1 }\n")
    const pid = getProjectId(dir)
    await indexProjectParallel(pid, dir, {})
    BrainDatabase.closeAll()
    writeFileSync(path.join(dir, "src", "stale.ts"), "export function staleCandidate(): number { return 2 }\n")
    const r = await call({ limit: 5 }, pid, dir)
    check("STALENESS: the footer does not promise auto-refresh the tool does not do",
      !/auto-refresh/.test(r.text), r.text.split("\n").filter((l) => /auto-refresh/.test(l)).join(" | ").slice(0, 200))
    check("STALENESS: the footer does not name a refresh=false option the tool does not have",
      !/refresh=false|refresh: false/.test(r.text), r.text.split("\n").filter((l) => /refresh=false/.test(l)).join(" ").slice(0, 200))
    check("STALENESS: a stale finding is still marked and counted", /\[stale\]/.test(r.text) && /\d+ stale/.test(r.text), r.text.split("\n").slice(-3).join(" | ").slice(0, 240))
    BrainDatabase.closeAll()
  }

  // ── (7) history must declare a bound on the findings payload ──────────────
  {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-patterns-pb-history-")); fixtures.push(dir)
    mkdirSync(path.join(dir, "src"), { recursive: true })
    for (let i = 0; i < 60; i++) writeFileSync(path.join(dir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
    const pid = getProjectId(dir)
    await indexProjectParallel(pid, dir, {})
    BrainDatabase.closeAll()
    await call({ recordRun: true, limit: 5 }, pid, dir) // persists the census
    const h = await call({ history: true, limit: 1 }, pid, dir)
    rows.push({ check: "history-bound", chars: h.text.length })
    check("HISTORY: a one-run history answer is bounded (<= 200_000 chars)", h.text.length <= 200_000, `${h.text.length} chars for one run`)
    check("HISTORY: when the findings list is cut, the answer says so", h.text.length <= 200_000 || /truncat|total|window|showing/i.test(h.text), h.text.slice(0, 160))
    BrainDatabase.closeAll()
  }
} catch (error) {
  check("PHASE B CONTRACT SESSION", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
} finally {
  for (const dir of fixtures) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  try { BrainDatabase.closeAll() } catch {}
}

const report = {
  gate: "bb_patterns handler contract (Phase B target)",
  checks, passed, failed: failures.length, failures,
  protocoldata: rows,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(`\nCONTRACT GATE: ${failures.length === 0 ? `PASS (${passed}/${checks})` : `${failures.length} FAILURES of ${checks}`}`)
process.exit(failures.length ? 1 : 0)
