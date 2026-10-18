/**
 * TS WHOLE-POPULATION EMISSION CENSUS — the D2 instrument.
 *
 * ## The question
 *
 * The DONE bar's D2 clause: "for each applicable type, a whole-population count (rows + files + repos)
 * from the census instrument, OR a RULED verdict carrying a counted measurement proving the construct
 * does not occur. A cap-50 stride is triage, never this number." The fleet gate's `cap 0` arm gives rows
 * per type over the whole admitted population, but it does not say how many FILES and REPOS carry each
 * type — and a row count whose file spread nobody measured is half a fact.
 *
 * This instrument walks the lane's whole admitted file set, parses each file with the SAME production
 * entry the gate uses (`parseFile`, no project index — the per-file population production analyses),
 * and counts for every relationship type: rows, distinct FILES, distinct REPOS. It also reports the
 * population it walked (tracked files, admitted, over-cap, absent, parse failures) and prints
 * arbitraryTwin-adjacent facts it CANNOT measure (it is not the arbiter; resolution is the gate's).
 *
 * ## What it does NOT do
 *
 * It does not resolve, does not claim, does not classify. A row counted here may be unresolved; that is
 * the gate's question. It does not decide whether a type is APPLICABLE — that is the spec-table's
 * (§1 of TYPESCRIPT-APPLICABLE-SET.md); this instrument measures what the analyzer EMITS over the
 * population, which is the other half of the same evidence row.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/ts-whole-pop-census.ts [--json out.json] [--repo name]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const SIZE_CAP = 1024 * 1024
const argv = process.argv.slice(2)
const argOf = (flag: string): string | null => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`))
  if (eq !== undefined) return eq.slice(flag.length + 1)
  const i = argv.indexOf(flag)
  return i >= 0 ? (argv[i + 1] ?? null) : null
}
const jsonOut = argOf("--json")
const onlyRepo = argOf("--repo")

// The lane's admitted extensions (charter §4: typescript `ts,tsx`; `.mts`/`.cts` route to the same
// language and are part of the population the router admits).
const ADMIT = new Set(["ts", "tsx", "mts", "cts"])

type Population = { files: string[]; tracked: number; overCap: number; absent: number; repos: number }
function discover(): Population {
  const files: string[] = []
  const repos = new Set<string>()
  let trackedTotal = 0
  let overCap = 0
  let absent = 0
  for (const name of fs.readdirSync(CR).sort()) {
    if (onlyRepo !== null && name !== onlyRepo) continue
    const dir = path.join(CR, name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    trackedTotal += tracked.length
    for (const rel of tracked) {
      const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase()
      if (!ADMIT.has(ext)) continue
      if (detectLanguageFromPath(rel) !== "typescript") continue
      const abs = path.join(dir, rel)
      try {
        if (fs.statSync(abs).size > SIZE_CAP) {
          overCap++
          continue
        }
      } catch {
        absent++
        continue
      }
      files.push(abs)
      repos.add(name)
    }
  }
  files.sort()
  return { files, tracked: trackedTotal, overCap, absent, repos: repos.size }
}

const pop = discover()
console.log(`TS WHOLE-POPULATION EMISSION CENSUS — D2 instrument`)
console.log(
  `population: ${pop.files.length} admitted .ts/.tsx/.mts/.cts file(s) across ${pop.repos} repo(s)` +
    `${onlyRepo ? ` (REPO-FILTERED to ${onlyRepo} — NOT the corpus)` : " (whole admitted corpus)"}` +
    ` · of ${pop.tracked} tracked path(s) · over size cap ${pop.overCap} · absent ${pop.absent}`,
)
if (pop.files.length === 0) {
  console.error("no files admitted — refusing to print an empty census")
  process.exit(2)
}

type Tally = { rows: number; files: Set<string>; repos: Set<string>; samples: string[] }
const tallies = new Map<string, Tally>()
let parsed = 0
let parseFailures = 0
let emptyResults = 0
const relOf = (f: string) => (f.startsWith(CR) ? f.slice(CR.length + 1) : f)
const started = Date.now()

for (const file of pop.files) {
  const rel = relOf(file)
  const repoSeg = rel.split(path.sep)[0] ?? ""
  let r: any
  try {
    r = await parseFile(file, path.join(CR, repoSeg))
  } catch {
    parseFailures++
    continue
  }
  parsed++
  const rels: any[] = Array.isArray(r?.relationships) ? r.relationships : []
  if (rels.length === 0) emptyResults++
  for (const edge of rels) {
    const label = String(edge?.type ?? edge?.relationshipType ?? "")
    if (!label) continue
    let t = tallies.get(label)
    if (!t) tallies.set(label, (t = { rows: 0, files: new Set(), repos: new Set(), samples: [] }))
    t.rows++
    t.files.add(rel)
    t.repos.add(repoSeg)
    if (t.samples.length < 2) t.samples.push(`${String(edge?.source ?? "?")} -> ${String(edge?.target ?? "?").replace(/\u0000/g, "\\0")} @ ${rel}`)
  }
  if (parsed % 500 === 0) process.stderr.write(`  parsed ${parsed}/${pop.files.length} (${Math.round((Date.now() - started) / 1000)}s)\n`)
}

const wall = Math.round((Date.now() - started) / 1000)
const rowsOut: Record<string, any> = {}
console.log(`\nparsed ${parsed} of ${pop.files.length} file(s) · parse failures ${parseFailures} · empty results ${emptyResults} · wall ${wall}s`)
console.log(`INTERPRETATION NOTES, stated so the table is not over-read:`)
console.log(`  · rows = emitted relationship rows over the WHOLE admitted population (D2's number).`)
console.log(`  · files = distinct emitting files; repos = distinct repositories. A construct present in 2 of 40 repos is not a language-wide surface.`)
console.log(`  · this is EMISSION, not RESOLUTION: whether a row resolves/claims is the arbiter's question, never this instrument's.`)
console.log(`  · empty results and parse failures are counted; an empty result over a non-empty corpus is NOT read as a clean zero.`)
console.log("")
console.log(`${"type".padEnd(14)} ${"rows".padStart(9)} ${"files".padStart(7)} ${"repos".padStart(6)}`)
const ordered = [...tallies.entries()].sort((a, b) => b[1].rows - a[1].rows)
for (const [label, t] of ordered) {
  console.log(`${label.padEnd(14)} ${String(t.rows).padStart(9)} ${String(t.files.size).padStart(7)} ${String(t.repos.size).padStart(6)}`)
  rowsOut[label] = { rows: t.rows, files: t.files.size, repos: t.repos.size, samples: t.samples }
}
const total = ordered.reduce((n, [, t]) => n + t.rows, 0)
console.log(`${"TOTAL".padEnd(14)} ${String(total).padStart(9)}`)
if (jsonOut) {
  fs.writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        population: { files: pop.files.length, parsed, repos: pop.repos, tracked: pop.tracked, overCap: pop.overCap, absent: pop.absent, parseFailures, emptyResults, wallSeconds: wall, repoFilter: onlyRepo },
        types: rowsOut,
        total,
      },
      null,
      2,
    ),
  )
}
