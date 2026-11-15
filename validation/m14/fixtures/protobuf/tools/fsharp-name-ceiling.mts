/**
 * FSHARP'S NAME CLAIM — THE CEILING, MEASURED BEFORE ANYTHING IS BUILT.
 *
 * The residue on this lane is `open System.IO`-shaped names: 6,728 of 7,103 (94.7%). A file claim
 * reaches at most 1.7% of its imports, so the route that fits is a NAME route — reach an existing
 * DECLARATION by key, exactly as the protobuf `INDEX_SPEC` route reaches a type by key rather than by
 * file. **Before building it: of the 6,728, how many name something the PROJECT actually publishes?**
 *
 * Two key spaces are measured, because they answer different halves:
 *   INDEX   what `FSHARP_DECLARATION_SPEC` extracts (`symbolNames` / `typeKinds`) — the instrument the
 *           analyzer would consult to decide, and the one this lane already made live for protobuf;
 *   PROJECT what the analyzers PUBLISH for this repository (symbol name or qualifiedName) — the key
 *           space the incoming gate resolves against, which is what an edge's resolution depends on.
 *
 *   npx tsx validation/m14/fixtures/protobuf/tools/fsharp-name-ceiling.mts --files=40 --repos=8
 *
 * LABEL: a REPO-BOUNDED stride sample, because two unbounded runs hit their 15- and 20-minute bounds and
 * were KILLED with no output. The rate is the answer the question needs; the repo count travels with it.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(new URL("../../../../../", import.meta.url).pathname)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const SAMPLE = Number((process.argv.find((a) => a.startsWith("--files=")) ?? "--files=60").split("=")[1])
// REPO-BOUNDED, because this lane is slow and the RATE is the question: two 20-minute runs hit their
// bound and were KILLED with no output, which is a cost measurement and not a result. The count of
// repos actually measured is printed with the answer.
const MAX_REPOS = Number((process.argv.find((a) => a.startsWith("--repos=")) ?? "--repos=8").split("=")[1])
let reposSeen = 0
const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const mod: any = await import(path.join(ROOT, "src/ast/project-index.ts"))
const wasm = path.join(ROOT, "wasm", "tree-sitter-fsharp.wasm")
const EXTS = new Set(["fs", "fsi", "fsx"])

const isName = (t: string): boolean => {
  if (t.includes("://") || t.includes("/") || t.includes(" ") || t.includes("\\")) return false
  return true // a dotted or plain identifier: `System.IO`, `FsUnit`, `FSharp.Core`
}

let files = 0, population = 0, nameEdges = 0
const allSampled: string[] = []
/** Every name-shaped target, collected so the INDEX comparison can run after ONE index build. */
const nameTargets: { t: string; rel: string }[] = []
let indexNames: Set<string> = new Set<string>()
let inIndex = 0, inProject = 0, inEither = 0, external = 0
const projectPublished = new Set<string>()
const prefixTop = new Map<string, number>()
const indexExamples: string[] = []
const projectExamples: string[] = []
const externalTop = new Map<string, number>()

