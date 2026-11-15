// W17: rule the 4 jv_dtoa.c MISSING targets. Find every occurrence of each
// name and report parent-chain context (comment? #undef? fn-local enum?),
// then check the oracle's fnLocals admission for the emin enum shape.
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
  const abs = path.join(JQ, "src/jv_dtoa.c")
  const src = fs.readFileSync(abs, "utf8")
  const root = p.parse(src).rootNode
  const NAMES = new Set(["ROUND_BIASED", "Sudden_Underflow", "NO_HEX_FP", "emin"])
  const stack: any[] = [root]
  const seen = new Map<string, string[]>()
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "identifier" && NAMES.has(n.text)) {
      const line = src.slice(0, n.startIndex).split("\n").length
      const chain: string[] = []
      let cur: any = n.parent
      let depth = 0
      while (cur && depth < 6) { chain.push(cur.type); cur = cur.parent; depth++ }
      const arr = seen.get(n.text) ?? []
      arr.push("L" + line + " < " + chain.join(" < "))
      seen.set(n.text, arr)
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }
  for (const [name, occ] of [...seen.entries()].sort()) {
    console.log("== " + name + " (" + occ.length + " occurrences) ==")
    for (const o of occ.slice(0, 6)) console.log("   " + o)
  }
}
main()
