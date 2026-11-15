import * as fs from "fs"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-javascript.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealJavaScriptAnalyzer()
  const run = (lines: string[]) => {
    const source = lines.join("\n") + "\n"
    const tree = parser.parse(source)
    return az.analyze(tree.rootNode, source, "probe.js")
  }
  const out: string[] = []

  // J3 proper: duplicate methods on SEPARATE lines — last (body-carrying) wins
  {
    const res: any = run([
      "class C {",
      "  foo() { return 1 }",
      "  foo() { return 2 }",
      "}",
    ])
    const foos = (res.symbols ?? []).filter((s: any) => s.name === "foo")
    const lines = foos.map((s: any) => s.range?.startLine)
    out.push(`J3 dup methods separate lines: count=${foos.length} lines=${JSON.stringify(lines)} (expect count=1, line=3)`)
  }

  // J2 exact review shape 1: field in base + method in sub must NOT override
  {
    const res: any = run([
      "class Base { foo = 1 }",
      "class Sub extends Base { foo() {} }",
    ])
    const ovs = (res.relationships ?? []).filter((r: any) => r.type === "overrides")
    out.push(`J2 field-vs-method overrides: ${JSON.stringify(ovs.map((r: any) => ({ s: r.source, t: r.target, c: r.confidence })))} (expect none)`)
  }

  // J2 exact review shape 2: constructor override edges must not exist
  {
    const res: any = run([
      "class Base { constructor() { this.x = 1 } }",
      "class Sub extends Base { constructor() { super(); this.y = 2 } }",
    ])
    const ovs = (res.relationships ?? []).filter((r: any) => r.type === "overrides")
    out.push(`J2 ctor overrides: ${JSON.stringify(ovs.map((r: any) => ({ s: r.source, t: r.target, c: r.confidence })))} (expect none)`)
  }

  // J2 shape 3: a REAL override still resolves (control)
  {
    const res: any = run([
      "class Base { greet() {} }",
      "class Sub extends Base { greet() {} }",
    ])
    const ovs = (res.relationships ?? []).filter((r: any) => r.type === "overrides")
    out.push(`J2 control real override: ${JSON.stringify(ovs.map((r: any) => ({ s: r.source, t: r.target, c: r.confidence })))} (expect Sub.foo->Base.foo verified)`)
  }

  process.stderr.write(out.join("\n") + "\n")
  process.exit(0)
}
main()
