// What is the scala analyzer's cost a function OF?
//
// The minimised reproducer is 125 lines / 28,692 bytes / 1,220 sibling `def fN():
// Unit = ()` definitions inside one method body, max tree depth 3, and it costs
// 2,903ms. The median corpus file is 317 bytes and costs 2.7ms. So cost tracks the
// NUMBER OF SIBLING DEFINITIONS, not bytes and not depth.
//
// This generates that shape at five sizes and fits the exponent, so the defect is
// named rather than guessed: exponent ~1 is linear and fine, ~2 is a quadratic
// scan that will bite any real project with a large object or trait.

import fs from "node:fs"
import path from "node:path"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const SIZES = (process.argv[2] ?? "100,200,400,800,1600").split(",").map(Number)

const shape = (n: number): string => {
  let s = "object Test {\n  def foo: Unit = {\n"
  for (let i = 0; i < n; i++) s += `    def f${i}(): Unit = ();\n`
  return s + "  }\n}\n"
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P()
  parser.setLanguage(lang)
  const analyzer = new RealScalaAnalyzer()

  console.log("# cost vs number of sibling definitions (identical shape, linear source growth)\n")
  console.log("| defs | bytes | symbols | relationships | ms | ms per def | ms per symbol |")
  console.log("|---:|---:|---:|---:|---:|---:|---:|")
  const rows: { n: number; ms: number }[] = []
  for (const n of SIZES) {
    const src = shape(n)
    const root = parser.parse(src).rootNode
    analyzer.analyze(root, src, "/tmp/synthetic.scala") // warm
    const t = performance.now()
    const res = analyzer.analyze(root, src, "/tmp/synthetic.scala")
    const ms = performance.now() - t
    rows.push({ n, ms })
    console.log(`| ${n} | ${src.length.toLocaleString()} | ${res.symbols?.length ?? 0} | ${res.relationships?.length ?? 0} | ${ms.toFixed(1)} | ${(ms / n).toFixed(3)} | ${(ms / Math.max(1, res.symbols?.length ?? 1)).toFixed(3)} |`)
  }

  const usable = rows.filter((r) => r.ms > 2)
  if (usable.length >= 3) {
    const n = usable.length
    const lx = usable.map((r) => Math.log(r.n))
    const ly = usable.map((r) => Math.log(r.ms))
    const mx = lx.reduce((a, b) => a + b, 0) / n
    const my = ly.reduce((a, b) => a + b, 0) / n
    const num = usable.reduce((a, _, i) => a + (lx[i] - mx) * (ly[i] - my), 0)
    const den = usable.reduce((a, _, i) => a + (lx[i] - mx) ** 2, 0)
    const slope = num / den
    const first = usable[0]
    const last = usable[usable.length - 1]
    const nRatio = last.n / first.n
    const tRatio = last.ms / first.ms
    console.log(`\n- exponent vs definition count: **${slope.toFixed(2)}** (1.00 linear, 2.00 quadratic)`)
    console.log(`- ${nRatio.toFixed(0)}x the definitions cost ${tRatio.toFixed(0)}x the time`)
    console.log(`- doubling the definitions costs about **${Math.pow(2, slope).toFixed(2)}x** the time`)
    if (slope > 1.3) {
      console.log(`\n## verdict: SUPERLINEAR in sibling-definition count`)
      console.log(`A quadratic scan over the symbol table explains it, and it is invisible at the`)
      console.log(`median file size (a 317-byte file has ~10 definitions). It only appears in`)
      console.log(`generated code, large objects and macro-expanded sources — which is exactly what`)
      console.log(`the worst real corpus file in scala3 is.`)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })