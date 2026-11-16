// Is the declared type name a DIRECT child of class_declaration (shallow
// findChildByType) or nested (needs depth-first)? Decides which side is wrong.
import * as fs from "fs"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const NIO = "<corpus-root>/bb_tests/repositories/swift-nio"

const SNIPPETS: [string, string][] = [
  ["nio FileType", NIO + "/Sources/NIOFS/FileType.swift"],
  ["fixture Store", ROOT + "/validation/m14/fixtures/swift/write-gate.swift"],
]

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-swift.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  for (const [nm, f] of SNIPPETS) {
    const src = fs.readFileSync(f, "utf8")
    const root = P.parse(src).rootNode
    console.log("=== " + nm + " (" + f.split("/").pop() + ")")
    let shown = 0
    const walk = (n: any) => {
      if ((n.type === "class_declaration" || n.type === "protocol_declaration") && shown < 4) {
        shown++
        const kids: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i).type)
        console.log("  decl children: " + JSON.stringify(kids))
      }
      for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i))
    }
    walk(root)
  }
}
main()
