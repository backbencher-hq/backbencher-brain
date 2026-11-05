/**
 * GO BASELINE CHUNK DRIVER (task-38) — the declared whole-population shape.
 *
 * The Lead's ruling: a single pooled `go go 0` run is ~2 h and holds ~5.5 M edges in pooled maps, so
 * the WHOLE-POPULATION BASELINE IS THE UNION OF 27 PER-REPO ARMS (all admitted repos), run one at a
 * time in Lead-granted windows. Rules this driver enforces:
 *   · classification columns (resolved / collRes / amb(decl) / amb(kind) / unresolved / extOK / ext?)
 *     SUM EXACTLY across chunks — the aggregate sums them;
 *   · arbitraryTwin / nothingAnywhere / intent closure are RUN-SCOPED: recorded PER REPO and never
 *     pooled or compared to a pooled number; closure is checked per chunk;
 *   · population statement is exact: 27 admitted repos (present `.go`, ≤1 MB); the eight oversize
 *     files are named per repo in the dump header, no file is silently skipped.
 *
 * PRE-COMMITTED TABLE SHAPE (the page):
 *   repo | files_parsed | TOTAL | resolved | collRes | ambDecl | ambKind | unresolved | extOK | ext?
 *        | failures(extFAIL/bindFAIL/causeFAIL) | arbitraryTwin(run-scoped) | closure(per-chunk)
 *        | runtime_s
 *
 * Usage:
 *   bun run script/m14/go-baseline-driver.ts --plan                 # print the 27 chunks + commands
 *   bun run script/m14/go-baseline-driver.ts --repo <name>          # ONE chunk (heavy; granted window only)
 *   bun run script/m14/go-baseline-driver.ts --aggregate             # union of recorded chunks
 */
