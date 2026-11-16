// W17: YY_INITIAL_VALUE oracle state — replicate declaredNames admission for
// the L715/L722 defines and fnLocals of yyparse (does it bind the name?).
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const JQ = "<corpus-root>/bb_tests/repositories/jq"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(path.join(JQ, "src/parser.c"), "utf8")
  const root = p.parse(src).rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "preproc_function_def" && n.text.includes("YY_INITIAL_VALUE")) {
      const line = src.slice(0, n.startIndex).split("\n").length
      const nameNode = n.childForFieldName("name")
      console.log("define L" + line + " nameNode=" + (nameNode?.text ?? "NULL") + " type=" + (nameNode?.type ?? "-"))
      // ancestors
      let a: any = n
      const ch: string[] = []
      while (a && ch.length < 4) { ch.push(a.type); a = a.parent }
      console.log("   chain: " + ch.join(" < "))
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
}
main()
