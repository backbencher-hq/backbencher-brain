/**
 * PER-REPO CORPUS COMPOSITION, under the ARBITER'S OWN admission rule.
 *
 * WHY THIS EXISTS. Pass 3 wrote "1,955 of 1,955 admitted SQL files in 169 corpus
 * repositories" on this page. The arbiter prints, from its own walk,
 *
 *     admitted: 1955 SQL files in 16 repositories
 *
 * so 169 was wrong and nobody could tell from which of the two numbers it was wrong.
 * A per-type census answers "how many files" and never answers "out of what
 * population", which is why the error survived four passes: nothing on the page
 * carried the denominator the claim needed.
 *
 * It does now, and this script is what produces it. The admission rule is COPIED
 * from `script/m14/ontology-coverage-gate.ts:203-208` — `git ls-files`, ≤ 512 KB,
 * `detectLanguageFromPath(abs, text) === "sql"` — because the corpus a ruling is
 * measured over is the corpus the ARBITER admits, and a second rule would make the
 * two populations differ by an unknown amount. `script/m14/` is supervisor-owned,
 * so the rule is copied here rather than imported; the line numbers above are what
 * to re-check when the arbiter changes.
 *
 * `git ls-files '*.sql'` is deliberately NOT the instrument: it counts 1,963
 * tracked SQL paths against the arbiter's 1,955 admitted, and the 8-file difference
 * is the size cap and the language detection, which is the whole point of measuring.
 *
 * Run: npx tsx validation/m14/fixtures/sql/corpus-composition.mts
 * Writes: measurements/pass6-corpus-composition.json
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"

const LANG = "sql"
const SIZE_CAP = 512 * 1024
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "measurements",
  "pass6-corpus-composition.json"
)

interface RepoRow {
  repo: string
  trackedSqlPaths: number
  admitted: number
  overSizeCap: number
  notDetectedAsSql: number
}

const rows: RepoRow[] = []
let reposWalked = 0
let trackedSqlTotal = 0
let admittedTotal = 0

for (const entry of readdirSync(CORPUS_ROOT, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  // `statSync`, NOT `entry.isDirectory()`: the corpus root holds at least one repo
  // reached through a SYMLINK, and `withFileTypes` reports a symlink as
  // isSymbolicLink(), so an isDirectory() test drops the whole repo. The first run
  // of this script lost `proxicall`'s 438 files that way and reported 1,517 — which
  // is the whole 1,955 − 438, so the miss was visible in the total and not only in
  // the per-repo rows.
  const dir = path.join(CORPUS_ROOT, entry.name)
  let isDir = false
  try {
    isDir = statSync(dir).isDirectory()
  } catch {
    continue
  }
  if (!isDir) continue
  reposWalked++
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
  const sqlPaths = tracked.filter((p) => p.toLowerCase().endsWith(".sql"))
  if (sqlPaths.length === 0) continue

  const row: RepoRow = {
    repo: entry.name,
    trackedSqlPaths: sqlPaths.length,
    admitted: 0,
    overSizeCap: 0,
    notDetectedAsSql: 0,
  }
  for (const rel of sqlPaths) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > SIZE_CAP) {
        row.overSizeCap++
        continue
      }
      text = readFileSync(abs, "utf8")
    } catch {
      row.overSizeCap++
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) {
      row.notDetectedAsSql++
      continue
    }
    row.admitted++
  }
  trackedSqlTotal += row.trackedSqlPaths
  admittedTotal += row.admitted
  rows.push(row)
}

rows.sort((a, b) => b.admitted - a.admitted || a.repo.localeCompare(b.repo))
const contributors = rows.filter((r) => r.admitted > 0)

const report = {
  instrument: "validation/m14/fixtures/sql/corpus-composition.mts",
  admissionRule:
    "copied from script/m14/ontology-coverage-gate.ts:203-208 — `git ls-files`, size <= 512 KiB, detectLanguageFromPath(abs, text) === \"sql\"",
  corpusRoot: CORPUS_ROOT,
  reposWalked,
  reposWithTrackedSqlPaths: rows.length,
  reposContributingAnAdmittedFile: contributors.length,
  trackedSqlPathsTotal: trackedSqlTotal,
  admittedFilesTotal: admittedTotal,
  excludedTotal: trackedSqlTotal - admittedTotal,
  arbiterReportedAdmitted: 1955,
  agreesWithArbiter: admittedTotal === 1955,
  repos: rows,
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`)

console.log(`repos walked:                 ${reposWalked}`)
console.log(`repos with tracked .sql:      ${rows.length}`)
console.log(`repos contributing >=1 file:  ${contributors.length}`)
console.log(`tracked .sql paths:           ${trackedSqlTotal}`)
console.log(`admitted (arbiter's rule):    ${admittedTotal}`)
console.log(`excluded:                     ${trackedSqlTotal - admittedTotal}`)
console.log(`agrees with arbiter's 1955:   ${report.agreesWithArbiter}`)
console.log("")
for (const r of rows) {
  console.log(
    `${String(r.admitted).padStart(5)} admitted  ${String(r.trackedSqlPaths).padStart(5)} tracked  ` +
      `${String(r.overSizeCap).padStart(3)} oversize  ${String(r.notDetectedAsSql).padStart(3)} not-sql  ${r.repo}`
  )
}
console.log(`\nwritten: ${path.relative(process.cwd(), OUT)}`)
