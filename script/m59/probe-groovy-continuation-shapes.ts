// #851 / #852 ground truth: the raw tree shape AND every emitted edge, for the
// continuation layouts AND their one-line controls. Nothing is inferred — the
// s-expression and the edge JSON are both printed so the emitting branch can be
// identified, not guessed.
import * as fs from "fs"
import { RealGroovyAnalyzer } from "../../src/ast/real-groovy-analyzer"

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
  "851-dotted-parenless": `class A {
    void f() {
        def m = obj.thing
                .label
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
  for (const [name, source] of Object.entries(SHAPES)) {
    const parser = new P()
    parser.setLanguage(lang)
    const tree = parser.parse(source)
    console.log(`\n================ ${name} ================`)
    console.log("--- tree ---")
    console.log(tree.rootNode.toString().replace(/\(program /, "("))
    const az = new RealGroovyAnalyzer()
    const res: any = az.analyze(tree.rootNode, source, `probe-${name}.groovy`)
    const lines = source.split("\n")
    console.log("--- edges ---")
    for (const r of res.relationships ?? []) {
      if (r.type !== "calls" && r.type !== "uses") continue
      const ln = r.line_number
      console.log(
        `  ${String(r.type).padEnd(6)} ${String(r.source).padEnd(6)} -> ${String(r.target).padEnd(14)} line=${ln} [${String(r.metadata?.relationshipType ?? "method_invocation").padEnd(18)}] :: ${(lines[(ln ?? 1) - 1] ?? "").trim()}`,
      )
    }
  }
}
main().catch((e) => {
  console.error("FATAL", e)
  process.exit(1)
})
