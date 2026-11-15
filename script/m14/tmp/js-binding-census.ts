// M49 web-closure: full census of BINDING-position identifiers that the JS
// bare-read path (#744) may be fabricating `uses @0.6` edges for. A binding
// site is a DEFINITION, never a read.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
let P: any, LANG: any

async function parsers() {
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
}

async function probe(tag: string, src: string) {
  await parsers()
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(src).rootNode
  const a = new RealJavaScriptAnalyzer() as any
  const r = await a.analyze(root, src, "probe.js", {})
  const uses = (r.relationships ?? []).filter((x: any) => x.type === "uses" && x.metadata?.bareRead)
  console.log(`${tag}: ${uses.length ? uses.map((u: any) => `${u.source}->${u.target}`).join(", ") : "(none)"}`)
}

async function main() {
  // Binding positions (must be NONE):
  await probe("import default", `import Comp from "./c";\n`)
  await probe("import named", `import { a, b } from "./c";\n`)
  await probe("import alias", `import { a as b } from "./c";\n`)
  await probe("import namespace", `import * as ns from "./c";\n`)
  await probe("import mixed", `import d, { e } from "./c";\n`)
  await probe("export specifier", `const a = 1;\nexport { a };\n`)
  await probe("export alias", `const a = 1;\nexport { a as b };\n`)
  await probe("export default ident", `const a = 1;\nexport default a;\n`)
  await probe("fn params", `function f(a, b) { return 1; }\n`)
  await probe("arrow params", `const g = (a, b) => 1;\n`)
  await probe("arrow single param", `const h = a => 1;\n`)
  await probe("catch param", `try { x(); } catch (err) {}\n`)
  await probe("destructure object", `const { a, b } = obj;\n`)
  await probe("destructure alias", `const { a: c } = obj;\n`)
  await probe("destructure rest", `const { ...rest } = obj;\n`)
  await probe("destructure array", `const [x, y] = arr;\n`)
  await probe("class field", `class C { m = 1; }\n`)
  await probe("method name", `class C { foo() {} }\n`)
  await probe("object method", `const o = { foo() {} };\n`)
  await probe("object shorthand", `const o = { a };\n`)
  await probe("labelled", `outer: for (;;) break outer;\n`)
  await probe("fn decl name", `function named() {}\n`)
  await probe("class decl name", `class K {}\n`)
  await probe("var decl", `let v = 1;\n`)

  // Genuine reads (must be PRESENT):
  await probe("READ: return ident", `function f() { const a = 1; return a; }\n`)
  await probe("READ: arg position", `f(a);\n`)
  await probe("READ: cond", `if (a) {}\n`)
  await probe("READ: used import", `import { a } from "./c";\nconsole.log(a);\n`)
}

main()
