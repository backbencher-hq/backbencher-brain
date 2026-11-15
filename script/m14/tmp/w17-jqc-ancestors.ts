// W17: ancestor chain of the leaked identifier (last_var @ L2068) in the
// prefix-2100 parse. Settles whether gen_last_1's function_definition is
// ERROR-glued (no scope push) or intact (scope push then lost).
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)

  const full = fs.readFileSync(path.join(JQ, "src/builtin.c"), "utf8")
  const lines = full.split("\n")
  const src = lines.slice(0, 2100).join("\n")
  const root = p.parse(src).rootNode
  // find identifier nodes named last_var
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "identifier" && n.text === "last_var" && !n.parent?.parent?.type.includes("declarator")) {
      // usage occurrence (not the decl): print chain
      const chain: string[] = []
      let cur: any = n
      while (cur) {
        chain.push(cur.type + (cur.type === "ERROR" || cur.type === "function_definition" ? "" : "") + "[" + cur.startIndex + "]")
        cur = cur.parent
      }
      console.log("usage chain: " + chain.join(" < "))
      console.log("hasError(root)=" + root.hasError)
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  console.log("no usage occurrence found")
}
main()
