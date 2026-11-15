/**
 * GraphQL — is the corpus anywhere near the 45s per-file self-timeout?
 *
 * The question this answers. Three walks of the same 1,905-file corpus returned 156,702 / 156,763
 * / 156,702 edges — a 61-edge spread, 0.039%. `parsefile-dir-effect.mts` established that
 * `parseFile` is a pure function of (bytes, dir) within one process, so the spread is not the
 * argument and not run order. The remaining mechanism in `src/ast/pool-worker.ts` is the per-file
 * worker self-timeout:
 *
 *     // 45s per-file self-timeout; env-configurable (BB_FILE_TIMEOUT_MS)   pool-worker.ts:1304
 *     const FILE_TIMEOUT_MS = Number(process.env.BB_FILE_TIMEOUT_MS || 45000)
 *
 * A file that exceeds it has its worker KILLED and retried, which is a mechanism by which the same
 * bytes yield fewer relationships under heavier machine load. That is a hypothesis, not a finding.
 * This probe measures the per-file parse time so the hypothesis can be confirmed or killed: if the
 * slowest file is far below 45s, the timeout cannot be the cause and the spread has another source,
 * which is a different and more interesting defect.
 *
 * Sequential and timing-inclusive, because the quantity of interest is wall time under contention.
 */
import * as path from "path"
import * as fs from "fs"
import { execFileSync } from "child_process"
import { statSync } from "fs"
import { ROOT } from "../paths.mts"

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.GQL_LIMIT ?? 400)

const files: { abs: string; dir: string; label: string }[] = []
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "graphql") continue
    files.push({ abs, dir, label: `${e}/${rel}` })
  }
  if (files.length >= LIMIT) break
}
if (files.length > LIMIT) files.length = LIMIT

const FILE_TIMEOUT_MS = Number(process.env.BB_FILE_TIMEOUT_MS || 45000)
const times: { ms: number; label: string; bytes: number; rels: number }[] = []
for (const f of files) {
  const bytes = statSync(f.abs).size
  const t0 = process.hrtime.bigint()
  const r: any = await parseFile(f.abs, f.dir).catch(() => null)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  times.push({ ms, label: f.label, bytes, rels: r ? (r.relationships ?? []).length : -1 })
}

const sorted = [...times].sort((a, b) => b.ms - a.ms)
const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]?.ms ?? 0
const total = times.reduce((s, t) => s + t.ms, 0)

console.log(JSON.stringify({
  files: times.length,
  perFileTimeoutMs: FILE_TIMEOUT_MS,
  sequentialWallMs: Math.round(total),
  maxMs: Math.round(sorted[0].ms),
  p99Ms: Math.round(pct(1)),
  p50Ms: Math.round(pct(50)),
  overTimeout: times.filter((t) => t.ms > FILE_TIMEOUT_MS).length,
  top10Slowest: sorted.slice(0, 10).map((t) => ({ ms: Math.round(t.ms), bytes: t.bytes, rels: t.rels, file: t.label })),
  headroomToTimeout: `${Math.round(FILE_TIMEOUT_MS / Math.max(1, sorted[0].ms))}x`,
  verdict: sorted[0].ms > FILE_TIMEOUT_MS
    ? "A FILE EXCEEDS THE TIMEOUT — the retry path can and does drop edges, so production counts are load-dependent."
    : `SLOWEST FILE IS ${Math.round(sorted[0].ms)}ms, ${Math.round(FILE_TIMEOUT_MS / Math.max(1, sorted[0].ms))}x UNDER the 45s self-timeout — the timeout CANNOT explain the 61-edge spread. Measured on ${times.length} files.`,
}, null, 1))