// Swift bare-read gate: parent/sibling shapes of identifier-bearing nodes.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const SRC = [
  "class Store {",
  "  var count = 0",
  "  var total = 0",
  "  func zero() { count = 0 }",
  "  func bare() -> Int { return count }",
  "  func dotted() -> Int { return self.count }",
  "  func local() -> Int { let count = 5; return count }",
  "  func plus() -> Int { return count + total }",
  "  func call() { go(count) }",
  "  func go(_ v: Int) {}",
  "  func chain() -> Int { return count.magnitude }",
  "}",
].join("\n") + "\n"

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-swift.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const tree = P.parse(SRC)
  const walk = (n: any) => {
    if (n.type === "simple_identifier" || n.type === "type_identifier") {
      const p = n.parent
      const sibs: string[] = []
      if (p) for (let i = 0; i < p.namedChildCount; i++) { const c = p.namedChild(i); if (c) sibs.push(c.type + (c.startIndex === n.startIndex ? "*" : "")) }
      let anc: string[] = []
      let q = p, g = 0
      while (q && g++ < 3) { anc.push(q.type); q = q.parent }
      console.log(`L${n.startPosition.row + 1} ${n.type}=${n.text} | parent=${p?.type} | sibs=[${sibs.join(",")}] | anc=${anc.join(">")}`)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c) }
  }
  walk(tree.rootNode)
}

main()
