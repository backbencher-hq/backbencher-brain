// script/m13/verify-patterns-handler-contract.ts
//
// M13.40 — the bb_patterns TOOL-SURFACE contract, as a hermetic gate.
//
// WHY THIS GATE EXISTS. The pattern ENGINES are well covered (m13 orphans/rules,
// m57 scope=all, m64 evidence gate, m65 rule budgets, m69 page classes), and every
// one of those gates stayed green while the surface above them was wrong: the handler
// opened the index read-write, answered a clean zero for an unindexed project, fetched a
// 100-row page and displayed 20 (dropping the class promotion the engine had just
// applied), accepted an unbounded `limit`, returned 1.8 MB of history, promised
// auto-refresh the tool does not do, and recorded nothing for `scope=orphaned` while
// accepting `recordRun`. None of that is visible to an engine test. This file is the
// guard for the surface itself.
//
// IT IS FALSIFIABLE. `--self-test` copies the repository's src/script tree into a
// tmpdir, plants one mutation at a time in the copy, and requires THIS gate to go red
// for each: a gate that survives every mutation is not a gate.
//
// Usage:
//   BB_DATA_DIR=<scratch lane dir> bun run script/m13/verify-patterns-handler-contract.ts
//   BB_DATA_DIR=<scratch lane dir> bun run script/m13/verify-patterns-handler-contract.ts --self-test

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, existsSync, readFileSync, cpSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { handler as bbPatternsHandler } from "../../src/mcp/tools/bb_patterns/handler"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(ROOT, "validation", "m13", "results")
const SELF_TEST = process.argv.includes("--self-test")

const dataDir = process.env.BB_DATA_DIR
if (!dataDir) {
  console.error("BB_DATA_DIR is required: this gate indexes tmpdir fixtures and must not use the default data dir")
  process.exit(2)
}
// Hermetic: pattern analysis never reads an embedding, and a configured remote
// embedding provider would let the indexer's background drain write between the
// read-path snapshots — turning the write check into a race. Disabled for this gate.
if (process.env.BB_EMBEDDING_DISABLED !== "1") process.env.BB_EMBEDDING_DISABLED = "1"

let failures = 0
let checks = 0
let passed = 0
function check(label: string, value: boolean, detail = ""): void {
  checks++
  if (value) passed++
  if (value) console.log(`  ok: ${label}`)
  else { failures++; console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const statOf = (p: string) => (existsSync(p) ? { bytes: statSync(p).size, mtime: statSync(p).mtime.toISOString() } : null)
/** A missing WAL and a zero-byte WAL are the same file content; only -shm may move. */
const walFingerprint = (p: string) => {
  const s = statOf(p)
  return s === null || s.bytes === 0 ? "absent-or-empty" : JSON.stringify(s)
}
const handler = bbPatternsHandler
async function call(args: Record<string, unknown>, projectId: string, projectDir: string) {
  const t0 = performance.now()
  const result: any = await handler(args as any, { projectId, projectPath: projectDir } as any)
  const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  return { ms: Math.round((performance.now() - t0) * 100) / 100, isError: result?.isError === true, text }
}
/** Displayed finding rows only: two leading spaces, a severity tag or a rule name, never the "none" line. */
function displayedRows(text: string): string[] {
  return text.split("\n").filter((line) => {
    if (!line.startsWith("  ")) return false
    const body = line.trim()
    if (!body || body === "none") return false
    return /^\[(?:info|warning|error)\] /.test(body) || /^orphaned_/.test(body)
  })
}

const fixtures: string[] = []
function makeFixture(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `bb-patterns-contract-${prefix}-`))
  fixtures.push(dir)
  return dir
}
async function indexFixture(dir: string): Promise<string> {
  mkdirSync(path.join(dir, "src"), { recursive: true })
  const projectId = getProjectId(dir)
  await indexProjectParallel(projectId, dir, {})
  // The indexer finishes by scheduling a background embedding drain that writes
  // through its own handle. A read-path measurement taken before that drain settles
  // would attribute the indexer's writes to the tool — the first version of this gate
  // did exactly that and failed intermittently. Flush it, then close every handle, so
  // the snapshots below describe a quiet database.
  await flushBackgroundEmbeddings({ timeoutMs: 5000 })
  BrainDatabase.closeAll()
  await wait(400)
  return projectId
}

