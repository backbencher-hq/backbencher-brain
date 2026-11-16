// W17: discriminator between a genuinely file-scope enum glued into an ERROR
// span (jv.c ITER_FINISHED) and a function-local enum glued OUT of its body
// (jv_dtoa.c emin). Dump full parent chains + the declaration-wrapper shape.
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const CASES: Array<[string, string, string]> = [
  ["jv.c", "ITER_FINISHED", "<corpus-root>/bb_tests/repositories/jq/src/jv.c"],
  ["jv_dtoa.c", "emin", "<corpus-root>/bb_tests/repositories/jq/src/jv_dtoa.c"],
]

async function main() {
  const P: any = (WTS as any).Parser ?? (WTS as any).default ?? WTS
  const L: any = (WTS as any).Language ?? (WTS as any).default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-c.wasm")))
  const p = new P(); p.setLanguage(LANG)
  for (const [fname, name, abs] of CASES) {
    const src = fs.readFileSync(abs, "utf8")
    const root = p.parse(src).rootNode
    // enumerate ALL enums named by the analyzer walk incl. directive subtrees:
    const stack: any[] = [root]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "enumerator" && n.namedChild(0)?.text === name) {
        console.log("== " + fname + " " + name + " ==")
        let cur: any = n
        const chain: string[] = []
        while (cur) { chain.push(cur.type + "[" + cur.startIndex + "]"); cur = cur.parent }
        console.log("  chain: " + chain.join(" < "))
        // does any ancestor declaration exist between enumerator and ERROR?
        let a: any = n.parent
        let sawDecl = false
        while (a && a.type !== "ERROR") {
          if (a.type === "declaration") sawDecl = true
          a = a.parent
        }
        console.log("  declaration wrapper before ERROR: " + sawDecl)
        break
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
}
main()
