/**
 * BASH — DOES EVERY `exports` EDGE'S TARGET SURVIVE THE WORKER WITH `isExported`?
 *
 * ## The measurement that prompted this
 *
 * `census-bash-ontology.ts` reports metadata survival per FILE, and on its 105-file
 * sub-sample the four keys the worker now forwards read:
 *
 *     isArray            published in 72 files, survives in 72 (100.0%)
 *     isImplicitBinding  published in 25 files, survives in 25 (100.0%)
 *     bindingSite        published in 25 files, survives in 25 (100.0%)
 *     isExported         published in 15 files, survives in 13 ( 86.7%)   <- 2 short
 *
 * `isExported` is the one that matters here, because it is the ONLY evidence that an
 * `exports` edge is correctly labelled. The `exports` row of the six-questions table
 * says "210 of 210 targets carry `isExported`" — and that number is measured on the
 * `analyze()` path. If the key is dropped on the way through `parseFile`, the label is
 * verifiable where the analyzer runs and unverifiable where the product runs, and a
 * per-FILE survival rate is too coarse to say whether the loss is a whole file or a
 * single symbol in it.
 *
 * So this probe goes to the symbol, not the file, and only over the files that carry an
 * `exports` edge at all — the population is small (1,929 `exports` edges on the whole
 * corpus) and a per-symbol answer is what the claim needs.
 *
 * ## What it measures
 *
 * For every admitted file with >=1 `exports` edge, through BOTH paths:
 *
 *   analyze()   the analyzer's own return value — what it publishes
 *   parseFile() production — what reaches the store
 *
 * and then, per (file, symbol name, kind): does `isExported` appear in one and not the
 * other? Three outcomes, and the third is the one that is a defect:
 *
 *   both       correct
 *   neither    the name is not an exported symbol in either path — not this class
 *   ANALYZE ONLY   published, dropped by the worker  -> the `exports` label is
 *                          unverifiable downstream for that symbol
 *
 * ## NO REGEX
 *
 * Zero pattern matching: keys are read off objects and paths are compared as strings.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-exported-symbol-survival.mts [--sample N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const sampleArg = argv.indexOf("--sample")
const SAMPLE = sampleArg >= 0 ? Number(argv[sampleArg + 1]) : Number.POSITIVE_INFINITY

type Admitted = { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
}

const { ASTEngine } = await import("../../../../src/ast/engine")
const { RealBashAnalyzer } = await import("../../../../src/ast/real-bash-analyzer")
const analyzer = new RealBashAnalyzer()
const bashParser = await ASTEngine.getParser("bash")

let idx = 0
let filesWithExports = 0
let exportsEdges = 0
let both = 0
let neither = 0
let analyzeOnly = 0
const dropped: string[] = []
const exportedSymbols: { label: string; name: string; kind: string }[] = []

async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    if (SAMPLE !== Number.POSITIVE_INFINITY && filesWithExports >= SAMPLE) return
    const f = admitted[i]
    let p: any
    try { p = await parseFile(f.abs, f.dir) } catch { continue }
    if (!p || p.success === false) continue
    const expTargets = new Set<string>()
    let edges = 0
    for (const x of p.relationships ?? []) {
      if (String(x?.type ?? "").toLowerCase() !== "exports") continue
      edges++
      expTargets.add(String(x?.target ?? ""))
    }
    if (edges === 0) continue
    filesWithExports++
    exportsEdges += edges

    let a: any
    try {
      const tree = bashParser!.parse(f.text)
      if (!tree) continue
      a = analyzer.analyze(tree.rootNode, f.text, f.abs)
      tree.delete?.()
    } catch { continue }

    const key = (s: any) => `${String(s?.name ?? "")}\u0000${String(s?.kind ?? "").toLowerCase()}`
    const inAnalyze = new Map<string, any>()
    for (const s of a?.symbols ?? []) inAnalyze.set(key(s), s)
    const inWorker = new Map<string, any>()
    for (const s of p.symbols ?? []) inWorker.set(key(s), s)

    for (const t of expTargets) {
      const rows: any[] = []
      for (const s of a?.symbols ?? []) if (String(s?.name ?? "") === t) rows.push(s)
      if (rows.length === 0) { neither++; continue }
      const k = key(rows[0])
      const aw = rows[0]?.metadata?.isExported === true
      const ww = inWorker.get(k)?.metadata?.isExported === true
      if (aw && ww) { both++; exportedSymbols.push({ label: `${f.repo}/${f.rel}`, name: t, kind: String(rows[0]?.kind ?? "") }) }
      else if (!aw && !ww) { neither++ }
      else {
        analyzeOnly++
        if (dropped.length < 20) {
          const viaWorker = inWorker.has(k)
          dropped.push(`${f.repo}/${f.rel}: exports -> ${t} (${String(rows[0]?.kind ?? "")})  analyze() isExported=${aw}  parseFile() isExported=${ww}  symbol present in parseFile()=${viaWorker}  line ${rows[0]?.range?.start?.line ?? "?"}`)
        }
      }
    }
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()))

const total = both + neither + analyzeOnly
console.log(`bash — does every \`exports\` target keep isExported through parseFile?`)
console.log(`instrument  : analyze() vs production parseFile, symbol by symbol, no regex`)
console.log(`corpus      : ${CR}`)
console.log(`admitted    : ${admitted.length} files`)
console.log(`files with >=1 exports edge : ${filesWithExports}`)
console.log(`exports edges over them     : ${exportsEdges}`)
console.log(`distinct (target) rows compared: ${total}`)
console.log(`\n  isExported in BOTH paths: ${both}`)
console.log(`  isExported in NEITHER   : ${neither}   (not an exported symbol on either path)`)
console.log(`  ANALYZE() ONLY — DROPPED BY THE WORKER: ${analyzeOnly}   <- the defect class`)
for (const d of dropped) console.log(`      ${d}`)

const kinds = new Map<string, number>()
for (const s of exportedSymbols) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1)
console.log(`\n  kinds of the symbols that DO carry isExported into the store:`)
for (const [k, v] of Array.from(kinds.entries()).sort()) console.log(`      ${k.padEnd(20)} ${v}`)

if (analyzeOnly > 0) {
  console.log(`\nRESULT: ${analyzeOnly} exports target(s) publish isExported and lose it. The \`exports\` label is`)
  console.log(`therefore verifiable on the analyze() path and unverifiable on the production path for those`)
  console.log(`symbols. A consumer cannot re-derive the label without re-parsing the file.`)
} else {
  console.log(`\nRESULT: every \`exports\` target that publishes isExported keeps it through parseFile.`)
}