for (const name of readdirSync(CR).sort()) {
  const repo = path.join(CR, name)
  try { if (!statSync(repo).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", repo, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", repo, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const wanted: string[] = []
  for (const rel of tracked) {
    if (!EXTS.has(rel.slice(rel.lastIndexOf(".") + 1).toLowerCase())) continue
    const abs = path.join(repo, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    wanted.push(abs)
  }
  if (wanted.length === 0) continue
  if (reposSeen >= MAX_REPOS) continue
  reposSeen++
  population += wanted.length
  wanted.sort()
  let pick = wanted
  if (SAMPLE > 0 && pick.length > SAMPLE) {
    const stride = pick.length / SAMPLE
    const sel: string[] = []
    for (let i = 0; i < SAMPLE; i++) sel.push(pick[Math.floor(i * stride)])
    pick = [...new Set(sel)].sort()
  }
  // INDEX — what the spec extracts for this repository.
  // THE PER-REPO INDEX BUILD IS DELETED, AND THE REASON IS A MEASUREMENT: `buildProjectIndexFromDisk`
  // calls `Parser.init()` and loads the wasm on EVERY call, so one build per repo cost ~2 minutes per
  // repo — a 20-minute run reached 5 of 40+ repositories and was KILLED with no output. The INDEX key
  // space is measured ONCE over the whole sample after the loop instead (below), which is the same
  // question at one wasm load.
  // PROJECT — what the analyzers publish, the key space the gate resolves against.
  const published = new Set<string>()
  const parsed: { rel: string; rels: any[] }[] = []
  for (const abs of pick) {
    const rel = path.relative(repo, abs).split(path.sep).join("/")
    let res: any
    try { res = await parseFile(abs, repo, { projectRoot: repo } as any) } catch { continue }
    parsed.push({ rel, rels: res.relationships ?? [] })
    files++
    allSampled.push(abs)
    for (const s of res.symbols ?? []) {
      const n = String(s.name ?? "")
      if (n.length > 0) { published.add(n); projectPublished.add(n) }
      const q = String(s.qualifiedName ?? "")
      if (q.length > 0) { published.add(q); projectPublished.add(q) }
    }
  }
  for (const { rel, rels } of parsed) {
    for (const r of rels) {
      if (String(r.type) !== "imports") continue
      const t = String(r.target ?? "").trim()
      if (!isName(t)) continue
      nameEdges++
      const head = t.includes(".") ? t.slice(0, t.indexOf(".")) : t
      nameTargets.push({ t, rel })
      const hitProject = published.has(t)
      if (hitProject) { inProject++; if (projectExamples.length < 5) projectExamples.push(`${t}   (${rel})`) }
      if (false) { /* index comparison runs after the single build, below */ }
      else {
        external++
        const m = externalTop.get(head) ?? 0
        externalTop.set(head, m + 1)
      }
      prefixTop.set(head, (prefixTop.get(head) ?? 0) + 1)
    }
  }
}
// ONE INDEX, ONE WASM LOAD, over the whole sample — the same question without the per-repo cost.
try {
  const built = await mod.buildProjectIndexFromDisk(wasm, allSampled.slice(0, 600), mod.FSHARP_DECLARATION_SPEC)
  indexNames = new Set<string>(built.symbolNames as Set<string>)
  for (const k of built.typeKinds.keys()) indexNames.add(k)
  process.stderr.write(`[progress] single index over ${Math.min(600, allSampled.length)} files -> ${indexNames.size} names\n`)
} catch (e: any) { process.stderr.write(`[progress] index FAILED: ${e?.message ?? e}\n`) }
// THE INDEX HALF OF THE SPLIT, and the repartition that makes it a CEILING.
const projectHit = new Set<string>()
for (const { t, rel } of nameTargets) {
  if (indexNames.has(t)) { inIndex++; if (indexExamples.length < 5) indexExamples.push(`${t}   (${rel})`) }
}
for (const { t } of nameTargets) if (indexNames.has(t)) projectHit.add(t)
// `inEither` and `external` were counted as PROJECT-only during the loop (the index did not exist yet),
// so recompute them from the union here rather than reporting a ceiling that is really a half.
inEither = 0
for (const { t } of nameTargets) if (indexNames.has(t) || projectHit.has(t) || projectPublished.has(t)) inEither++
external = nameEdges - inEither

const pct = (n: number) => nameEdges > 0 ? `${((100 * n) / nameEdges).toFixed(1)}%` : "-"
console.log(`fsharp NAME claim ceiling — ${reposSeen} repos, ${files}/${population} files sampled, ${nameEdges} name-shaped imports`)
console.log(`  carried by the INDEX (FSHARP_DECLARATION_SPEC)      ${inIndex} (${pct(inIndex)})`)
console.log(`  carried by the PROJECT's published key space        ${inProject} (${pct(inProject)})`)
console.log(`  carried by EITHER  <- THE CEILING                   ${inEither} (${pct(inEither)})`)
console.log(`  EXTERNAL (in neither)                               ${external} (${pct(external)})`)
console.log(`\ntop name prefixes overall:`)
console.log("  " + [...prefixTop].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}×${v}`).join("  "))
console.log(`\ntop EXTERNAL prefixes:`)
console.log("  " + [...externalTop].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}×${v}`).join("  "))
console.log(`\ncarried-by-index examples:`)
for (const e of indexExamples) console.log(`  ${e}`)
console.log(`carried-by-project examples:`)
for (const e of projectExamples) console.log(`  ${e}`)