const contract = async () => {
  // ── 1. a read must not write the index ───────────────────────────────────
  {
    const dir = makeFixture("rw")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "used.ts"), "export function used(): number { return 1 }\nexport function caller(): number { return used() }\n")
    for (let i = 0; i < 12; i++) writeFileSync(path.join(dir, "src", `mod${i}.ts`), `export function dead${i}(): number { return ${i} }\n`)
    const projectId = await indexFixture(dir)
    const dbPath = BrainDatabase.getDbPath(projectId)
    const snapshot = () => ({ db: statOf(dbPath), wal: walFingerprint(`${dbPath}-wal`) })
    const before = snapshot()
    const all = await call({}, projectId, dir)
    await wait(300)
    const afterAll = snapshot()
    check("READ: default all-scope answer is not an error", !all.isError, all.text.slice(0, 160))
    check("READ: default all-scope call leaves db and WAL unchanged", JSON.stringify(before.db) === JSON.stringify(afterAll.db) && before.wal === afterAll.wal,
      `db ${JSON.stringify(before.db)} -> ${JSON.stringify(afterAll.db)}; wal ${before.wal} -> ${afterAll.wal}`)
    const beforeOrphaned = snapshot()
    const orphaned = await call({ scope: "orphaned" }, projectId, dir)
    await wait(300)
    const afterOrphaned = snapshot()
    check("READ: orphaned-scope answer is not an error", !orphaned.isError, orphaned.text.slice(0, 160))
    check("READ: orphaned-scope call leaves db and WAL unchanged", JSON.stringify(beforeOrphaned.db) === JSON.stringify(afterOrphaned.db) && beforeOrphaned.wal === afterOrphaned.wal,
      `wal ${beforeOrphaned.wal} -> ${afterOrphaned.wal}`)
    const beforeHistory = snapshot()
    const history = await call({ history: true, limit: 5 }, projectId, dir)
    await wait(300)
    const afterHistory = snapshot()
    check("READ: history answer is not an error", !history.isError, history.text.slice(0, 160))
    check("READ: history call leaves db and WAL unchanged", JSON.stringify(beforeHistory.db) === JSON.stringify(afterHistory.db) && beforeHistory.wal === afterHistory.wal,
      `wal ${beforeHistory.wal} -> ${afterHistory.wal}`)
    BrainDatabase.closeAll()
  }

  // ── 2. an unindexed project is a named refusal, not a clean zero ─────────
  {
    const dir = makeFixture("unindexed")
    const projectId = getProjectId(dir)
    const dbPath = BrainDatabase.getDbPath(projectId)
    const existed = existsSync(dbPath)
    const result = await call({}, projectId, dir)
    check("UNINDEXED: the answer is an error, not a clean zero", result.isError === true, `isError=${result.isError} text=${result.text.slice(0, 140)}`)
    check("UNINDEXED: the error names the index and the repair", /index/i.test(result.text) && /bb index/i.test(result.text), result.text.slice(0, 180))
    check("UNINDEXED: the answer does not claim a clean scan", !/patterns \(\d+ found\)/.test(result.text) && !/orphaned code \(\d+ found\)/.test(result.text), result.text.slice(0, 140))
    check("UNINDEXED: a read does not create a database", !existsSync(dbPath) || existed, `dbExists=${existsSync(dbPath)} existedBefore=${existed}`)
    BrainDatabase.closeAll()
  }

  // ── 3. the displayed page keeps one slot per requested class ─────────────
  {
    const dir = makeFixture("page")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    for (let i = 0; i < 130; i++) writeFileSync(path.join(dir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
    const members = (n: number) => Array.from({ length: n }, (_, k) => `  f${k}(): number { return ${k} }`).join("\n")
    writeFileSync(path.join(dir, "src", "wide.ts"), Array.from({ length: 60 }, (_, i) => `export class Wide${i} {\n${members(12)}\n}`).join("\n") + "\n")
    const projectId = await indexFixture(dir)
    const raw = await BrainDatabase.getRawInstance(projectId)
    raw.prepare("UPDATE brain_file SET framework_type='react' WHERE project_id=? AND relative_path='src/m0.ts'").run(projectId)
    BrainDatabase.closeAll()
    const result = await call({}, projectId, dir) // documented default: all scope, limit 20
    const rows = displayedRows(result.text)
    const census = (result.text.match(/\[scan: ([^\]]*)\]/) ?? [])[1] ?? ""
    check("PAGE: the answer is not an error", !result.isError, result.text.slice(0, 160))
    check("PAGE: the displayed page honours the default limit", rows.length <= 20, `${rows.length} rows`)
    check("PAGE: a requested ORPHAN class is represented on the page",
      rows.some((row) => /orphaned_/.test(row)) || !/orphaned_/.test(census), `${rows.length} rows; census=${census.slice(0, 120)}`)
    check("PAGE: a requested FRAMEWORK class is represented on the page",
      rows.some((row) => row.includes("framework-detected")) || !/framework-detected=/.test(census), `${rows.length} rows`)
    check("PAGE: the census line names the whole population", /\d+ finding\(s\)/.test(result.text), census.slice(0, 120))
    BrainDatabase.closeAll()
  }

  // ── 4. recordRun persists in BOTH scopes ─────────────────────────────────
  {
    const dir = makeFixture("record")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "a.ts"), "export function deadA(): number { return 1 }\nexport function deadB(): number { return 2 }\nexport function usedA(): number { return 3 }\nexport function caller(): number { return usedA() }\n")
    const projectId = await indexFixture(dir)
    const runsBefore = JSON.parse((await call({ history: true, limit: 50 }, projectId, dir)).text).runs.length
    const orphanedRecord = await call({ scope: "orphaned", recordRun: true }, projectId, dir)
    check("RECORD-RUN: scope=orphaned records a run", !orphanedRecord.isError && /recorded run/.test(orphanedRecord.text), orphanedRecord.text.slice(0, 160))
    const runsAfterOrphaned = JSON.parse((await call({ history: true, limit: 50 }, projectId, dir)).text).runs.length
    check("RECORD-RUN: the orphaned run is readable back", runsAfterOrphaned === runsBefore + 1, `runs ${runsBefore} -> ${runsAfterOrphaned}`)
    const allRecord = await call({ recordRun: true, limit: 5 }, projectId, dir)
    const header = allRecord.text.split("\n")[0] ?? ""
    const found = Number((header.match(/\((\d+) found/) ?? [])[1] ?? NaN)
    const recorded = Number((header.match(/(\d+) recorded/) ?? [])[1] ?? NaN)
    check("RECORD-RUN: all-scope records the census, not the displayed page", Number.isFinite(found) && found === recorded && found >= 3, header)
    check("RECORD-RUN: the displayed page is still the requested size", displayedRows(allRecord.text).length <= 5, `${displayedRows(allRecord.text).length} rows`)
    BrainDatabase.closeAll()
  }

  // ── 5. limit is bounded and declared; limit=0 is an honest empty page ────
  {
    const dir = makeFixture("limit")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    for (let i = 0; i < 30; i++) writeFileSync(path.join(dir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
    const projectId = await indexFixture(dir)
    const above = await call({ limit: 501 }, projectId, dir)
    check("LIMIT: a request above the declared maximum is refused by name", above.isError === true && /maximum page size 500/.test(above.text), above.text.slice(0, 160))
    const huge = await call({ limit: 1_000_000 }, projectId, dir)
    check("LIMIT: an unbounded request is refused, not answered", huge.isError === true, `isError=${huge.isError}`)
    const zero = await call({ limit: 0 }, projectId, dir)
    check("LIMIT: limit=0 is answered as an empty page", !zero.isError && displayedRows(zero.text).length === 0, zero.text.slice(0, 120))
    check("LIMIT: limit=0 still names the census", /\d+ finding\(s\)/.test(zero.text), zero.text.slice(0, 160))
    const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_patterns")!
    const props = (descriptor.inputSchema as any).properties
    check("SCHEMA: limit publishes default/minimum/maximum", props.limit?.default === 20 && props.limit?.minimum === 0 && props.limit?.maximum === 500, JSON.stringify(props.limit))
    check("SCHEMA: confidenceThreshold publishes default/minimum/maximum", props.confidenceThreshold?.default === 0 && props.confidenceThreshold?.minimum === 0 && props.confidenceThreshold?.maximum === 1, JSON.stringify(props.confidenceThreshold))
    check("SCHEMA: every input property publishes its default", Object.values(props).every((property: any) => property.default !== undefined), Object.keys(props).filter((key) => (props as any)[key].default === undefined).join(","))
    BrainDatabase.closeAll()
  }

  // ── 6. staleness is reported, never "repaired" ───────────────────────────
  {
    const dir = makeFixture("stale")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "stale.ts"), "export function staleCandidate(): number { return 1 }\n")
    const projectId = await indexFixture(dir)
    writeFileSync(path.join(dir, "src", "stale.ts"), "export function staleCandidate(): number { return 2 }\n")
    const result = await call({ limit: 5 }, projectId, dir)
    check("STALENESS: a stale finding is marked", /\[stale\]/.test(result.text), result.text.slice(-240))
    check("STALENESS: the footer counts stale/missing findings' files", /\d+ stale, \d+ missing of \d+ findings' files/.test(result.text), result.text.slice(-240))
    check("STALENESS: the footer does not promise auto-refresh", !/auto-refresh stale files/.test(result.text), result.text.split("\n").filter((line) => /auto-refresh/.test(line)).join(" ").slice(0, 200))
    check("STALENESS: the footer does not name a refresh=false option the schema does not publish", !/refresh=false/.test(result.text), "")
    check("STALENESS: the remediation says the read does NOT auto-refresh", /does NOT auto-refresh/.test(result.text), result.text.slice(-240))
    BrainDatabase.closeAll()
  }

  // ── 7. the orphaned answer renders the evidence channels it claims ───────
  {
    const dir = makeFixture("evidence")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    writeFileSync(path.join(dir, "src", "app.ts"), "export function deadA(): number { return 1 }\nexport function usedA(): number { return 2 }\nexport function caller(): number { return usedA() }\n")
    const projectId = await indexFixture(dir)
    const result = await call({ scope: "orphaned" }, projectId, dir)
    check("EVIDENCE: the orphaned answer renders refused-usage counts", /\[usage-evidence: refused \d+ row\(s\)/.test(result.text), result.text.split("\n").filter((line) => line.startsWith("[usage-evidence")).join(" ").slice(0, 200))
    check("EVIDENCE: the orphaned answer renders import resolution", /imports: \d+ row\(s\), \d+ attributed to a file/.test(result.text), result.text.split("\n").filter((line) => line.startsWith("[usage-evidence")).join(" ").slice(0, 200))
    check("EVIDENCE: the orphaned answer renders suppression accounting", /\[suppressed: /.test(result.text), "")
    check("EVIDENCE: the orphaned answer renders provenance", /\[provenance: /.test(result.text), "")
    BrainDatabase.closeAll()
  }

  // ── 8. history is bounded and declares its bound ─────────────────────────
  {
    const dir = makeFixture("history")
    mkdirSync(path.join(dir, "src"), { recursive: true })
    for (let i = 0; i < 260; i++) writeFileSync(path.join(dir, "src", `m${i}.ts`), `export function unref${i}(): number { return ${i} }\n`)
    const projectId = await indexFixture(dir)
    await call({ recordRun: true, limit: 5 }, projectId, dir)
    const history = await call({ history: true, limit: 1 }, projectId, dir)
    let parsed: any = null
    try { parsed = JSON.parse(history.text) } catch {}
    check("HISTORY: the answer is a JSON object", parsed !== null, history.text.slice(0, 120))
    check("HISTORY: runs are bounded by limit", (parsed?.runs?.length ?? 99) <= 1, `${parsed?.runs?.length} runs`)
    check("HISTORY: the findings window is declared", parsed?.findingsWindow !== undefined && parsed?.findingsTotal !== undefined, JSON.stringify(Object.keys(parsed ?? {})))
    check("HISTORY: the findings array honours the declared window", (parsed?.findings?.length ?? 9999) <= (parsed?.findingsWindow ?? 0), `${parsed?.findings?.length} of total ${parsed?.findingsTotal}`)
    check("HISTORY: a truncated findings list is declared truncated", parsed?.findingsTruncated === true, JSON.stringify({ total: parsed?.findingsTotal, returned: parsed?.findingsReturned, truncated: parsed?.findingsTruncated }))
    check("HISTORY: a one-run answer stays bounded (<= 400_000 chars)", history.text.length <= 400_000, `${history.text.length} chars`)
    BrainDatabase.closeAll()
  }
}

async function selfTest(): Promise<void> {
  // Each mutation reverts ONE contract decision in a tmp copy; the gate must go red and
  // name the decision. The mirror is the repository's src/script tree plus the config the
  // gate imports; wasm and node_modules are symlinked rather than copied.
  const MUTATIONS: Array<{ id: string; file: string; find: string; replace: string; undoes: string; expect: RegExp }> = [
    { id: "M1", file: "src/mcp/tools/bb_patterns/handler.ts", find: "return { rawDb: await BrainDatabase.getRawInstance(projectId as any, { readonly: true }) }", replace: "return { rawDb: await BrainDatabase.getRawInstance(projectId as any) }", undoes: "the byte-read-only open (a read must not write the index)", expect: /READ: default all-scope call leaves db and WAL unchanged/ },
    { id: "M2", file: "src/mcp/tools/bb_patterns/handler.ts", find: "maxResults: enginePage,", replace: "maxResults: Math.max(enginePage, 100),", undoes: "the page-size contract (promotion must apply to the page the caller asked for)", expect: /PAGE: a requested (ORPHAN|FRAMEWORK) class is represented/ },
    { id: "M3", file: "src/mcp/tools/bb_patterns/handler.ts", find: "const MAX_LIMIT = 500", replace: "const MAX_LIMIT = 1_000_000", undoes: "the limit ceiling", expect: /LIMIT: a request above the declared maximum is refused by name/ },
    { id: "M4", file: "src/mcp/tools/bb_patterns/handler.ts", find: "const HISTORY_FINDINGS_WINDOW = 200", replace: "const HISTORY_FINDINGS_WINDOW = Number.MAX_SAFE_INTEGER", undoes: "the history findings window", expect: /HISTORY: a truncated findings list is declared truncated/ },
    { id: "M5", file: "src/mcp/tools/bb_patterns/handler.ts", find: "const footer = stalenessFooter(derived.summary)", replace: "const footer = derived.footer", undoes: "the manual-only staleness remediation", expect: /STALENESS: the footer does not promise auto-refresh/ },
    { id: "M6", file: "src/mcp/tools/bb_patterns/handler.ts", find: "const evidenceLine = usageEvidence && importResolution", replace: "const evidenceLine = null", undoes: "the rendered evidence channels", expect: /EVIDENCE: the orphaned answer renders refused-usage counts/ },
  ]
  const gatePath = fileURLToPath(import.meta.url)
  const isBun = typeof (globalThis as any).Bun !== "undefined"
  const childArgs = (scriptPath: string) => (isBun ? [scriptPath] : ["--import", "tsx", scriptPath])
  let selfFailures = 0
  const record: any[] = []
  const makeMirror = () => {
    const mirror = mkdtempSync(path.join(tmpdir(), "bb-patterns-contract-mirror-"))
    for (const entry of ["src", "script", "package.json", "tsconfig.json"]) {
      cpSync(path.join(ROOT, entry), path.join(mirror, entry), { recursive: true })
    }
    for (const asset of ["wasm"]) {
      if (existsSync(path.join(ROOT, asset))) { try { symlinkSync(path.join(ROOT, asset), path.join(mirror, asset), "dir") } catch {} }
    }
    try { symlinkSync(path.join(ROOT, "node_modules"), path.join(mirror, "node_modules"), "dir") } catch {}
    return mirror
  }
  const runGate = (mirror: string) => {
    const scratch = mkdtempSync(path.join(tmpdir(), "bb-patterns-contract-data-"))
    try {
      const out = execFileSync(process.execPath, childArgs(path.join(mirror, "script/m13/verify-patterns-handler-contract.ts")), {
        cwd: mirror,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 600_000,
        env: { ...process.env, BB_DATA_DIR: scratch, BB_NO_AUTO_REFRESH: "1" },
      })
      return { status: 0, out }
    } catch (error: any) {
      return { status: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  // Baseline: the unmutated mirror must be GREEN, or every mutation result is vacuous.
  {
    const mirror = makeMirror()
    try {
      const baseline = runGate(mirror)
      const green = baseline.status === 0 && /CONTRACT GATE: PASS/.test(baseline.out)
      console.log(`  ${green ? "ok" : "FAIL"}: baseline mirror is GREEN on the unmodified tree`)
      if (!green) { selfFailures++; console.log(baseline.out.split("\n").filter((line) => /FAIL|CONTRACT GATE/.test(line)).join("\n").slice(0, 800)) }
      record.push({ mutant: "baseline", green, status: baseline.status })
    } finally { rmSync(mirror, { recursive: true, force: true }) }
  }
  for (const mutation of MUTATIONS) {
    const mirror = makeMirror()
    let patched = false
    try {
      const target = path.join(mirror, mutation.file)
      const source = readFileSync(target, "utf8")
      if (source.includes(mutation.find)) {
        writeFileSync(target, source.replace(mutation.find, mutation.replace))
        patched = true
      }
      if (!patched) {
        selfFailures++
        console.log(`  FAIL: ${mutation.id} anchor text is present in ${mutation.file} (the source moved; the mutation table is stale)`)
        record.push({ mutant: mutation.id, patched: false })
        continue
      }
      const result = runGate(mirror)
      const caught = result.status !== 0 && mutation.expect.test(result.out)
      if (!caught) selfFailures++
      console.log(`  ${caught ? "ok" : "FAIL"}: ${mutation.id} the gate goes RED when this is undone — ${mutation.undoes}`)
      record.push({ mutant: mutation.id, caught, status: result.status, undoes: mutation.undoes })
    } finally { rmSync(mirror, { recursive: true, force: true }) }
  }
  const report = {
    issue: "M13.40", code: "P6", tool: "bb_patterns",
    title: "bb_patterns handler contract: read-only, bounded page, bounded history, honest staleness/evidence, falsifiable",
    gate: "script/m13/verify-patterns-handler-contract.ts",
    mode: "self-test (mutations in tmp copies)",
    baselineGreen: record[0]?.green === true,
    mutants: record.slice(1),
    mutantsCaught: record.slice(1).filter((row) => row.caught === true).length,
    mutantsPlanted: MUTATIONS.length,
    failed: selfFailures,
    verifiedState: selfFailures === 0 ? "verified" : "known-gap",
    generatedAt: new Date().toISOString(),
  }
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(path.join(RESULTS, "p6-selftest.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(`\nCONTRACT SELF-TEST: ${selfFailures === 0 ? `PASS (${report.mutantsCaught}/${MUTATIONS.length} mutants caught, baseline green)` : `${selfFailures} FAILURES`}`)
  process.exit(selfFailures === 0 ? 0 : 1)
}

try {
  if (SELF_TEST) {
    await selfTest()
  } else {
    await contract()
    BrainDatabase.closeAll()
    const report = {
      issue: "M13.40", code: "P6", tool: "bb_patterns",
      title: "bb_patterns handler contract: read-only, bounded page, bounded history, honest staleness/evidence",
      gate: "script/m13/verify-patterns-handler-contract.ts",
      checks, passed, failed: failures,
      status: failures === 0 ? "verified" : "known-gap",
      verifierCommand: "bun run script/m13/verify-patterns-handler-contract.ts",
      generatedAt: new Date().toISOString(),
    }
    mkdirSync(RESULTS, { recursive: true })
    writeFileSync(path.join(RESULTS, "p6.json"), JSON.stringify(report, null, 2) + "\n")
    console.log(`\nCONTRACT GATE: ${failures === 0 ? `PASS (${passed}/${checks})` : `${failures} FAILURES of ${checks}`}`)
    process.exit(failures === 0 ? 0 : 1)
  }
} finally {
  for (const dir of fixtures) { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  try { BrainDatabase.closeAll() } catch {}
}
