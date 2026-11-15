// Decisive collusion check: run the JS lane's TRUTH oracles over the same
// binding-position sources. If truth emits the same fabricated uses edges,
// F5 is blind to them (vacuous-pass class) — explaining 100/0/0 with a
// fabricated surface.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { deriveTreeEdges, deriveJavaScriptEdges } from "../differential"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
let P: any, LANG: any

async function parsers() {
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
}

const CASES: [string, string][] = [
  ["import default", `import Comp from "./c";\n`],
  ["import named", `import { a, b } from "./c";\n`],
  ["import alias", `import { a as b } from "./c";\n`],
  ["import namespace", `import * as ns from "./c";\n`],
  ["fn params", `function f(a, b) { return 1; }\n`],
  ["arrow params", `const g = (a, b) => 1;\n`],
  ["catch param", `try { x(); } catch (err) {}\n`],
  ["destructure alias", `const { a: c } = obj;\n`],
  ["destructure array", `const [x, y] = arr;\n`],
  ["export specifier", `const a = 1;\nexport { a };\n`],
]

async function main() {
  await parsers()
  for (const [tag, src] of CASES) {
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const generic = deriveTreeEdges(root, "javascript").filter((e: any) => e.label === "uses")
    const js = deriveJavaScriptEdges(root).filter((e: any) => e.label === "uses")
    const show = (arr: any[]) => arr.length ? arr.map((e: any) => `${e.from}->${e.target}`).join(", ") : "(none)"
    console.log(`${tag.padEnd(20)} generic: ${show(generic).padEnd(30)} jsOracle: ${show(js)}`)
  }
}

main()
