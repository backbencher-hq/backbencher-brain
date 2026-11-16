// Dart bare-read gate: which parent types hold a `identifier` node, and what
// are its siblings? Gates are derived from THIS, not guessed.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-dart.wasm"))
  const P = new Parser()
  P.setLanguage(lang)

  const src = [
    "class Store {",
    "  int count = 0;",
    "  int total = 0;",
    "  void zero() { count = 0; }",
    "  int bare() { return count; }",
    "  int dotted() { return this.count; }",
    "  int local() { int count = 5; return count; }",
    "  int chain() { return count + total; }",
    "  void call() { go(count); }",
    "  void go(int v) {}",
    "}",
  ].join("\n")

  const tree = P.parse(src)
  const root = tree.rootNode

  const walk = (n: any, depth: number) => {
    if (n.type === "identifier" || n.type === "type_identifier") {
      const p = n.parent
      const sibs: string[] = []
      if (p) {
        for (let i = 0; i < p.namedChildCount; i++) {
          const c = p.namedChild(i)
          if (c) sibs.push(c.type + (c.startIndex === n.startIndex ? "*" : ""))
        }
      }
      const prev = n.previousNamedSibling
      const next = n.nextNamedSibling
      console.log(
        `L${n.startPosition.row + 1} ${n.type}=${n.text} | parent=${p?.type} | sibs=[${sibs.join(",")}] | prev=${prev?.type ?? "-"} next=${next?.type ?? "-"}`
      )
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk(c, depth + 1)
    }
  }
  walk(root, 0)
}

main()
