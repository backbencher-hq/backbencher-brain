// W17: why is uses->ITER_FINISHED unexplained? `enum { ITER_FINISHED = -2 };`
// is an ANONYMOUS file-scope enum at file scope. The oracle's
// isDeclaringIdentifier covers enumerator (DECL_PARENT_TYPES), so the
// DECLARING occurrence enters declaredNames... unless the enum shape differs.
// Dump the exact tree shape + what the oracle's pre-pass sees.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"
const ROOT = "<corpus-root>/mcp/backbencher-brain"
const SRC = fs.readFileSync("<corpus-root>/bb_tests/repositories/jq/src/jv.c", "utf8")
async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  const root = p.parse(SRC).rootNode
  const stack: any[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.text === "ITER_FINISHED") {
      const chain: string[] = []
      let c: any = n
      while (c) { chain.push(c.type); c = c.parent }
      console.log("shape:", chain.join(" < "))
      console.log("parent:", n.parent.type, "| grandparent:", n.parent.parent?.type)
      console.log("line:", SRC.slice(0, n.startIndex).split("\n").length)
      console.log("---")
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
}
main().catch(e => { console.error(e); process.exit(1) })
