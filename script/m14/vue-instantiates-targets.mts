/**
 * VUE — WHY an `instantiates` target does not resolve, ranked.
 *
 * The six-questions run reports `instantiates` at 12.4% corpus-wide resolution
 * and 59.7% under Vue's own casing rule. A single percentage cannot tell a
 * defect from a corpus artefact, and here the two are entangled: a template
 * writes `<el-button>` and the registry holds `ElButton` (an analyzer-side
 * casing gap, fixable in this lane), and a template writes `<MyLibWidget>`
 * which no admitted file declares (an EXTERNAL component, nothing to fix).
 * Conflating them would produce either a fabricated symbol or a false ruling.
 *
 * So this file ranks the unresolvable targets and, for each, decides which of
 * the three possible causes it is by asking the corpus:
 *
 *   CASING      the Vue-normalised candidate exists in the corpus but the
 *               as-written target does not. The graph cannot walk it and Vue
 *               resolves it. The analyzer owns this.
 *   ABSENT      no admitted file declares the component under any spelling, AND
 *               the repo's own tracked-file list has no `.vue` whose stem could
 *               be it — i.e. it is external (a third-party or an example-only
 *               component the repo does not ship). The analyzer owns nothing.
 *   SPARSE      the repo's tracked-file list DOES contain a matching `.vue` stem
 *               that this run did not admit (sparse checkout, or the file was
 *               skipped by the language detector). The measurement, not the
 *               analyzer, is short of it — and reporting that as an analyzer
 *               defect would be exactly the "absence without a measurement is a
 *               defect" mistake pointed the other way.
 *
 * The repo stem index is built from `git ls-files`, NOT from the filesystem, so a
 * sparse checkout cannot hide a component the repo ships.
 *
 * CLI: npx tsx script/m14/vue-instantiates-targets.mts --repo vuejs --dir <a,b,c> [--top N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt
}
const REPOS = (argOf("--repo", "vuejs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const EXTRA = (argOf("--dir", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const TOP = parseInt(argOf("--top", "40") ?? "40")
const MAX_BYTES = 512 * 1024

type Repo = { dir: string; name: string }
const repos: Repo[] = []
for (const e of REPOS) repos.push({ dir: path.join(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories", e), name: e })
for (const d of EXTRA) repos.push({ dir: d, name: path.basename(d) })

/** Every `.vue` stem each repo TRACKS, plus the stem's PascalCase/camel form. */
const trackedStems = new Map<string, Set<string>>()
for (const r of repos) {
  const set = new Set<string>()
  try {
    const tracked = execFileSync("git", ["-C", r.dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    for (const rel of tracked) {
      if (!rel.endsWith(".vue")) continue
      const stem = path.basename(rel, ".vue")
      set.add(stem)
      set.add(stem.split("-").filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(""))
    }
  } catch { }
  trackedStems.set(r.name, set)
  console.log(`${r.name}: ${set.size} tracked .vue stems`)
}

const files: Array<{ repo: string; dir: string; rel: string; abs: string; text: string }> = []
const seen = new Set<string>()
for (const r of repos) {
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", r.dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(r.dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    if (seen.has(abs)) continue
    seen.add(abs)
    files.push({ repo: r.name, dir: r.dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
console.log(`\nadmitted ${files.length} .vue files`)

const corpusNames = new Set<string>()
const corpusComps = new Set<string>()
type Use = { tag: string; file: string }
const uses: Use[] = []
{
  let i = 0
  const work = async (): Promise<void> => {
    while (true) {
      const k = i++
      if (k >= files.length) return
      const f = files[k]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { return }
      for (const s of r?.symbols ?? []) {
        const n = String(s?.name ?? "")
        if (!n) continue
        corpusNames.add(n)
        if (String(s?.kind ?? "").toLowerCase() === "class") corpusComps.add(n)
      }
      for (const x of r?.relationships ?? []) {
        const t = String(x.type ?? x.relationshipType ?? "")
        if (t !== "instantiates") continue
        if ((x.metadata ?? {}).isComponentUsage !== true) continue
        uses.push({ tag: String(x.target ?? ""), file: `${f.repo}/${f.rel}` })
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => work()))
}
console.log(`instantiates component-usage edges: ${uses.length}`)

const candidates = (tag: string): string[] => {
  const out = [tag]
  if (!tag.includes("-")) return out
  const pascal = tag.split("-").filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("")
  out.push(pascal)
  out.push(pascal.charAt(0).toLowerCase() + pascal.slice(1))
  return out
}

type Row = { tag: string; n: number; cause: "RESOLVED" | "CASING" | "SPARSE" | "ABSENT"; example: string }
const rows = new Map<string, Row>()
for (const u of uses) {
  if (!u.tag) continue
  const cands = candidates(u.tag)
  let cause: Row["cause"]
  if (cands.some((c) => corpusComps.has(c) || corpusNames.has(c))) cause = "RESOLVED"
  else if (cands.some((c) => c !== u.tag && corpusComps.has(c))) cause = "CASING"
  else {
    // Not admitted anywhere. Ask each repo whether it TRACKS a .vue whose stem
    // matches any candidate: if yes, this run's draw is short of it (SPARSE),
    // and calling that an analyzer defect would be a measurement error.
    let sparse = false
    for (const r of repos) {
      const stems = trackedStems.get(r.name)
      if (stems && cands.some((c) => stems.has(c))) { sparse = true; break }
    }
    cause = sparse ? "SPARSE" : "ABSENT"
  }
  const key = `${cause}|${u.tag}`
  let row = rows.get(key)
  if (!row) { row = { tag: u.tag, n: 0, cause, example: u.file }; rows.set(key, row) }
  row.n++
}
const list = [...rows.values()].sort((a, b) => b.n - a.n)
const byCause = new Map<string, number>()
for (const r of list) byCause.set(r.cause, (byCause.get(r.cause) ?? 0) + r.n)
console.log("\n" + "=".repeat(100))
console.log("`instantiates` target resolution, classified")
console.log("=".repeat(100))
const total = [...byCause.values()].reduce((a, b) => a + b, 0)
for (const c of ["RESOLVED", "CASING", "SPARSE", "ABSENT"]) {
  const n = byCause.get(c) ?? 0
  console.log(`  ${c.padEnd(9)} ${String(n).padStart(6)}  ${total ? ((n / total) * 100).toFixed(1) : "0.0"}%`)
}
console.log(`  ${"TOTAL".padEnd(9)} ${String(total).padStart(6)}`)
console.log(`\ntop ${TOP} UNRESOLVED targets by cause:`)
let shown = 0
for (const r of list) {
  if (r.cause === "RESOLVED") continue
  if (shown++ >= TOP) break
  console.log(`  ${String(r.n).padStart(5)}  ${r.cause.padEnd(8)} ${r.tag.padEnd(34)} e.g. ${r.example}`)
}
