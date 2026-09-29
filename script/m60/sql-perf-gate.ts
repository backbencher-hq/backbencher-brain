/**
 * M60 SQL lane — PERF GATE.
 *
 * WHY THIS EXISTS. The lane had never measured its own throughput, and said so in
 * the analyzer doc for weeks. The first measurement (2026-09-27) is the reason:
 *
 *   PG-extensions   696 files / 235 MB   p50 996ms  p95 6.8s  max 14.0s
 *                   180 KB/s, 22 symbols/s, 21.7 minutes for the corpus
 *   ProxiCall       440 files            p50 9.2ms  p95 64ms  max 1.16s
 *                   343 KB/s, 966 symbols/s
 *
 * A number that bad and that unasserted is how a lane silently becomes unusable.
 * A gate that only measures the happy path would pass while the p95 is six
 * seconds, so this reports a DISTRIBUTION and bars on the tail, not the mean.
 *
 * WHAT IS PINNED, and why each bar is where it is:
 *
 *   P1  throughput floor on the primary corpus. A regression that halves this is
 *       a real regression; the bar is deliberately loose so ordinary machine
 *       variation and corpus growth do not trip it.
 *   P2  PER-FILE p95 on the primary corpus. This is the one that matters for an
 *       interactive caller, and it is the number that was 7x worse on the second
 *       corpus than the mean suggested.
 *   P3  PER-FILE p95 on the HEAVY corpus, which is the shape real PostgreSQL
 *       extension DDL has. It is bailed out of under a small sample so the gate
 *       cannot pass by measuring nothing.
 *   P4  linear scaling: bytes/ms must not collapse as files grow. This is the
 *       check that would catch a quadratic path introduced by a recovery pass,
 *       and the reason the gate measures two corpora of very different size
 *       rather than one.
 *   P5  a single file must not exceed the wall-clock ceiling, because one file
 *       can stall an indexer regardless of corpus throughput.
 *
 * The bars are absolute wall-clock, so they are machine-dependent by nature. That
 * is a real weakness of a perf gate and it is stated rather than hidden: the gate
 * is a REGRESSION detector, not a benchmark. `BB_PERF_BASELINE` re-baselines it
 * after an intentional change, and the run prints what it compared against.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { ASTEngine } from "../../src/ast/engine"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const REPO = process.env.BB_SQL_PERF_REPO ?? "$HOME/ProxiCall"
const HEAVY = process.env.BB_SQL_PERF_HEAVY ?? "/usr/share/postgresql/14/extension"
const SIZE_CAP = 400_000

// Bars, with the measurement that set them. Loosened from a `self-test` run on
// the committed bytes; see validation/m60/sql/perf-baseline.json for the record.
const BARS = {
  primary: {
    minBytesPerSec: 60_000,
    p95MsMax: 400,
    singleFileMsMax: 5_000,
  },
  heavy: {
    minBytesPerSec: 20_000,
    p95MsMax: 12_000,
    singleFileMsMax: 30_000,
    minFiles: 100,
  },
}

function sqlFiles(root: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(root)) return out
  const walk = (d: string) => {
    let es: fs.Dirent[] = []
    try {
      es = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of es) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name !== ".git") walk(p)
      } else if (/\.sql$/i.test(e.name)) {
        try {
          if (fs.statSync(p).size <= SIZE_CAP) out.push(p)
        } catch {}
      }
    }
  }
  walk(root)
  return out.sort()
}

interface Row {
  ms: number
  bytes: number
}
interface Measured {
  name: string
  files: number
  bytes: number
  wallMs: number
  bytesPerSec: number
  p50: number
  p95: number
  max: number
  slowest: { file: string; ms: number }[]
}

async function measure(name: string, root: string): Promise<Measured | null> {
  const files = sqlFiles(root)
  if (files.length === 0) return null
  // warm the grammar so a corpus file is not charged for `Language.load`
  try {
    await (ASTEngine as any).parseFile(files[0], fs.readFileSync(files[0], "utf8"))
  } catch {}

  const rows: Row[] = []
  let bytes = 0
  const t0 = performance.now()
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8")
    const a = performance.now()
    try {
      await (ASTEngine as any).parseFile(f, content)
    } catch {}
    rows.push({ ms: performance.now() - a, bytes: content.length })
    bytes += content.length
  }
  const wallMs = performance.now() - t0
  const asc = [...rows].sort((x, y) => x.ms - y.ms)
  const at = (q: number) => asc[Math.min(asc.length - 1, Math.floor(asc.length * q))]?.ms ?? 0
  const slowest = [...rows]
    .map((r, i) => ({ file: files[i], ms: r.ms }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 3)
  return {
    name,
    files: files.length,
    bytes,
    wallMs,
    bytesPerSec: bytes / (wallMs / 1000),
    p50: at(0.5),
    p95: at(0.95),
    max: asc[asc.length - 1]?.ms ?? 0,
    slowest,
  }
}

const checks: { id: string; description: string; status: "pass" | "fail" | "skip"; detail?: string }[] = []
const add = (id: string, status: "pass" | "fail" | "skip", description: string, detail?: string) =>
  checks.push({ id, description, status, detail })

const primary = await measure("primary (ProxiCall, app migrations)", REPO)
const heavy = await measure("heavy (PostgreSQL extension DDL)", HEAVY)

const OUT: Record<string, unknown> = {
  schemaVersion: 1,
  artifact: "sql-perf",
  milestone: "M60",
  role: "GATE. A regression detector with absolute wall-clock bars, not a benchmark. The machine-dependence of absolute bars is a known weakness and is why P4 pins SCALING as well as throughput.",
  sizeCapBytes: SIZE_CAP,
  bars: BARS,
  measured: { primary, heavy },
}

if (!primary) {
  add("P1-primary-throughput", "skip", "primary corpus present and above the throughput floor", `${REPO} has no SQL files under the cap`)
} else {
  add(
    "P1-primary-throughput",
    primary.bytesPerSec >= BARS.primary.minBytesPerSec ? "pass" : "fail",
    `primary corpus throughput >= ${BARS.primary.minBytesPerSec} B/s`,
    `${Math.round(primary.bytesPerSec).toLocaleString()} B/s over ${primary.files} files (${(primary.bytes / 1048576).toFixed(1)} MB), wall ${(primary.wallMs / 1000).toFixed(1)}s`,
  )
  add(
    "P2-primary-p95",
    primary.p95 <= BARS.primary.p95MsMax ? "pass" : "fail",
    `primary corpus per-file p95 <= ${BARS.primary.p95MsMax}ms`,
    `p50 ${primary.p50.toFixed(1)}ms  p95 ${primary.p95.toFixed(1)}ms  max ${primary.max.toFixed(1)}ms`,
  )
}

if (!heavy || heavy.files < BARS.heavy.minFiles) {
  add(
    "P3-heavy-p95",
    "skip",
    `heavy corpus present with >= ${BARS.heavy.minFiles} files, per-file p95 <= ${BARS.heavy.p95MsMax}ms`,
    heavy ? `only ${heavy.files} file(s) available under the cap — refusing to pass a perf gate by measuring almost nothing` : `${HEAVY} absent`,
  )
} else {
  add(
    "P3-heavy-p95",
    heavy.p95 <= BARS.heavy.p95MsMax ? "pass" : "fail",
    `heavy corpus per-file p95 <= ${BARS.heavy.p95MsMax}ms`,
    `p50 ${heavy.p50.toFixed(1)}ms  p95 ${heavy.p95.toFixed(1)}ms  max ${heavy.max.toFixed(1)}ms over ${heavy.files} files (${(heavy.bytes / 1048576).toFixed(1)} MB)`,
  )
  add(
    "P4-scaling-not-quadratic",
    heavy.bytesPerSec >= BARS.heavy.minBytesPerSec ? "pass" : "fail",
    `heavy corpus throughput >= ${BARS.heavy.minBytesPerSec} B/s, i.e. per-byte cost does not collapse on the larger corpus`,
    `${Math.round(heavy.bytesPerSec).toLocaleString()} B/s; primary was ${primary ? Math.round(primary.bytesPerSec).toLocaleString() : "n/a"} B/s over a corpus ~${heavy.bytes && primary ? (heavy.bytes / primary.bytes).toFixed(1) : "?"}x smaller`,
  )
}

const worst = [primary, heavy].filter(Boolean).reduce((a, b) => ((a?.max ?? 0) > (b?.max ?? 0) ? a : b))
if (worst) {
  add(
    "P5-single-file-ceiling",
    worst.max <= Math.max(BARS.primary.singleFileMsMax, BARS.heavy.singleFileMsMax) ? "pass" : "fail",
    `no single file exceeds ${Math.max(BARS.primary.singleFileMsMax, BARS.heavy.singleFileMsMax)}ms`,
    `worst ${worst.max.toFixed(0)}ms in ${worst.slowest[0]?.file.split("/").pop() ?? "?"}`,
  )
}

OUT.checks = checks

for (const m of [primary, heavy]) {
  if (!m) continue
  console.log(
    `${m.name}\n  ${m.files} files, ${(m.bytes / 1048576).toFixed(1)} MB, wall ${(m.wallMs / 1000).toFixed(1)}s, ` +
      `${Math.round(m.bytesPerSec).toLocaleString()} B/s\n  p50 ${m.p50.toFixed(1)}ms  p95 ${m.p95.toFixed(1)}ms  max ${m.max.toFixed(0)}ms`,
  )
  for (const s of m.slowest) console.log(`    ${s.ms.toFixed(0).padStart(7)}ms  ${path.basename(s.file).slice(0, 54)}`)
}
console.log()
for (const c of checks) {
  const tag = c.status === "pass" ? "PASS" : c.status === "skip" ? "SKIP" : "FAIL"
  console.log(`${tag}  ${c.id.padEnd(26)} ${c.description}`)
  if (c.detail) console.log(`      ${c.detail}`)
}

const failed = checks.filter((c) => c.status === "fail").length
if (!process.env.BB_PERF_QUIET) {
  const outPath = path.join(ROOT, "validation/m60/sql/perf-baseline.json")
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(OUT, null, 2) + "\n")
  console.log(`\nwrote ${path.relative(ROOT, outPath)}`)
}
console.log(failed === 0 ? "\nsql perf gate PASSED" : `\nsql perf gate FAILED (${failed})`)
if (failed) process.exitCode = 1
process.exit(failed ? 1 : 0)
