/**
 * READ-ONLY PROBE — the whole JSON corpus, through production parseFile, against
 * the independent oracle.
 *
 * The scoped F5 run samples 60 files with a per-run rotation, which is the right
 * design for the canonical 29-language sweep and the wrong instrument for a lane
 * that has just been enrolled: a single scoped run answers a question about 60
 * files and reports it as if it were about the lane. This measures everything.
 *
 * Reports the one number that cannot be argued about — FABRICATIONS, i.e. edges the
 * analyzer asserted that the oracle does not corroborate — alongside coverage and
 * the two structural lies (an edge with no line, an edge whose source is not a
 * symbol).
 *
 * Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { parseFile } from "../../../src/ast/pool-worker"
import { deriveJsonEdges } from "../differential"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_REPOS ?? "terraform,otp,ansible,clj-kondo,svelte,kubernetes").split(",").map((x) => x.trim()).filter(Boolean)

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(readFileSync(path.join(process.cwd(), "wasm/tree-sitter-json.wasm"))))

type Job = { repo: string; dir: string; rel: string; abs: string; text: string }
const jobs: Job[] = []
let scanned = 0, notRouted = 0
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { console.log(`  (skip ${repo}: not a git repo)`); continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "json") { notRouted++; continue }
    jobs.push({ repo, dir, rel, abs, text })
  }
}
console.log(`json corpus sweep`)
console.log(`  files scanned ${scanned}   routed to json ${jobs.length}   routed elsewhere ${notRouted}\n`)

let idx = 0
let truth = 0, covered = 0, missing = 0, unexpl = 0, unlined = 0, badSrc = 0
let parseErr = 0, analyserErr = 0
let filesWithTruth = 0, filesWithAnyEdge = 0
const dis: { kind: string; detail: string; file: string }[] = []
const byRepo = new Map<string, { files: number; truth: number; covered: number; unexpl: number; unlined: number; badSrc: number }>()
const shape = new Map<string, number>()

async function worker() {
  while (true) {
    const i = idx++
    if (i >= jobs.length) return
    const j = jobs[i]
    let tree: any = null
    let errNodes = 0
    let t: { label: string; from: string; target: string }[] = []
    try {
      tree = parser.parse(j.text)
      if (tree) {
        const v = (n: any) => { if (n.type === "ERROR" || n.isMissing) errNodes++; for (let k = 0; k < n.childCount; k++) v(n.child(k)) }
        v(tree.rootNode)
        t = deriveJsonEdges(tree.rootNode, path.basename(j.rel).replace(/\.[^.]+$/, ""), { manifest: /(^|\/)(package|composer)\.json$/.test(j.rel) })
      }
    } catch { parseErr++ }
    tree?.delete?.()

    let r: any = { symbols: [], relationships: [] }
    try { r = await parseFile(j.abs, j.dir) } catch { analyserErr++ }
    const syms = r.symbols ?? []
    const rels = r.relationships ?? []
    const declared = new Set(syms.map((x: any) => String(x.name)))
    const norm = rels.map((x: any) => ({ label: String(x.type ?? x.relationshipType ?? "").toLowerCase(), target: String(x.target ?? x.to ?? ""), line: x.line_number }))

    if (errNodes > 0) parseErr++
    const cov = t.filter((te) => norm.some((n) => n.label === te.label.toLowerCase() && n.target === te.target)).length
    const un = norm.filter((n) => !t.some((te) => te.label.toLowerCase() === n.label && te.target === te.target)).length
    const ms = t.length - cov
    truth += t.length; covered += cov; missing += ms; unexpl += un
    if (t.length > 0) filesWithTruth++
    if (rels.length > 0) filesWithAnyEdge++
    let fileUnlined = 0, fileBadSrc = 0
    for (const x of rels) {
      if (!(typeof x.line_number === "number" && x.line_number > 0)) fileUnlined++
      if (!declared.has(String(x.source ?? x.from ?? ""))) fileBadSrc++
    }
    unlined += fileUnlined
    badSrc += fileBadSrc
    // classify the file's top-level SHAPE — the reason a file has no edges
    const top = (() => { const d = tree2root(j.text); return d })()
    const k = `${j.repo === "otp" ? "otp" : j.repo}`
    const rootType = (j.text.trim()[0] ?? "").trim()
    const sh = rootType === "{" ? "object" : rootType === "[" ? "array" : rootType === '"' ? "string" : /[0-9-]/.test(rootType) ? "number" : rootType === "t" || rootType === "f" ? "boolean" : rootType === "n" ? "null" : "empty/other"
    shape.set(sh, (shape.get(sh) ?? 0) + 1)
    const row = byRepo.get(j.repo) ?? { files: 0, truth: 0, covered: 0, unexpl: 0, unlined: 0, badSrc: 0 }
    row.files++; row.truth += t.length; row.covered += cov; row.unexpl += un; row.unlined += fileUnlined; row.badSrc += fileBadSrc
    byRepo.set(j.repo, row)
    void top; void k
    if ((un > 0 || fileUnlined > 0 || fileBadSrc > 0) && dis.length < 60) {
      if (un > 0) dis.push({ kind: "UNEXPLAINED", detail: `${un}: ` + norm.filter((n) => !t.some((te) => te.label.toLowerCase() === n.label && te.target === n.target)).slice(0, 3).map((n) => `${n.label}->${JSON.stringify(n.target)}`).join("  "), file: `${j.repo}/${j.rel}` })
      if (fileUnlined > 0) dis.push({ kind: "unlined", detail: `${fileUnlined} edge(s) with no line_number`, file: `${j.repo}/${j.rel}` })
      if (fileBadSrc > 0) dis.push({ kind: "non-symbol source", detail: `${fileBadSrc} edge(s) whose source is not a symbol: ${[...new Set(rels.filter((x: any) => !declared.has(String(x.source ?? ""))).map((x: any) => String(x.source)))].slice(0, 4).join(", ")}`, file: `${j.repo}/${j.rel}` })
    }
  }
}
function tree2root(_t: string): null { return null }
await Promise.all(Array.from({ length: 8 }, () => worker()))

console.log(`================ JSON, WHOLE CORPUS ================`)
console.log(`files analysed          ${jobs.length}`)
console.log(`files with truth edges  ${filesWithTruth}`)
console.log(`files emitting any edge ${filesWithAnyEdge}`)
console.log(`truth edges             ${truth}`)
console.log(`covered                 ${covered}${truth ? `  (${((100 * covered) / truth).toFixed(1)}%)` : ""}`)
console.log(`MISSING                 ${missing}`)
console.log(`UNEXPLAINED             ${unexpl}`)
console.log(`unlined edges           ${unlined}`)
console.log(`non-symbol sources      ${badSrc}`)
console.log(`files with parse errors ${parseErr}   analyzer threw on ${analyserErr}`)

console.log(`\ntop-level shape of the admitted files (why a file yields no edges):`)
for (const [k, n] of [...shape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`)

console.log(`\nper repository:`)
for (const [n, r] of byRepo) console.log(`  ${n.padEnd(12)} files=${String(r.files).padStart(4)} truth=${String(r.truth).padStart(5)} covered=${String(r.covered).padStart(5)} unexpl=${r.unexpl} unlined=${r.unlined} badSrc=${r.badSrc}`)

if (dis.length) {
  console.log(`\n=== disagreements (capped at 60) ===`)
  for (const d of dis) console.log(`  [${d.kind}] ${d.file}\n      ${d.detail}`)
}
