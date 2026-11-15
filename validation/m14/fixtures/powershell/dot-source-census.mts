/**
 * POWERSHELL — THE DOT-SOURCE CENSUS: every invocation-operator edge the analyzer emits,
 * split by OPERATOR TEXT (the dot vs the call operator).
 *
 * WHY THIS EXISTS. `part_of`'s contract (`src/ast/types.ts:PartOf`) is "a library unit
 * INCLUDES a part file … a part shares the including unit's single scope". PowerShell's
 * dot-source operator — `. ./lib.ps1` — is the inclusion construct that DOES share the
 * caller's scope: the dot-sourced file's functions and variables become available in the
 * CALLER's session state, which is the contract's positive test. The call operator
 * `& ./run.ps1` runs the same file in a CHILD scope — its own — which is what `calls`
 * records. `Import-Module`/`using module` load a module into its own scope — `imports`.
 *
 * This census measures the invokation-operator population BEFORE the relabel and AFTER it
 * (the same instrument, re-run), so the movement can be stated as a number rather than a
 * claim:
 *
 *   BEFORE  the analyzer emits `calls` edges carrying `metadata.invokationOperator: "."` or `"&"`
 *   AFTER   the DOT half is `part_of` (carrying the same operator marker + `partRole:"library"`
 *           + `metadata.partPath`), the AMP half is `calls`; the TOTAL is unchanged — a label
 *           moved, no edge gained or lost (the svelte/rust relabel discipline)
 *
 * WHAT IT MEASURES. It reads PRODUCTION output — `parseFile` from `src/ast/pool-worker.ts`,
 * never `analyze()`, which skips the pool, the size gates and the enhancements. For every
 * emitted relationship carrying an `invokationOperator`, it records the operator, the edge
 * type, the target, the file and the line, and whether the target names a file the
 * population admits (by basename, the arbiter's own suffix-match rule: a bare `Helper.psm1`
 * and a spelt `.\modules\Helper.psm1` share a basename — PSD11's lesson).
 *
 * THE POPULATION. The WHOLE admitted set, admitted byte-identically to the arbiter AND to
 * `census.ts` in this directory: per-repo `git ls-files` under BB_CORPUS_ROOT, the 512 KiB
 * cap, `detectLanguageFromPath(abs, text) === "powershell"`. No sampling cut. The
 * instrument reports its own population before any number, and a population of zero is a
 * CONTROL FAILURE (exit 5), not a measurement.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/powershell/dot-source-census.mts --out <artifact>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "powershell"
const SIZE_CAP = 512 * 1024

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const OUT = argOf("--out")

if (!OUT) {
  console.error("usage: dot-source-census.mts --out <artifact>")
  process.exit(2)
}

// ── the admitted population: per-repo git-tracked, size-capped, language-detected ──
type Admitted = { repo: string; dir: string; rel: string; abs: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ repo: e, dir, rel, abs })
  }
}

const repos = new Set(admitted.map((a) => a.repo))
console.error(`population: ${admitted.length} admitted files over ${repos.size} repos (root ${CR})`)

// A POPULATION OF ZERO IS A CONTROL FAILURE, NOT A MEASUREMENT (fleet form 1).
if (admitted.length === 0) {
  console.error("CONTROL FAILURE: the admitted population is empty — the admission rule matched nothing.")
  process.exit(5)
}

// Basename index: the arbiter matches a path target against the project's admitted list BY
// SUFFIX, and a dot-sourced relative path names a file inside the including file's repo.
const basenameToCount = new Map<string, number>()
for (const a of admitted) {
  const base = path.basename(a.rel).toLowerCase()
  basenameToCount.set(base, (basenameToCount.get(base) ?? 0) + 1)
}
const targetNamesAdmittedFile = (t: string): boolean => {
  if (!t) return false
  const base = (t.replace(/\\/g, "/").split("/").pop() ?? t).toLowerCase()
  return basenameToCount.has(base)
}

// ── the census: read PRODUCTION output ──────────────────────────────────────────
type Site = {
  edgeType: string
  op: string
  file: string
  repo: string
  line: number
  target: string
  namesAdmittedFile: boolean
  hasPartPath: boolean
  partRole: string | null
}

const sites: Site[] = []
let filesParsed = 0
let filesFailed = 0
const edgeTypeCounts = new Map<string, number>()

for (const f of admitted) {
  let result: any = null
  try {
    // `parseFile` is ASYNC and takes the project directory as its second argument
    // (`src/ast/pool-worker.ts:1211`). A synchronous call returns a Promise whose
    // `relationships` is undefined, so the census reads ZERO rows — a clean-looking
    // zero over the whole population, which is the fleet's first recorded defect.
    result = await parseFile(f.abs, f.dir)
  } catch {
    filesFailed++
    continue
  }
  if (!result) {
    filesFailed++
    continue
  }
  filesParsed++
  const rels = (result.relationships ?? []) as any[]
  for (const r of rels) {
    const type = String(r.type ?? "")
    edgeTypeCounts.set(type, (edgeTypeCounts.get(type) ?? 0) + 1)
    const meta = r.metadata ?? {}
    const op = meta.invokationOperator
    if (op === undefined || op === null) continue
    sites.push({
      edgeType: type,
      op: String(op),
      file: f.rel,
      repo: f.repo,
      line: Number(r.line_number ?? 0),
      target: String(r.target ?? ""),
      namesAdmittedFile: targetNamesAdmittedFile(String(r.target ?? "")),
      hasPartPath: meta.partPath !== undefined,
      partRole: meta.partRole !== undefined ? String(meta.partRole) : null,
    })
  }
}

// ── the split ────────────────────────────────────────────────────────────────
type OpStat = {
  n: number
  filesWithSites: number
  byEdgeType: Record<string, number>
  namesAdmitted: number
  withPartPath: number
  withPartRole: number
  samples: Site[]
}
const byOp = new Map<string, OpStat>()
for (const s of sites) {
  if (!byOp.has(s.op)) {
    byOp.set(s.op, {
      n: 0,
      filesWithSites: 0,
      byEdgeType: {},
      namesAdmitted: 0,
      withPartPath: 0,
      withPartRole: 0,
      samples: [],
    })
  }
  const st = byOp.get(s.op)!
  st.n++
  st.byEdgeType[s.edgeType] = (st.byEdgeType[s.edgeType] ?? 0) + 1
  st.namesAdmitted += s.namesAdmittedFile ? 1 : 0
  st.withPartPath += s.hasPartPath ? 1 : 0
  st.withPartRole += s.partRole !== null ? 1 : 0
  if (st.samples.length < 40) st.samples.push(s)
}
for (const [op, st] of byOp) {
  st.filesWithSites = new Set(sites.filter((s) => s.op === op).map((s) => s.file)).size
}

const report = {
  language: "powershell",
  instrument: "validation/m14/fixtures/powershell/dot-source-census.mts",
  corpusRoot: CR,
  population: {
    admitted: admitted.length,
    repos: repos.size,
    parsed: filesParsed,
    failed: filesFailed,
    samplingMethod:
      "per-repo git-tracked files, 512 KiB cap, gated on detectLanguageFromPath === powershell; WHOLE admitted set",
  },
  totals: {
    invokationOperatorSites: sites.length,
    edgesByType: Object.fromEntries([...edgeTypeCounts.entries()].sort()),
    byOperator: Object.fromEntries([...byOp.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
  },
}

writeFileSync(OUT, JSON.stringify(report, null, 2))
console.error(`dot-source census: ${sites.length} invocation-operator edges`)
for (const [op, v] of Object.entries(report.totals.byOperator)) {
  console.error(
    `  op '${op}': ${v.n} edges over ${v.filesWithSites} files; types ${JSON.stringify(v.byEdgeType)}; names-admitted ${v.namesAdmitted}; partPath ${v.withPartPath}; partRole ${v.withPartRole}`,
  )
}
console.error(`written: ${OUT}`)