import { execFileSync, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : process.cwd()
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const WORK = path.join(ROOT, ".tmp-go")
const DUMPS = path.join(WORK, "dumps")
// REGISTERED MEASUREMENT RECORD, CANONICAL PATH: this driver records per-chunk MEASUREMENTS of the go
// population (and their aggregate), not a harness-v2 claim; claims in `validation/m14/results/*.json`
// are written only by evidence-harness `emitEvidence`. Its basename is a NAMED registration in the
// harness's MEASUREMENT_RECORDS allowlist. See validation/m14/results/archive/README.md.
const RESULT = path.join(ROOT, "validation/m14/results/go-baseline-chunks.json")
const MAX_SIZE = 1024 * 1024

type Plan = { repo: string; files: number; absent: number; oversize: number }
function plan(): Plan[] {
  const repos = fs.readdirSync(CORPUS).filter((r) => { try { return fs.statSync(path.join(CORPUS, r)).isDirectory() } catch { return false } }).sort()
  const out: Plan[] = []
  for (const repo of repos) {
    const dir = path.join(CORPUS, repo)
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
    let files = 0, absent = 0, oversize = 0
    for (const rel of tracked) {
      if (!rel.endsWith(".go")) continue
      const abs = path.join(dir, rel)
      try { const st = fs.statSync(abs); if (st.size > MAX_SIZE) oversize++; else files++ } catch { absent++ }
    }
    if (files > 0) out.push({ repo, files, absent, oversize })
  }
  return out.sort((a, b) => b.files - a.files)
}
const command = (repo: string): string =>
  `BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=3000000 bun run script/m14/incoming-gate.ts go go 0 --repo=${repo} --dump > .tmp-go/dumps/${repo}.txt 2> .tmp-go/${repo}.log`
type Row = Record<string, any>
function parseChunk(repo: string, output: string, runtimeS: number): Row {
  const lines = output.split("\n")
  const int = (s: string): number => Number(s.replace(/,/g, "")) || 0
  const row: Row = { repo, runtime_s: runtimeS }
  const popIdx = lines.findIndex((l) => l.startsWith("population:"))
  if (popIdx >= 0) {
    const m = lines[popIdx]!.match(/population:\s*(\d+) parsed of (\d+) sampled/)
    if (m) { row.files_parsed = int(m[1]!); row.files_sampled = int(m[2]!) }
    row.population_line = lines[popIdx]!.trim()
  }
  const parseFail = lines.find((l) => l.startsWith("parse failures:"))
  if (parseFail) row.parse_failures = parseFail.trim()
  // classification row
  const totalIdx = lines.findIndex((l) => /^TOTAL\s/.test(l))
  if (totalIdx >= 0) {
    const cols = lines[totalIdx]!.trim().split(/\s+/)
    row.TOTAL = int(cols[1] ?? "0"); row.resolved = int(cols[2] ?? "0"); row.collRes = int(cols[3] ?? "0")
    row.ambDecl = int(cols[4] ?? "0"); row.ambKind = int(cols[5] ?? "0"); row.unresolved = int(cols[6] ?? "0")
    row.extOK = int(cols[7] ?? "0"); row.extQ = int(cols[8] ?? "0")
    row.extFAIL = int(cols[9] ?? "0"); row.bindOK = int(cols[10] ?? "0"); row.bindQ = int(cols[11] ?? "0")
    row.bindFAIL = int(cols[12] ?? "0"); row.causeOK = int(cols[13] ?? "0"); row.causeFAIL = int(cols[14] ?? "0")
    row.failures = (row.extFAIL + row.bindFAIL + row.causeFAIL) as number
  }
  // intent / arbitraryTwin row (RUN-SCOPED — never pooled, never compared to another repo)
  const intentHeader = lines.findIndex((l) => l.includes("type          edges    intended"))
  if (intentHeader >= 0) {
    const t = lines.findIndex((l, i) => i > intentHeader && /^\s*TOTAL\s/.test(l))
    if (t >= 0) {
      const cols = lines[t]!.trim().split(/\s+/)
      // columns: TOTAL(tokens=1) then intended, sameFileUnproven, arbitraryTwin, nothingAnywhere, noTarget
      row.intended = int(cols[2] ?? "0"); row.sameFileUnproven = int(cols[3] ?? "0")
      row.arbitraryTwin_run_scoped = int(cols[4] ?? "0"); row.nothingAnywhere_run_scoped = int(cols[5] ?? "0")
      row.noTarget = int(cols[6] ?? "0")
    }
  }
  row.closure = lines.some((l) => l.includes("INTENT CLOSURE: every row closes")) ? "EXACT"
    : lines.some((l) => l.includes("INTENT CLOSURE")) ? "CHECK" : "MISSING"
  const verdict = lines.find((l) => l.startsWith("VERDICT:"))
  if (verdict) row.verdict = verdict.trim().slice(0, 200)
  row.dump_file = path.join(".tmp-go/dumps", `${repo}.txt`)
  return row
}
function loadRows(): Row[] {
  try { const d = JSON.parse(fs.readFileSync(RESULT, "utf8")); return Array.isArray(d.chunks) ? d.chunks : [] } catch { return [] }
}
function saveRows(rows: Row[], planRows: Plan[]): void {
  const total = rows.reduce((s, r) => s + (r.TOTAL ?? 0), 0)
  const agg: Record<string, number> = {}
  for (const k of ["files_parsed", "TOTAL", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extQ", "extFAIL", "bindOK", "bindQ", "bindFAIL", "causeOK", "causeFAIL"]) {
    agg[k] = rows.reduce((s, r) => s + (r[k] ?? 0), 0)
  }
  const stated = {
    shape: "CHUNKED WHOLE POPULATION — union of per-repo arms; classification columns sum exactly; arbitraryTwin/nothingAnywhere/closure are RUN-SCOPED per repo and MUST NOT be pooled",
    admitted_repos: planRows.length,
    admitted_files: planRows.reduce((s, p) => s + p.files, 0),
    chunks_recorded: rows.length,
    chunks_pending: planRows.filter((p) => !rows.some((r) => r.repo === p.repo)).map((p) => p.repo),
    exclusions: planRows.filter((p) => p.absent + p.oversize > 0).map((p) => ({ repo: p.repo, absent: p.absent, oversize: p.oversize })),
    aggregate_classification_columns: agg,
    chunks: rows,
  }
  fs.mkdirSync(path.dirname(RESULT), { recursive: true })
  fs.writeFileSync(RESULT, JSON.stringify(stated, null, 2))
}
const arg = process.argv
const planRows = plan()
if (arg.includes("--plan")) {
  console.log(`GO BASELINE PLAN — ${planRows.length} admitted repos, ${planRows.reduce((s, p) => s + p.files, 0)} files (present, ≤1 MB)`)
  console.log("repo              files  absent  oversize  command")
  for (const p of planRows) console.log(`${p.repo.padEnd(17)} ${String(p.files).padStart(5)} ${String(p.absent).padStart(7)} ${String(p.oversize).padStart(9)}  ${command(p.repo)}`)
} else if (arg.includes("--repo")) {
  const repo = arg[arg.indexOf("--repo") + 1]!
  const p = planRows.find((x) => x.repo === repo)
  if (!p) { console.error(`unknown repo ${repo}`); process.exit(2) }
  fs.mkdirSync(DUMPS, { recursive: true })
  const cmd = `export BB_CORPUS_ROOT=$PWD/.corpus; export BB_DUMP_LIMIT=3000000; bun run script/m14/incoming-gate.ts go go 0 --repo=${repo} --dump`
  const t0 = performance.now()
  // The gate EXITS 1 when a clause fails — that is its verdict, not a harness error. spawnSync (not
  // execFileSync, which throws on nonzero status) is required or every chunk's stdout is lost.
  const run = spawnSync("bash", ["-lc", cmd], { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, timeout: 3 * 60 * 60 * 1000 })
  const runtime = Math.round((performance.now() - t0) / 100) / 10
  if (run.error) { console.error("chunk spawn error:", run.error); process.exit(2) }
  if (run.status !== 0 && run.status !== 1) { console.error("gate exited", run.status, (run.stderr ?? "").slice(-800)); process.exit(2) }
  const out = run.stdout ?? ""
  fs.writeFileSync(path.join(DUMPS, `${repo}.txt`), out)
  fs.writeFileSync(path.join(WORK, `${repo}.log`), run.stderr ?? "")
  const rows = loadRows().filter((r) => r.repo !== repo)
  const row = parseChunk(repo, out, runtime)
  rows.push(row)
  rows.sort((a, b) => planRows.findIndex((p) => p.repo === a.repo) - planRows.findIndex((p) => p.repo === b.repo))
  saveRows(rows, planRows)
  console.log(JSON.stringify(row, null, 1))
} else if (arg.includes("--reparse")) {
  const repos = arg.slice(arg.indexOf("--reparse") + 1).filter((a) => !a.startsWith("--"))
  const rows = loadRows()
  for (const repo of repos) {
    const dumpPath = path.join(DUMPS, `${repo}.txt`)
    if (!fs.existsSync(dumpPath)) { console.error(`no dump for ${repo}`); process.exit(2) }
    const out = fs.readFileSync(dumpPath, "utf8")
    const prev = rows.find((r) => r.repo === repo)
    const row = parseChunk(repo, out, prev?.runtime_s ?? 0)
    const idx = rows.findIndex((r) => r.repo === repo)
    if (idx >= 0) { rows[idx] = { ...rows[idx], ...row } } else { rows.push(row) }
    rows.sort((a, b) => planRows.findIndex((p) => p.repo === a.repo) - planRows.findIndex((p) => p.repo === b.repo))
    console.log(JSON.stringify(row, null, 1))
  }
  saveRows(rows, planRows)
} else if (arg.includes("--aggregate")) {
  const rows = loadRows()
  console.log(JSON.stringify({ chunks: rows.length, aggregate: rows.reduce((s, r) => s + (r.TOTAL ?? 0), 0) }, null, 1))
} else {
  console.log("usage: --plan | --repo <name> | --aggregate")
}
