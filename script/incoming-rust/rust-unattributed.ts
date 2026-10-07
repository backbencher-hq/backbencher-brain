/**
 * REACHABILITY OF THE R7 OMISSION BRANCHES — which of them FIRE, measured.
 *
 * ## Why this instrument exists
 *
 * Two R7 mutants SURVIVED the fixture suite, and the contract's answer to a
 * survivor is that the suite fails rather than the mutant passing quietly. But
 * "the fixture does not pin it" and "the branch cannot fire" are different
 * findings and only one of them is a fixture gap, so the distinction has to be
 * MEASURED rather than argued. The two survivors were the `call_expression` and
 * `uses`-identifier guards; the counter they increment is published as
 * `metadata.unattributedEdges`, and this walks the corpus reading it.
 *
 * ## What it reports
 *
 * Per SITE — `calls:call_expression` vs `calls:macro_invocation`,
 * `uses:field_expression` vs `uses:identifier_read` — the number of files in
 * which the branch fired, the number of refusals, and up to three sites. A site
 * with 0 files is a site the corpus cannot reach, which is a DIFFERENT verdict
 * from "a site the fixtures do not cover".
 *
 * ## The population
 *
 * Derived, never hand-written: every path `git ls-files` reports for each corpus
 * repository whose detected language is rust. Run with `--repo=<name>` to narrow.
 *
 * ## NO REGULAR EXPRESSION
 *
 * String comparison, `split` on a delimiter and `Map` lookups only.
 *
 * READ-ONLY. Writes nothing.
 *
 * Run: npx tsx script/incoming-rust/rust-unattributed.ts [--repo=ripgrep] [--json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ARGS = process.argv.slice(2)
const WANT_JSON = ARGS.includes("--json")
const REPO_FILTER = ARGS.find((a) => a.startsWith("--repo="))?.slice(7)

interface Site { refusals: number; files: number; examples: string[] }
const sites = new Map<string, Site>()
let filesWithAny = 0
let filesWithNone = 0
let edgesTotal = 0
let filesTotal = 0
const failures: string[] = []

const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  if (REPO_FILTER && e !== REPO_FILTER) continue
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
    try { if (statSync(abs).size > 2 * 1024 * 1024) continue } catch { continue }
    if (detectLanguageFromPath(abs, "") !== "rust") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
filesTotal = files.length

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { failures.push(`${f.repo}/${f.rel}`); continue }
    edgesTotal += (r.relationships ?? []).length
    const md = (r.metadata ?? {}) as Record<string, unknown>
    const u = md.unattributedEdges
    if (!u || typeof u !== "object") { filesWithNone++; continue }
    filesWithAny++
    const obj = u as Record<string, number>
    for (const k of Object.keys(obj).sort()) {
      const n = obj[k]
      if (typeof n !== "number") continue
      let s = sites.get(k)
      if (!s) { s = { refusals: 0, files: 0, examples: [] }; sites.set(k, s) }
      s.refusals += n
      s.files++
      if (s.examples.length < 3) s.examples.push(`${f.repo}/${f.rel} (${n})`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))

const report = {
  population: { root: CR, repos: [...new Set(files.map((f) => f.repo))], files: filesTotal },
  edgesTotal,
  filesWithAtLeastOneRefusal: filesWithAny,
  filesWithNone: filesWithNone,
  parseFailures: failures,
  sites: Object.fromEntries([...sites.entries()].map(([k, v]) => [k, v])),
}

if (WANT_JSON) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log(`unattributed-edge reachability — ${filesTotal} files in [${report.population.repos.join(", ")}]`)
  console.log(`  ${edgesTotal} edges · ${filesWithAny} files refused >=1 edge · ${filesWithNone} files refused none · parse failures ${failures.length}\n`)
  console.log(`${"site (emission path)".padEnd(34)}${"refusals".padStart(10)}${"files".padStart(8)}`)
  console.log("-".repeat(52))
  for (const [k, v] of [...sites.entries()].sort((a, b) => b[1].refusals - a[1].refusals)) {
    console.log(`${k.padEnd(34)}${String(v.refusals).padStart(10)}${String(v.files).padStart(8)}`)
    for (const ex of v.examples) console.log(`${" ".repeat(34)}  ${ex}`)
  }
  console.log(`\nSites absent from this table fired 0 times over the population above. That is a`)
  console.log(`reachability measurement, not a coverage claim: a branch the corpus cannot reach`)
  console.log(`is DEAD for this corpus, and a fixture cannot pin what no input produces.`)
}
