/**
 * WORKER-COUNT DETERMINISM PROBE — the census's `countsAreDeterministic` claim, tested.
 *
 * ## The claim under test
 *
 * `ontology-census.mts` writes `reproducibility.countsAreDeterministic: true`, measured
 * over four runs at the DEFAULT worker count. Four runs at one setting cannot detect a
 * dependence on that setting, and this lane's own counts did not reproduce across a
 * corpus that provably had not changed, so the claim needed an instrument that varies
 * the thing four same-setting runs hold fixed.
 *
 * MEASURED, on one fixed 600-file draw (the census's own family-stratified draw at
 * `BB_XML_SAMPLE=600`), production `parseFile`, nothing else varied:
 *
 *     workers   symbols   relationships   contains   files with contains
 *          1    126,486           15,479     15,239                  594
 *          8    126,430           15,438     15,198                  593
 *         16    126,447           15,450     15,210                  591
 *
 * So `contains` moves 41 edges (0.27 %) and the FILE COUNT moves 3, on identical input,
 * with the worker count as the only variable. At the census's full 2,500-file draw the
 * same effect is 5 edges on 77,882 — smaller, and that is the point: the error does not
 * scale with the sample, so a bigger sample does not make it go away, it only hides it.
 *
 * WHAT IS NOT AFFECTED, and this is what protects the lane's rulings: instrument A (the
 * grammar inventory — 78 distinct node types over 981,491 nodes, byte-identical at all
 * three worker counts) and instrument B (every probe's occurrence and file count,
 * identical at all three). Both rulings instruments read the PARSE TREE through a single
 * `web-tree-sitter` parser created once, after the production pass, so they are outside
 * the concurrent path entirely. The four RULED verdicts rest on those, not on the
 * production counts, and that is now measured rather than assumed.
 *
 * WHAT THIS SCRIPT ADDS over the census: the per-FILE breakdown, so the mechanism is
 * named instead of "the totals moved". `perFile` maps `repo/rel` to that file's symbol
 * and edge counts, and `--diff` compares two such artifacts.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/xml/worker-determinism-probe.mts --workers 1 --out w1.json
 *   npx tsx validation/m14/fixtures/xml/worker-determinism-probe.mts --workers 8 --out w8.json
 *   npx tsx validation/m14/fixtures/xml/worker-determinism-probe.mts --diff w1.json w8.json
 *
 * READ-ONLY. Writes nothing except the JSON passed with `--out`.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.env.BB_XML_SAMPLE ?? 600)
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
const WORKERS = Number(process.env.BB_XML_WORKERS ?? 8)
const argv = process.argv.slice(2)
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const OUT = arg("--out")
const DIFF = arg("--diff")

// ─────────────────────────────────────────────────────────────────── diff mode
if (DIFF) {
  const a = JSON.parse(readFileSync(DIFF, "utf8"))
  const bArg = argv[argv.indexOf("--diff") + 2]
  const b = JSON.parse(readFileSync(bArg, "utf8"))
  const ka = Object.keys(a.perFile)
  const kb = new Set(Object.keys(b.perFile))
  const moved: { file: string; a: string; b: string }[] = []
  let onlyInA = 0
  for (const k of ka) {
    if (!kb.has(k)) { onlyInA++; continue }
    const x = JSON.stringify(a.perFile[k])
    const y = JSON.stringify(b.perFile[k])
    if (x !== y) moved.push({ file: k, a: x, b: y })
  }
  console.log(`diff ${DIFF} (workers=${a.workers}) vs ${bArg} (workers=${b.workers})`)
  console.log(`  same draw: ${a.drawFingerprint === b.drawFingerprint ? `YES ${a.drawFingerprint}` : `NO\n    A ${a.drawFingerprint}\n    B ${b.drawFingerprint}`}`)
  console.log(`  files in A only: ${onlyInA}`)
  console.log(`  files whose counts differ: ${moved.length}`)
  for (const m of moved.slice(0, 40)) console.log(`    ${m.file}\n      A ${m.a}\n      B ${m.b}`)
  if (moved.length > 40) console.log(`    … ${moved.length - 40} more`)
  console.log(`  totals A symbols=${a.totalSymbols} B symbols=${b.totalSymbols} delta=${b.totalSymbols - a.totalSymbols}`)
  process.exit(0)
}

// ────────────────────────────────────────────────────── corpus + draw (as census)
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, FileRow[]>()
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  const rows: FileRow[] = []
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: e, dir, rel, abs })
  }
  if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
}
const REPO_FILTER = process.env.BB_XML_REPOS ? new Set(process.env.BB_XML_REPOS.split(",")) : undefined

const sample: FileRow[] = []
{
  const queues = new Map([...byRepo].map(([k, v]) => [k, [...v]]))
  let progress = true
  while (progress && sample.length < SAMPLE) {
    progress = false
    for (const [repo, rows] of queues) {
      if (REPO_FILTER && !REPO_FILTER.has(repo)) continue
      if (rows.length === 0 || sample.length >= SAMPLE) continue
      if (sample.filter((f) => f.repo === repo).length >= PER_REPO) continue
      sample.push(rows.shift()!)
      progress = true
    }
  }
}
sample.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))

/**
 * A fingerprint of the DRAW, so "the totals moved" can be separated from "the draw moved".
 *
 * Two runs over different bytes with the same worker count produce different totals for
 * the same reason two runs at different worker counts do, and the census cannot tell those
 * apart — which is exactly how a stale artifact came to be published as current.
 */
const drawFingerprint = (() => {
  const h = createHash("sha256")
  for (const f of sample) {
    let size = -1
    try { size = statSync(f.abs).size } catch {}
    h.update(`${f.repo}/${f.rel} ${size}\n`)
  }
  return h.digest("hex").slice(0, 16)
})()

console.log(`worker determinism probe — xml`)
console.log(`  workers ${WORKERS} · sample ${sample.length} files across ${byRepo.size} repositories · draw ${drawFingerprint}`)

const perFile: Record<string, { symbols: number; relationships: number; contains: number; fallback?: boolean; errors: number }> = {}
let cursor = 0
async function worker(): Promise<void> {
  while (true) {
    const i = cursor++
    if (i >= sample.length) return
    const f = sample[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const rels: any[] = r.relationships ?? []
    let contains = 0
    for (const x of rels) if (String(x.type ?? "").toLowerCase() === "contains") contains++
    perFile[`${f.repo}/${f.rel}`] = {
      symbols: (r.symbols ?? []).length,
      relationships: rels.length,
      contains,
      fallback: r.fallback === true,
      errors: (r.errors ?? []).length,
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

const files = Object.keys(perFile).sort()
let totalSymbols = 0
let totalRels = 0
let totalContains = 0
let fallbackFiles = 0
for (const k of files) {
  totalSymbols += perFile[k].symbols
  totalRels += perFile[k].relationships
  totalContains += perFile[k].contains
  if (perFile[k].fallback) fallbackFiles++
}
const out = {
  generatedBy: "validation/m14/fixtures/xml/worker-determinism-probe.mts",
  corpusRoot: CR,
  workers: WORKERS,
  sampleSize: sample.length,
  repositories: byRepo.size,
  perRepoCap: PER_REPO,
  drawFingerprint,
  filesParsed: files.length,
  totalSymbols,
  totalRelationships: totalRels,
  contains: totalContains,
  fallbackFiles,
  perFile,
}
console.log(`  parsed ${files.length} failed ${sample.length - files.length} fallback ${fallbackFiles}`)
console.log(`  symbols ${totalSymbols}  relationships ${totalRels}  contains ${totalContains}`)
if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(`  wrote ${OUT}`)
}