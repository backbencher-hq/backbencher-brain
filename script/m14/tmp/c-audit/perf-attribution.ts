/**
 * C audit probe: ATTRIBUTE the analyzer's wall time on one large file.
 *
 * The documentation claims "single-pass DFS ... No O(n^2) or per-symbol O(n)
 * scans". That is a falsifiable claim about a specific pair of helpers:
 *
 *   recoverFunctionRange(node, content)
 *     - scans the body forward for the matching brace: O(body)
 *     - then calls indexToLineColumn(content, endIndex), which walks the WHOLE
 *       content from 0: O(n)
 *
 * Called once per function, so the second term is O(n * functions) per file --
 * superlinear in the file, and invisible in a per-kilobyte number taken from
 * small files.
 *
 * This probe MEASURES the attribution instead of arguing it: it runs the real
 * analyzer three ways on the same file and reports the delta.
 *
 *   A  as-is
 *   B  indexToLineColumn memoized (line index built once per file)  -> isolates the
 *      O(n) line lookup
 *   C  indexToLineColumn replaced by a constant                   -> upper bound on
 *      what any fix to that term can recover
 *
 *   bun run script/m14/tmp/c-audit/perf-attribution.ts <file.c> [repeats]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const file = process.argv[2]
const REPEATS = Number(process.argv[3] ?? 3)

const ANALYZER = path.join(ROOT, "src/ast/real-c-analyzer.ts")

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))

const src = fs.readFileSync(file, "utf8")
const tree = parser.parse(src)
const rel = path.relative(ROOT, file)

/** Load a MODIFIED copy of the analyzer from a temp path (Bun can import any .ts). */
async function loadVariant(tag: string, transform: (s: string) => string): Promise<any> {
  const text = fs.readFileSync(ANALYZER, "utf8")
  const raw = transform(text)
  if (raw === text) throw new Error(`variant ${tag}: transform changed nothing -- the patch anchor moved`)
  // The temp copy lives outside src/, so its RELATIVE import of ./engine cannot
  // resolve. Repoint it at the real module rather than dropping the dependency.
  const next = raw.replace(
    `from "./engine"`,
    `from ${JSON.stringify(path.join(ROOT, "src/ast/engine.ts"))}`,
  )
  const tmp = path.join("/tmp/opencode", `real-c-analyzer.${tag}.ts`)
  fs.writeFileSync(tmp, next)
  const mod = await import(tmp)
  return mod.RealCAnalyzer
}

const asIs = (await import(ANALYZER)).RealCAnalyzer

// B: memoize the line lookup on the instance, keyed by the content string.
const memoized = await loadVariant("memo", (s) => {
  const anchor = `  private indexToLineColumn(content: string, index: number): { line: number; column: number } {`
  if (!s.includes(anchor)) throw new Error("indexToLineColumn anchor not found")
  return s.replace(
    anchor,
    `  private __lineMemo: { key: string; idx: number[] } | null = null
  private __lineIndex(content: string): number[] {
    if (this.__lineMemo && this.__lineMemo.key === content) return this.__lineMemo.idx
    const idx: number[] = [0]
    for (let i = 0; i < content.length; i++) if (content[i] === "\\n") idx.push(i + 1)
    this.__lineMemo = { key: content, idx }
    return idx
  }
` + anchor,
  )
})

// C: constant answer -- the upper bound on the term's cost.
const constant = await loadVariant("const", (s) => {
  const anchor = `  private indexToLineColumn(content: string, index: number): { line: number; column: number } {`
  if (!s.includes(anchor)) throw new Error("indexToLineColumn anchor not found")
  return s.replace(
    anchor,
    `  private indexToLineColumn(content: string, index: number): { line: number; column: number } {
    return { line: 1, column: 1 }
  }
  private __unusedIndexToLineColumn(content: string, index: number): { line: number; column: number } {`,
  )
})

function timeIt(Cls: any): { best: number; median: number; all: number[] } {
  const times: number[] = []
  for (let i = 0; i < REPEATS; i++) {
    const t0 = performance.now()
    const res: any = new Cls().analyze(parser.parse(src).rootNode, src, file)
    times.push(performance.now() - t0)
    if (i === 0) void res.symbols.length
  }
  const sorted = [...times].sort((a, b) => a - b)
  return { best: sorted[0], median: sorted[Math.floor(sorted.length / 2)], all: times.map((t) => Number(t.toFixed(1))) }
}

let nodes = 0
{
  const st = [tree.rootNode]
  while (st.length) {
    const n = st.pop()!
    nodes++
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
}
const load1 = Number(fs.readFileSync("/proc/loadavg", "utf8").split(" ")[0])

console.log(`file: ${rel}`)
console.log(`bytes: ${Buffer.byteLength(src)}  lines: ${src.split("\n").length}  nodes: ${nodes}  repeats: ${REPEATS}  load1: ${load1}`)
const a = timeIt(asIs)
const b = timeIt(memoized)
const c = timeIt(constant)
console.log(`A as-is            : best ${a.best.toFixed(1)} ms  median ${a.median.toFixed(1)}  all ${JSON.stringify(a.all)}`)
console.log(`B memoized lookup : best ${b.best.toFixed(1)} ms  median ${b.median.toFixed(1)}  all ${JSON.stringify(b.all)}`)
console.log(`C constant lookup  : best ${c.best.toFixed(1)} ms  median ${c.median.toFixed(1)}  all ${JSON.stringify(c.all)}`)
const pctB = ((a.median - b.median) / a.median) * 100
const pctC = ((a.median - c.median) / a.median) * 100
console.log(`line-lookup share of analyzer wall time: memoized saves ${pctB.toFixed(1)}%, constant saves ${pctC.toFixed(1)}%`)
console.log(`(load1 is disclosed because the formula scores CPU, not wall, under contention)`)
