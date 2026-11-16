// W17: (i) do the disputed mentions sit on '#' lines?
// (ii) YY_INITIAL_VALUE: oracle declaredNames membership + fnLocals state of
// the enclosing function for the L2229/L2230 mentions.
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

  const checks: Array<[string, string, number[]]> = [
    ["src/builtin.c", "LIBM_DDD", [2056, 2057, 2058, 2059, 2060, 2061]],
    ["src/lexer.c", "yynoreturn", [565, 2306]],
    ["src/parser.c", "YY_INITIAL_VALUE", [2229, 2230]],
    ["src/jv_dtoa.c", "ROUND_BIASED", [4038]],
  ]
  for (const [rel, name, lns] of checks) {
    const src = fs.readFileSync(path.join(JQ, rel), "utf8")
    const lines = src.split("\n")
    for (const ln of lns) {
      const line = lines[ln - 1] ?? ""
      const firstChar = line.trimStart()[0] ?? ""
      console.log(rel + " L" + ln + " starts-with-#=" + (firstChar === "#") + " :: " + line.trim().slice(0, 70))
    }
  }

  // (ii) YY_INITIAL_VALUE oracle state
  const src = fs.readFileSync(path.join(JQ, "src/parser.c"), "utf8")
  const root = p.parse(src).rootNode
  let inDeclared = "not-found"
  let fnLocal = "?"
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "identifier" && n.text === "YY_INITIAL_VALUE") {
      const line = src.slice(0, n.startIndex).split("\n").length
      if (line === 2229 || line === 2230) {
        const chain: string[] = []
        let cur: any = n.parent
        while (cur && chain.length < 5) { chain.push(cur.type); cur = cur.parent }
        console.log("mention L" + line + " < " + chain.join(" < "))
        // enclosing function
        let enc: any = n.parent
        while (enc && enc.type !== "function_definition") enc = enc.parent
        console.log("enclosing fn: " + (enc ? (enc.childForFieldName("declarator")?.text ?? "?").slice(0, 40) : "NONE"))
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  console.log("inDeclared=" + inDeclared + " fnLocal=" + fnLocal)
}
main()
