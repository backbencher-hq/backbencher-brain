/**
 * GraphQL PERF ATTRIBUTION — is the analyzer slower, and if so, where?
 *
 * The m12 complexity artifact reported 1,237 ms for two corpus files; the same
 * two files measure 8,153 ms after this work. That is a 6.6x move and the only
 * honest response is to attribute it, so this probe times four cells on the same
 * input:
 *
 *   parse(old wasm) | analyze(old analyzer, old wasm)
 *   parse(new wasm) | analyze(new analyzer, new wasm)
 *   parse(new wasm) | analyze(OLD analyzer, NEW wasm)   <- isolates the wasm
 *   parse(old wasm) | analyze(NEW analyzer, OLD wasm)   <- isolates the analyzer
 *
 * The two cross cells are the point: if the cost moved with the wasm it is the
 * grammar's DFA, and if it moved with the analyzer it is the code. A guess here
 * would be worthless.
 */
import * as fs from "fs"
import * as path from "path"
import { CORPORA, OUT, PREVIOUS_WASM, ROOT } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const NEW_WASM = path.join(ROOT, "wasm/tree-sitter-graphql.wasm")
const OLD_WASM = PREVIOUS_WASM
const NEW_SRC = path.join(ROOT, "src/ast/real-graphql-analyzer.ts")
const OLD_SRC = "/tmp/real-graphql-analyzer.PREFIX.ts"

// `--cell <A|B|C|D>` runs ONE cell in its own process. The four cells were first
// measured in one process and the numbers moved by 2x between runs of the SAME
// binary, which is machine contention, not the code — so each cell now runs alone
// and the driver takes medians across repetitions.
const cellArg = process.argv.indexOf("--cell")
const onlyCell = cellArg >= 0 ? process.argv[cellArg + 1] : undefined
const files = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== onlyCell)
if (files.length === 0) files.push(`${CORPORA}/graphql-js/benchmark/github-schema.graphql`)

async function parserFor(wasm: string) {
  const p = new ParserClass()
  p.setLanguage(await Language.load(fs.readFileSync(wasm)))
  return p
}
async function analyzerFor(src: string, tag: string) {
  const file = path.join(GQL, "mutants", `perf-${tag}.ts`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, fs.readFileSync(src, "utf8").replace('from "./engine"', `from "${ROOT}/src/ast/engine"`))
  const mod: any = await import(`${file}?v=${tag}-${Date.now()}`)
  return mod.RealGraphqlAnalyzer
}

const pNew = await parserFor(NEW_WASM)
const pOld = await parserFor(OLD_WASM)
const aNew = await analyzerFor(NEW_SRC, "new")
const aOld = await analyzerFor(OLD_SRC, "old")

const rows: any[] = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const lines = src.split("\n").length
  const cell = (label: string, parser: any, A: any) => {
    // parse
    const t0 = Date.now()
    const tree = parser.parse(src)
    const parseMs = Date.now() - t0
    // analyze, best of 3 so JIT warm-up is not charged to the analyzer
    let best = Number.MAX_SAFE_INTEGER
    let syms = 0
    let rels = 0
    for (let i = 0; i < 3; i++) {
      const t1 = Date.now()
      const r: any = new A().analyze(tree.rootNode, src, f)
      const ms = Date.now() - t1
      if (ms < best) best = ms
      syms = r.symbols.length
      rels = r.relationships.length
    }
    rows.push({ file: path.basename(f), lines, cell: label, parseMs, analyzeMs: best, symbols: syms, relationships: rels })
  }
  const CELLS: Array<[string, string, any, any]> = [
    ["A", "new analyzer + new wasm (WIRED)", pNew, aNew],
    ["B", "old analyzer + old wasm (BEFORE)", pOld, aOld],
    ["C", "old analyzer + NEW wasm (isolates the WASM)", pNew, aOld],
    ["D", "new analyzer + OLD wasm (isolates the ANALYZER)", pOld, aNew],
  ]
  for (const [id, label, p, a] of CELLS) {
    if (onlyCell && onlyCell !== id) continue
    cell(`${id}: ${label}`, p, a)
  }
}

if (onlyCell) {
  const r = rows[0]
  console.log(JSON.stringify({ cell: onlyCell, parseMs: r.parseMs, analyzeMs: r.analyzeMs, facts: r.symbols + r.relationships, lines: r.lines }))
  fs.writeFileSync(path.join(OUT, `perf-cell-${onlyCell}.json`), JSON.stringify({ cell: onlyCell, parseMs: r.parseMs, analyzeMs: r.analyzeMs, facts: r.symbols + r.relationships, lines: r.lines }, null, 2))
  process.exit(0)
}
console.log(`\n=== GRAPHQL PERF ATTRIBUTION (best of 3 analyze, per file) ===`)
for (const r of rows) {
  console.log(
    `${r.cell.padEnd(46)} parse=${String(r.parseMs).padStart(5)}ms  analyze=${String(r.analyzeMs).padStart(5)}ms  ` +
      `facts=${String(r.symbols + r.relationships).padStart(5)}  ${r.lines} lines  ` +
      `${Math.round(r.lines / Math.max(1, r.analyzeMs) * 1000).toLocaleString()} lines/s`,
  )
}
const byCell = new Map<string, any>()
for (const r of rows) {
  const cur = byCell.get(r.cell) ?? { parseMs: 0, analyzeMs: 0, facts: 0 }
  cur.parseMs += r.parseMs
  cur.analyzeMs += r.analyzeMs
  cur.facts += r.symbols + r.relationships
  byCell.set(r.cell, cur)
}
console.log(`\n=== totals ===`)
for (const [k, v] of byCell) console.log(`  ${k.padEnd(46)} parse=${String(v.parseMs).padStart(5)}ms  analyze=${String(v.analyzeMs).padStart(5)}ms  facts=${v.facts}`)

fs.writeFileSync(path.join(OUT, "perf-attribution.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files, rows, totals: Object.fromEntries(byCell) }, null, 2))
for (const tag of ["new", "old"]) fs.rmSync(path.join(GQL, "mutants", `perf-${tag}.ts`), { force: true })
