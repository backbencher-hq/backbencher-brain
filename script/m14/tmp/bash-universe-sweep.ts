/**
 * READ-ONLY PROBE — the whole universe, not a 200-file draw.
 *
 * The 200-file draws were samples, and every number this lane has reported came
 * from corpora chosen by the same hand that wrote the analyzer. That is a real
 * limit on what the evidence supports: it shows the analyzer is right on what was
 * looked at, not that it is right everywhere. So this runs the independent oracle
 * over EVERY file the production router sends to the bash lane across all 68
 * cloned repositories.
 *
 * One number decides the question: FABRICATIONS — files where the analyzer
 * asserted an edge the oracle does not corroborate. That is the failure mode that
 * cannot be argued away, because a fabricated edge is a fact about the code that
 * is not true. Everything else here is context for that number.
 *
 * A DEFER is a file the grammar could not parse; it is counted separately and
 * never as a pass, because a verdict that needs a clean parse to be meaningful
 * should not be manufactured from a broken one.
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveBashEdges } from "../differential"

const CR = process.env.BB_CORPUS_ROOT ?? "<corpus-root>/bb_tests/repositories"
const CONC = Number(process.env.BB_CONC ?? 8)
const MAX_BYTES = 512 * 1024

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm/tree-sitter-bash.wasm"))
const LANG = await L.load(wasm)

type Repo = { name: string; dir: string; files: string[] }
const repos: Repo[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  repos.push({ name: e, dir, files: tracked })
}
console.log(`repositories: ${repos.length}\n`)

// --- census: what the PRODUCTION router actually admits -------------------------
type Job = { repo: string; dir: string; rel: string; abs: string; text: string }
const jobs: Job[] = []
let scanned = 0, tooBig = 0
for (const r of repos) {
  for (const rel of r.files) {
    const abs = path.join(r.dir, rel)
    let text: string
    try {
      const st = statSync(abs)
      if (!st.isFile()) continue
      if (st.size > MAX_BYTES) { tooBig++; continue }
      text = readFileSync(abs, "utf8")
    } catch { continue }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    jobs.push({ repo: r.name, dir: r.dir, rel, abs, text })
  }
}
console.log(`files scanned by the router: ${scanned}   (${tooBig} over ${MAX_BYTES >> 10}KB, skipped)`)
console.log(`files the router ADMITS to bash: ${jobs.length}\n`)
if (jobs.length === 0) { console.log("nothing admitted — check the router"); process.exit(1) }

type Bad = { file: string; kind: string; detail: string }
let idx = 0
let doneFiles = 0
let cleanParse = 0
let fabricatedFiles = 0
const fabs: Bad[] = []
let totTruth = 0, totCovered = 0, totMissing = 0, totUnexpl = 0
let totUnlined = 0, totBadSource = 0
const byRepo = new Map<string, { f: number; pass: number; defer: number; miss: number; unexpl: number; unlined: number; badSrc: number }>()
const unparsedByRepo = new Map<string, number>()

async function worker() {
  const parser = new P()
  parser.setLanguage(LANG)
  while (true) {
    const i = idx++
    if (i >= jobs.length) { parser.delete?.(); return }
    const j = jobs[i]
    let tree: any = null
    let errNodes = 0
    let truth: { label: string; from: string; target: string }[] = []
    try {
      tree = parser.parse(j.text)
      if (tree) {
        errNodes = 0
        const v = (n: any) => { if (n.type === "ERROR" || n.isMissing) errNodes++; for (let k = 0; k < n.childCount; k++) v(n.child(k)) }
        v(tree.rootNode)
        try { truth = deriveBashEdges(tree.rootNode, path.basename(j.rel)) } catch { truth = [] }
      }
    } catch { /* treated as unparsed */ }
    tree?.delete?.()

    let r: any = { symbols: [], relationships: [] }
    try { r = await parseFile(j.abs, j.dir) } catch { /* analyzer side empty */ }
    const syms = r.symbols ?? []
    const rels = r.relationships ?? []
    const declared = new Set(syms.map((s: any) => String(s.name)))
    const norm = rels.map((x: any) => ({ label: String(x.type ?? x.relationshipType ?? "").toLowerCase(), target: String(x.target ?? x.to ?? "").trim() }))

    let unlined = 0, badSrc = 0
    for (const x of rels) {
      if (!(typeof x.line_number === "number" && x.line_number > 0)) unlined++
      if (!declared.has(String(x.source ?? x.from ?? ""))) badSrc++
    }
    const covered = truth.filter((te) => norm.some((n) => n.label === te.label.toLowerCase() && n.target === te.target.trim())).length
    const unexpl = norm.filter((n) => !truth.some((te) => te.label.toLowerCase() === n.label && te.target.trim() === n.target)).length
    const miss = truth.length - covered

    totTruth += truth.length; totCovered += covered; totMissing += miss; totUnexpl += unexpl
    totUnlined += unlined; totBadSource += badSrc
    doneFiles++
    if (errNodes === 0) cleanParse++

    const row = byRepo.get(j.repo) ?? { f: 0, pass: 0, defer: 0, miss: 0, unexpl: 0, unlined: 0, badSrc: 0 }
    row.f++; row.miss += miss; row.unexpl += unexpl; row.unlined += unlined; row.badSrc += badSrc
    if (errNodes > 0) { row.defer++; unparsedByRepo.set(j.repo, (unparsedByRepo.get(j.repo) ?? 0) + 1) } else row.pass++
    byRepo.set(j.repo, row)

    // A FABRICATION, or either of the two ways an edge can be structurally a lie.
    if (unexpl > 0 || unlined > 0 || badSrc > 0) {
      fabricatedFiles++
      if (fabs.length < 200) {
        if (unexpl > 0) fabs.push({ file: `${j.repo}/${j.rel}`, kind: "fabricated edge", detail: `${unexpl} unexplained: ` + norm.filter((n) => !truth.some((te) => te.label.toLowerCase() === n.label && te.target.trim() === n.target)).slice(0, 3).map((n) => `${n.label}->${JSON.stringify(n.target)}`).join("  ") })
        if (unlined > 0) fabs.push({ file: `${j.repo}/${j.rel}`, kind: "unlined edge", detail: `${unlined} edge(s) with no line_number` })
        if (badSrc > 0) fabs.push({ file: `${j.repo}/${j.rel}`, kind: "non-symbol source", detail: `${badSrc} edge(s) whose source is not a symbol` })
      }
    }
    if (doneFiles % 500 === 0) process.stderr.write(`  ...${doneFiles}/${jobs.length}\n`)
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()))

