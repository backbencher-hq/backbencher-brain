// #851 / #852 oracle agreement: the analyzer's `calls` targets vs the oracle's
// `calls` truth, on both fixed continuation shapes and both one-line controls.
// An oracle that stayed blind here is exactly how these two defects shipped.
import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../src/ast/real-groovy-analyzer"
import { deriveGroovyEdges } from "../m14/differential"

const SHAPES: Record<string, string> = {
  "851-one-line-control": `class A {
    String label
    void f() {
        def m = this.label
        helper(m)
    }
}
`,
  "851-continued-parenless": `class A {
    String label
    void f() {
        def m = this
                .label
        helper(m)
    }
}
`,
  "851-continued-parenful": `class A {
    void f() {
        def m = helper
                .build(1)
        consume(m)
    }
}
`,
  "852-one-line-control": `class A {
    void f() {
        helper.build(2).configure(3)
    }
}
`,
  "852-juxt-dotted": `class A {
    void f() {
        helper.build(1)
        helper.build(2)
                .configure(3)
    }
}
`,
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  let bad = 0
  for (const [name, source] of Object.entries(SHAPES)) {
    const parser = new P()
    parser.setLanguage(lang)
    const tree = parser.parse(source)
    const az = new RealGroovyAnalyzer()
    const res: any = az.analyze(tree.rootNode, source, `probe-${name}.groovy`)
    const analyzer = new Set<string>(
      (res.relationships ?? [])
        .filter((r: any) => r.type === "calls")
        .map((r: any) => String(r.target)),
    )
    const oracle = new Set<string>(
      deriveGroovyEdges(tree.rootNode)
        .filter((e) => e.label === "calls")
        .map((e) => e.target),
    )
    const onlyAnalyzer = [...analyzer].filter((t) => !oracle.has(t)).sort()
    const onlyOracle = [...oracle].filter((t) => !analyzer.has(t)).sort()
    const ok = onlyAnalyzer.length === 0 && onlyOracle.length === 0
    if (!ok) bad++
    console.log(
      `${ok ? "AGREE  " : "DISAGREE"} ${name.padEnd(24)} analyzer=${JSON.stringify([...analyzer].sort())} oracle=${JSON.stringify([...oracle].sort())}` +
        (ok ? "" : `  analyzerOnly=${JSON.stringify(onlyAnalyzer)} oracleOnly=${JSON.stringify(onlyOracle)}`),
    )
  }
  console.log(bad === 0 ? "\nALL AGREE" : `\n${bad} DISAGREE`)
  if (bad > 0) process.exit(1)
}
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
