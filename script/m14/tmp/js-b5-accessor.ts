// #758/B5 verification: accessor-pair collapse — getter body calls vs setter.
// Contract question: does get/set x() {} emit calls from BOTH bodies?
import * as WTS from "web-tree-sitter"
const P = await WTS.init()
const LANG = await P.Language.load("/home/ishaq2321/mcp/backbencher-brain/vendor/tree-sitter-javascript.wasm")
const parser = new P()
parser.setLanguage(LANG)
const src = `class Store {
  constructor(inner) { this.inner = inner; this.lib = makeLib(); }
  get value() { return track(this.inner); }
  set value(v) { this.inner = wrap(v); }
}
new Store(1)
`
const tree = parser.parse(src)
function walk(n: any, depth = 0) {
  if (depth > 12) return
  const t = n.type
  if (t.includes("definition") || t.includes("pair") || t.includes("method")) console.log("  ".repeat(depth) + t + (n.text.length < 60 ? " :: " + n.text.replace(/\n/g, " ") : ""))
  for (const c of n.children) walk(c, depth + 1)
}
walk(tree.rootNode)