console.log(`\n================ THE WHOLE UNIVERSE ================`)
console.log(`files analysed        ${doneFiles}   across ${byRepo.size} repositories`)
console.log(`parsed cleanly        ${cleanParse}  (${((100 * cleanParse) / doneFiles).toFixed(1)}%)`)
console.log(`truth edges           ${totTruth}`)
console.log(`covered               ${totCovered}  (${((100 * totCovered) / totTruth).toFixed(1)}%)`)
console.log(`MISSING               ${totMissing}`)
console.log(`UNEXPLAINED           ${totUnexpl}`)
console.log(`unlined edges         ${totUnlined}`)
console.log(`non-symbol sources    ${totBadSource}`)
console.log(`\n>>> FILES WITH A FABRICATION OR A STRUCTURAL LIE: ${fabricatedFiles}  (${((100 * fabricatedFiles) / doneFiles).toFixed(2)}%)`)

if (fabs.length) {
  console.log(`\n=== every such file (capped at 200 rows) ===`)
  const byKind = new Map<string, number>()
  for (const f of fabs) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1)
  for (const [k, n] of [...byKind.entries()].sort()) console.log(`  ${k}: ${n}`)
  for (const f of fabs.slice(0, 60)) console.log(`  [${f.kind}] ${f.file}\n      ${f.detail}`)
}

const worst = [...byRepo.entries()].filter(([, r]) => r.unexpl > 0 || r.unlined > 0 || r.badSrc > 0).sort((a, b) => b[1].unexpl - a[1].unexpl)
console.log(`\n=== repositories contributing a fabrication (${worst.length}) ===`)
for (const [n, r] of worst) console.log(`  ${n.padEnd(22)} unexpl=${String(r.unexpl).padStart(4)} unlined=${String(r.unlined).padStart(4)} badSrc=${String(r.badSrc).padStart(4)}  miss=${r.miss}`)
