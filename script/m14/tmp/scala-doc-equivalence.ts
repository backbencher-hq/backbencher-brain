// Is the extractScalaDoc rewrite BEHAVIOUR-IDENTICAL, or merely faster?
//
// The M60 perf fix replaced a forward sibling scan with `previousNamedSibling`.
// That is only legitimate if it returns the same doc string for every symbol, so
// this compares the two implementations directly rather than reasoning about
// equivalence: the OLD algorithm is inlined here verbatim, and both are run over
// the same parsed trees, with every symbol's (name, owner, line) -> doc compared.
//
// It also re-measures the cost curve, because "faster" and "same answer" are
// separate claims and a perf fix that changed behaviour would be a regression
// dressed as an improvement.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve(path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const drawFile = process.argv[3]
const LIMIT = Number(process.argv[4] ?? 300)

// the OLD implementation, verbatim, operating on the same node objects
function oldExtract(node: any): string | undefined {
  const parent = node.parent
  if (!parent) return undefined
  let selfIdx = -1
  for (let i = 0; i < parent.namedChildCount; i++) {
    const c = parent.namedChild(i)
    if (c && c.startIndex === node.startIndex && c.endIndex === node.endIndex) { selfIdx = i; break }
  }
  for (let i = selfIdx - 1; i >= 0; i--) {
    const sibling = parent.namedChild(i)
    if (!sibling) continue
    if (sibling.type === "block_comment" && sibling.text.startsWith("/**")) return sibling.text
    break
  }
  return undefined
}

// the NEW rule, standalone, so it is compared rather than trusted
function newExtract(node: any): string | undefined {
  const sibling = node.previousNamedSibling
  if (sibling && sibling.type === "block_comment" && sibling.text.startsWith("/**")) return sibling.text
  return undefined
}

function walk(n: any, out: any[] = []): any[] {
  out.push(n)
  for (const c of n.namedChildren ?? []) walk(c, out)
  return out
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const gl = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(gl)
  const analyzer = new RealScalaAnalyzer()

  const files = fs.readFileSync(drawFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, LIMIT)

  // 1. equivalence on every node of every file — the widest possible sample,
  //    not just the nodes createSymbol happens to visit.
  let nodes = 0
  let oldHas = 0
  let newHas = 0
  let both = 0
  let onlyOld = 0
  let onlyNew = 0
  const diffs: string[] = []
  for (const f of files) {
    const fp = path.join(CORPUS, repo, f)
    if (!fs.existsSync(fp)) continue
    const src = fs.readFileSync(fp, "utf8")
    let root: any
    try { root = parser.parse(src).rootNode } catch { continue }
    for (const n of walk(root)) {
      nodes++
      const o = oldExtract(n)
      const w = newExtract(n)
      if (o) oldHas++
      if (w) newHas++
      if (o && w) both++
      if (o && !w) { onlyOld++; if (diffs.length < 8) diffs.push(`ONLY-OLD ${n.type}@${n.startIndex} file=${f}`) }
      if (!o && w) { onlyNew++; if (diffs.length < 8) diffs.push(`ONLY-NEW ${n.type}@${n.startIndex} file=${f}`) }
      if (o && w && o !== w && diffs.length < 8) diffs.push(`DIFFERENT ${n.type}@${n.startIndex} file=${f}`)
    }
  }

  console.log(`# extractScalaDoc equivalence — ${files.length} files from ${repo}\n`)
  console.log(`- nodes examined: ${nodes.toLocaleString()} (every node, not only declaration nodes)`)
  console.log(`- OLD produced a doc for: ${oldHas}`)
  console.log(`- NEW produces a doc for: ${newHas}`)
  console.log(`- agree: ${both}`)
  console.log(`- **only OLD: ${onlyOld}   only NEW: ${onlyNew}   differing text: ${diffs.length ? diffs.length : 0}**`)
  if (diffs.length) for (const d of diffs) console.log(`    ${d}`)
  console.log(`\n- verdict: ${onlyOld === 0 && onlyNew === 0 && !diffs.length ? "IDENTICAL on every node examined" : "DIVERGES — do not ship"}`)

  // 2. cost, same shape as the perf probe
  console.log(`\n## cost after the fix (identical shape to the perf probe)`)
  const shape = (n: number): string => {
    let s = "object Test {\n  def foo: Unit = {\n"
    for (let i = 0; i < n; i++) s += `    def f${i}(): Unit = ();\n`
    return s + "  }\n}\n"
  }
  console.log("| defs | ms | ms per def |")
  console.log("|---:|---:|---:|")
  const rows: { n: number; ms: number }[] = []
  for (const n of [100, 200, 400, 800, 1600]) {
    const src = shape(n)
    const root = parser.parse(src).rootNode
    analyzer.analyze(root, src, "/tmp/synthetic.scala")
    const t = performance.now()
    analyzer.analyze(root, src, "/tmp/synthetic.scala")
    const ms = performance.now() - t
    rows.push({ n, ms })
    console.log(`| ${n} | ${ms.toFixed(1)} | ${(ms / n).toFixed(3)} |`)
  }
  const usable = rows.filter((r) => r.ms > 2)
  if (usable.length >= 3) {
    const n2 = usable.length
    const lx = usable.map((r) => Math.log(r.n))
    const ly = usable.map((r) => Math.log(r.ms))
    const mx = lx.reduce((a, b) => a + b, 0) / n2
    const my = ly.reduce((a, b) => a + b, 0) / n2
    const num = usable.reduce((a, _, i) => a + (lx[i] - mx) * (ly[i] - my), 0)
    const den = usable.reduce((a, _, i) => a + (lx[i] - mx) ** 2, 0)
    const slope = num / den
    console.log(`\n- exponent: **${slope.toFixed(2)}** (was 1.53; 1.00 is linear)`)
    console.log(`- doubling costs about ${Math.pow(2, slope).toFixed(2)}x (was 2.89x)`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })