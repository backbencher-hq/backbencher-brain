// W17: which LIBM_DD mention still derives truth after CGD40? Dump every
// oracle-side mention of LIBM_DD with its admission verdict inputs.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
import { deriveCCalls } from "../differential"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const JQ = "/home/ishaq2321/bb_tests/repositories/jq"

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const src = fs.readFileSync(path.join(JQ, "src/builtin.c"), "utf8")
  const root = p.parse(src).rootNode
  const es = deriveCCalls(root, src).filter(e => e.target === "LIBM_DD")
  console.log("oracle LIBM_DD edges: " + JSON.stringify(es))
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "identifier" && n.text === "LIBM_DD") {
      const line = src.slice(0, n.startIndex).split("\n").length
      const bol = src.lastIndexOf("\n", n.startIndex - 1) + 1
      let i = bol
      while (i < n.startIndex && (src[i] === " " || src[i] === "\t")) i++
      const hash = src[i] === "#"
      const ch: string[] = []
      let cur: any = n.parent
      while (cur && ch.length < 4) { ch.push(cur.type); cur = cur.parent }
      console.log("L" + line + " hash=" + hash + " < " + ch.join(" < "))
    }
    for (let k = 0; k < n.namedChildCount; k++) { const c = n.namedChild(k); if (c) stack.push(c) }
  }
}
main()
