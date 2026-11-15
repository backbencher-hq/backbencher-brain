// Is the SCSS differential floor PARSE-BOUND or SEMANTIC?
//
//   bun script/m14/tmp/scss-parse-bound.ts [--files N]
//
// WHY THIS INSTRUMENT EXISTS. The lane's two headline numbers are a 45% parse floor
// (72 of 160 element-plus files carry ERROR spans) and a differential floor of
// MISSING 58. It is tempting to read those as one problem — "the grammar is bad, so
// the graph is bad" — and to conclude that the remaining work is a grammar redesign.
// That inference is UNTESTED, and it decides whether a large, shared, unbounded change
// to a grammar 25+ lanes depend on is worth attempting. So it gets measured instead of
// argued, which is the only thing that has moved this floor so far: the 64 -> 58 walk
// came from two analyzer recall fixes, not from one byte of grammar work.
//
// THE MEASUREMENT. For every MISSING row, record whether the file it came from parses.
// A row in a file that parses cleanly is a SEMANTIC gap — the analyzer had a readable
// tree and still did not emit the edge, which is an analyzer defect and a tractable one.
// A row in a file with ERROR spans is only *possibly* parse-bound: the claim may live
// inside a region the grammar lost, in which case no amount of analyzer work reaches it.
//
// The honest caveat, stated here so the number is not over-read: file-level parse
// status is a PROXY. A file with one error span in an unrelated corner is counted as
// parse-failing, so this OVER-counts the parse-bound share. That is the safe direction
// for a "should we do the redesign" question — it is the assumption most likely to
// justify the work, and if even the optimistic number is small the decision is easy.
//
// What it does NOT do: prove a row is parse-bound. Establishing that needs the row's
// node located inside a specific error span, which is per-row work this instrument
// deliberately does not pretend to do. It answers "is the redesign the lever", not
// "which rows would a redesign recover".
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import { Parser, Language } from "web-tree-sitter"
import { ASTEngine } from "../../../src/ast/engine"
import { deriveCssEdges, deriveScssEdges } from "../differential"

const argv = process.argv.slice(2)
const N = argv.includes("--files") ? parseInt(argv[argv.indexOf("--files") + 1]) : 100000
const ROOT = "/home/ishaq2321/bb_tests/repositories/element-plus"
const COMPARABLE = ["uses", "references", "imports", "contains"]

await Parser.init()
const parser = new Parser()
parser.setLanguage(await Language.load("wasm/tree-sitter-scss.wasm"))

const files: string[] = []
;(function walk(dir: string, depth = 0) {
  if (depth > 12) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (["node_modules", ".git", "dist", "build"].includes(e)) continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, depth + 1)
    else if (e.endsWith(".scss") && st.size > 0) files.push(p)
  }
})(ROOT)
files.sort()

interface Row {
  label: string
  target: string
  file: string
  parseFailing: boolean
  errorSpans: number
}
const missing: Row[] = []
let parseFailingFiles = 0
let cleanFiles = 0
let truthTotal = 0
let covered = 0
const missingByFile = new Map<string, number>()

for (const f of files.slice(0, N)) {
  const src = readFileSync(f, "utf8")
  const tree = parser.parse(src)
  const mod = f.split("/").pop()!.replace(/\.[^.]+$/, "")
  const truth = new Set<string>()
  for (const e of [...deriveCssEdges(tree.rootNode, mod), ...deriveScssEdges(tree.rootNode)]) {
    if (COMPARABLE.includes(e.label)) truth.add(`${e.label}|${e.target}`)
  }
  const r: any = await ASTEngine.parseFile(f, src)
  const actual = new Set<string>()
  for (const x of r.relationships ?? []) if (COMPARABLE.includes(String(x.type))) actual.add(`${x.type}|${x.target}`)

  // ERROR-span census for this file, by the same walk the lane uses to report them.
  let errorSpans = 0
  ;(function w(n: any) {
    if (n.type === "ERROR" || n.isMissing) errorSpans++
    for (let i = 0; i < n.childCount; i++) w(n.child(i))
  })(tree.rootNode)
  if (errorSpans > 0) parseFailingFiles++
  else cleanFiles++

  truthTotal += truth.size
  const rel = f.replace(ROOT + "/", "")
  for (const k of truth) {
    if (actual.has(k)) {
      covered++
      continue
    }
    const label = k.slice(0, k.indexOf("|"))
    const target = k.slice(k.indexOf("|") + 1)
    missing.push({ label, target, file: rel, parseFailing: errorSpans > 0, errorSpans })
    missingByFile.set(rel, (missingByFile.get(rel) ?? 0) + 1)
  }
}

const inFailing = missing.filter((m) => m.parseFailing)
const inClean = missing.filter((m) => !m.parseFailing)

console.log(`element-plus .scss — ${files.slice(0, N).length} files (${parseFailingFiles} with ERROR spans, ${cleanFiles} clean)`)
console.log(`truth ${truthTotal}  covered ${covered}  MISSING ${missing.length}\n`)

console.log("MISSING rows by whether their file parses:")
console.log(`   in a file that FAILS to parse : ${inFailing.length}  (${pct(inFailing.length, missing.length)})`)
console.log(`   in a file that parses CLEAN   : ${inClean.length}  (${pct(inClean.length, missing.length)})`)

console.log("\nthe CLEAN-file rows, which are the ones a grammar change cannot reach:")
const byTarget = new Map<string, number>()
for (const m of inClean) byTarget.set(`${m.label} -> ${m.target}`, (byTarget.get(`${m.label} -> ${m.target}`) ?? 0) + 1)
for (const [k, v] of [...byTarget].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(v).padStart(3)}  ${k.slice(0, 92)}`)

console.log("\nworst files by MISSING count:")
for (const [f, n] of [...missingByFile].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  const failing = missing.filter((m) => m.file === f && m.parseFailing).length
  console.log(`   ${String(n).padStart(3)} rows  (${failing} in a failing file)  ${f}`)
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "n/a"
}
