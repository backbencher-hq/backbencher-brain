// Is `tag` reachable-and-connected in the pinned grammar, or is Y1/Y2 a grammar limitation?
// Dumps the raw s-expression for the shapes Y1/Y2 depend on.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const CASES: Record<string, string> = {
  tagScalar: "tagged: !!str 7\n",
  tagInclude: "- !include other.yml\n",
  tagMap: "m: !!map\n  a: 1\n",
  tagSeq: "s: !!seq [1, 2]\n",
  anchoredTagged: "k: &a !!str 7\n",
  plainDollar: 're: "^\\d+$"\n',
  timestamp: "at: 2001-12-14t21:59:43.10-05:00\n",
  directive: "%YAML 1.1\n---\na: 1\n",
  commentAbove: "# the port\nport: 8080\n",
  mergeSeq: "b: &b\n  x: 1\nd:\n  <<: [*b]\n",
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  for (const [name, src] of Object.entries(CASES)) {
    const tree = parser.parse(src)
    console.log(`\n=== ${name} ===`)
    console.log(src.split("\n").map((l: string) => `   | ${l}`).join("\n"))
    console.log(tree.rootNode.toString())
    // which node types are reachable, and does `tag` have a field or only a sibling slot?
    const tag = (() => {
      const stack = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        if (n.type === "tag") return n
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c) stack.push(c)
        }
      }
      return null
    })()
    if (tag) {
      console.log(`   tag node: children=[${Array.from({ length: tag.childCount }, (_, i) => tag.child(i)?.type).join(",")}]  parentType=${tag.parent?.type}`)
      console.log(`   tag fields: ${Array.from({ length: tag.childCount }, (_, i) => tag.fieldNameForChild(i) ?? "-").join(",")}`)
    }
  }
}
main()
