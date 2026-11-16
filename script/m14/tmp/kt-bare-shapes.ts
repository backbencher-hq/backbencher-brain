// #740 shape capture: parent chains for every identifier position the bare
// member-read gates must distinguish. Node names come from the pinned grammar,
// never from memory (the java/dart/swift ports each taught that lesson).
import * as fs from "fs"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const SRC = [
  "class K(val a: Int) {",
  "  var x: Int = 0",
  "  val inner = Inner()",
  "  fun f(p: Int): Int {",
  "    val y = 5",
  "    return x",
  "  }",
  "  fun dot(): Int { return this.x }",
  "  fun chain(): Int { return inner.deeper.leaf }",
  "  fun write() { x = 0 }",
  "  fun local(): Int { val z = 7; return z }",
  "  fun shadow(p: Int): Int { val x = 9; return x }",
  "  fun call(): Int { return go(x) }",
  "  fun go(v: Int): Int { return v }",
  "  fun interp(): String { return \"v=$x\" }",
  "}",
].join("\n") + "\n"

const WANT = new Set(["x", "a", "p", "y", "z", "v", "inner", "deeper", "leaf"])

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await Language.load(fs.readFileSync(ROOT + "/wasm/tree-sitter-kotlin.wasm"))
  const P = new Parser()
  P.setLanguage(lang)
  const root = P.parse(SRC).rootNode
  const walk = (n: any, chain: string[]) => {
    if (WANT.has(n.type === "simple_identifier" ? n.text : "")) {
      const line = SRC.slice(0, n.startIndex).split("\n").length
      console.log(`L${line}  ${n.text}  <- ${n.parent?.type}  <- ${chain.slice(-4).join(" > ")}`)
    }
    const label = n.type
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), [...chain, label])
  }
  walk(root, [])
}
main()
