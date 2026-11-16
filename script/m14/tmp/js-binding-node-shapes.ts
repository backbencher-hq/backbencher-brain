// Round 2: what EXACT node.parent does each fabricated identifier have?
// The exclusion rule must be built from grammar facts, not guesses.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
let P: any, LANG: any

async function parsers() {
  const wts: any = await import("web-tree-sitter")
  P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  LANG = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-javascript.wasm")))
}

function walk(n: any, cb: (x: any) => void) {
  cb(n)
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, cb) }
}

const CASES: [string, string][] = [
  ["import default", `import Comp from "./c";`],
  ["import named", `import { a, b } from "./c";`],
  ["import alias", `import { a as b } from "./c";`],
  ["import namespace", `import * as ns from "./c";`],
  ["fn params", `function f(a, b) { return 1; }`],
  ["fn default param", `function f(a = 1) {}`],
  ["arrow params", `const g = (a, b) => 1;`],
  ["arrow single", `const h = a => 1;`],
  ["catch param", `try { x(); } catch (err) {}`],
  ["obj pattern shorthand", `const { a, b } = obj;`],
  ["obj pattern alias", `const { a: c } = obj;`],
  ["obj pattern rest", `const { ...rest } = obj;`],
  ["obj pattern default", `const { a = 1 } = obj;`],
  ["arr pattern", `const [x, y] = arr;`],
  ["arr pattern rest", `const [x, ...rest] = arr;`],
  ["param obj pattern", `function f({ a, b }) {}`],
  ["param arr pattern", `function f([a, b]) {}`],
  ["export specifier", `const a = 1;\nexport { a };`],
  ["export alias", `const a = 1;\nexport { a as b };`],
]

async function main() {
  await parsers()
  for (const [tag, src] of CASES) {
    const p = new P(); p.setLanguage(LANG)
    const root = p.parse(src).rootNode
    const found: string[] = []
    walk(root, (n: any) => {
      if (n.type !== "identifier") return
      const pType = n.parent?.type ?? "?"
      // only report identifiers that are NOT inside an expression `pair`
      // (i.e. not the shorthand-expression form) — but report everything,
      // the caller reads the shapes.
      const grand = n.parent?.parent?.type ?? "?"
      found.push(`${n.text} [parent=${pType} grand=${grand}]`)
    })
    console.log(`${tag.padEnd(22)} ${found.join("  |  ")}`)
  }
}

main()
